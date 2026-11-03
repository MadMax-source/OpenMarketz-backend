import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MediaPurpose,
  MediaVisibility,
  SellerApplicationStatus,
} from '@prisma/client';
import { createCipheriv, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { CreateSellerApplicationDto } from './dto/create-seller-application.dto.js';

const sellerMedia = [
  ['logoMediaId', MediaPurpose.STORE_LOGO, MediaVisibility.PUBLIC],
  ['bannerMediaId', MediaPurpose.STORE_BANNER, MediaVisibility.PUBLIC],
  ['idDocumentMediaId', MediaPurpose.KYC_DOCUMENT, MediaVisibility.PRIVATE],
  ['selfieMediaId', MediaPurpose.KYC_SELFIE, MediaVisibility.PRIVATE],
] as const;

@Injectable()
export class SellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async submitApplication(userId: string, input: CreateSellerApplicationDto) {
    const ownerBirthDate = new Date(input.ownerBirthDate);
    if (this.age(ownerBirthDate) < 18) {
      throw new ForbiddenException('Seller applicants must be at least 18.');
    }

    const existing = await this.prisma.sellerApplication.findUnique({
      where: { userId },
      select: { status: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.status === SellerApplicationStatus.UNDER_REVIEW
          ? 'Your seller application is already under review.'
          : 'A seller application already exists for this account.',
      );
    }

    const handle = input.handle.toLowerCase();
    const duplicateHandle = await this.prisma.sellerApplication.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (duplicateHandle) {
      throw new ConflictException('That store handle is already in use.');
    }

    const assetIds = sellerMedia.map(([field]) => input[field]);
    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: assetIds }, ownerId: userId, deletedAt: null },
      select: { id: true, purpose: true, visibility: true },
    });
    for (const [field, purpose, visibility] of sellerMedia) {
      const asset = assets.find((item) => item.id === input[field]);
      if (
        !asset ||
        asset.purpose !== purpose ||
        asset.visibility !== visibility
      ) {
        throw new ForbiddenException(
          `Upload a valid ${purpose.toLowerCase().replaceAll('_', ' ')} before submitting the application.`,
        );
      }
    }

    const keyHex = this.config.get<string>('KYC_ENCRYPTION_KEY');
    if (!keyHex || keyHex === '0'.repeat(64)) {
      throw new ServiceUnavailableException(
        'Seller onboarding is unavailable until a private KYC_ENCRYPTION_KEY is configured.',
      );
    }
    const idNumberCiphertext = this.encrypt(
      input.idNumber,
      Buffer.from(keyHex, 'hex'),
    );
    const businessType = input.businessType;
    if (businessType === 'registered' && !input.registrationNumber) {
      throw new ForbiddenException(
        'A business registration number is required for registered businesses.',
      );
    }

    const application = await this.prisma.sellerApplication.create({
      data: {
        userId,
        brandName: input.brandName.trim(),
        handle,
        description: input.description.trim(),
        categories: [...new Set(input.categories.map((value) => value.trim()))],
        businessType,
        registrationNumber: input.registrationNumber?.trim(),
        businessPhone: input.businessPhone.trim(),
        businessEmail: input.businessEmail.trim().toLowerCase(),
        country: input.country.toUpperCase(),
        region: input.region.trim(),
        city: input.city.trim(),
        address: input.address.trim(),
        ownerName: input.ownerName.trim(),
        ownerBirthDate,
        idType: input.idType,
        idNumberCiphertext,
        bankCode: input.bankCode.trim(),
        bankName: input.bankName.trim(),
        accountNumberCiphertext: this.encrypt(
          input.accountNumber,
          Buffer.from(keyHex, 'hex'),
        ),
        accountName: input.accountName.trim(),
        logoMediaId: input.logoMediaId,
        bannerMediaId: input.bannerMediaId,
        idDocumentMediaId: input.idDocumentMediaId,
        selfieMediaId: input.selfieMediaId,
      },
      select: {
        id: true,
        brandName: true,
        handle: true,
        status: true,
        submittedAt: true,
      },
    });

    return {
      application,
      message: 'Your seller application has been submitted for review.',
    };
  }

  async getMyApplication(userId: string) {
    return this.prisma.sellerApplication.findUnique({
      where: { userId },
      select: {
        id: true,
        brandName: true,
        handle: true,
        description: true,
        categories: true,
        businessType: true,
        businessEmail: true,
        country: true,
        region: true,
        city: true,
        status: true,
        reviewNote: true,
        submittedAt: true,
        reviewedAt: true,
      },
    });
  }

  async getSellerDashboard(userId: string) {
    const store = await this.prisma.sellerStore.findUnique({
      where: { ownerId: userId },
      select: {
        id: true,
        slug: true,
        name: true,
        verified: true,
        active: true,
        products: {
          select: { status: true, stock: true },
        },
      },
    });
    const application = await this.getMyApplication(userId);
    return {
      application,
      store: store
        ? {
            id: store.id,
            slug: store.slug,
            name: store.name,
            verified: store.verified,
            active: store.active,
            productCount: store.products.length,
            activeProductCount: store.products.filter(
              (product) => product.status === 'ACTIVE',
            ).length,
            outOfStockCount: store.products.filter(
              (product) => product.stock === 0,
            ).length,
          }
        : null,
    };
  }

  private encrypt(value: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  private age(birthDate: Date): number {
    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    if (
      today.getUTCMonth() < birthDate.getUTCMonth() ||
      (today.getUTCMonth() === birthDate.getUTCMonth() &&
        today.getUTCDate() < birthDate.getUTCDate())
    ) {
      age -= 1;
    }
    return age;
  }
}
