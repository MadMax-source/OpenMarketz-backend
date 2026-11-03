import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SellerApplicationStatus } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '../../database/prisma.service.js';
import { ReviewSellerApplicationDto } from './dto/review-seller-application.dto.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listSellerApplications() {
    return this.prisma.sellerApplication.findMany({
      where: { status: SellerApplicationStatus.UNDER_REVIEW },
      select: {
        id: true,
        brandName: true,
        handle: true,
        description: true,
        categories: true,
        businessType: true,
        registrationNumber: true,
        businessPhone: true,
        businessEmail: true,
        country: true,
        region: true,
        city: true,
        address: true,
        ownerName: true,
        ownerBirthDate: true,
        idType: true,
        idDocumentMediaId: true,
        selfieMediaId: true,
        submittedAt: true,
        user: { select: { id: true, email: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });
  }

  async reviewSellerApplication(
    applicationId: string,
    adminId: string,
    input: ReviewSellerApplicationDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.sellerApplication.findUnique({
        where: { id: applicationId },
        include: {
          idDocumentMedia: { select: { id: true, visibility: true } },
          selfieMedia: { select: { id: true, visibility: true } },
        },
      });
      if (!application) {
        throw new NotFoundException('Seller application not found.');
      }
      if (application.status !== SellerApplicationStatus.UNDER_REVIEW) {
        throw new ConflictException(
          'Only applications under review can be approved or rejected.',
        );
      }
      if (
        !application.idDocumentMedia ||
        !application.selfieMedia ||
        application.idDocumentMedia.visibility !== 'PRIVATE' ||
        application.selfieMedia.visibility !== 'PRIVATE'
      ) {
        throw new ConflictException(
          'The private identity documents are not available for review.',
        );
      }

      const decision =
        input.decision === 'APPROVED'
          ? SellerApplicationStatus.APPROVED
          : SellerApplicationStatus.REJECTED;
      const updated = await transaction.sellerApplication.update({
        where: { id: application.id },
        data: {
          status: decision,
          reviewNote: input.reviewNote?.trim() || null,
          reviewedAt: new Date(),
        },
        select: {
          id: true,
          brandName: true,
          handle: true,
          status: true,
          reviewedAt: true,
          reviewNote: true,
        },
      });

      if (decision === SellerApplicationStatus.APPROVED) {
        const store = await transaction.sellerStore.create({
          data: {
            ownerId: application.userId,
            slug: application.handle,
            name: application.brandName,
            about: application.description,
            location: `${application.city}, ${application.region}`,
            verified: true,
            active: true,
            logoMediaId: application.logoMediaId,
            bannerMediaId: application.bannerMediaId,
            payoutAccount: {
              create: {
                bankCode: application.bankCode,
                bankName: application.bankName,
                accountNumberCiphertext: application.accountNumberCiphertext,
                accountName: application.accountName,
              },
            },
          },
          select: { id: true, slug: true, name: true, verified: true },
        });
        await transaction.auditEvent.create({
          data: {
            actorId: adminId,
            action: 'seller_application_approved',
            targetType: 'seller_application',
            targetId: application.id,
            metadata: { storeId: store.id },
          },
        });
        return { application: updated, store };
      }

      await transaction.auditEvent.create({
        data: {
          actorId: adminId,
          action: 'seller_application_rejected',
          targetType: 'seller_application',
          targetId: application.id,
        },
      });
      return { application: updated };
    });
  }

  async getPrivateApplicationMediaUrl(applicationId: string, mediaId: string) {
    const media = await this.prisma.mediaAsset.findFirst({
      where: {
        id: mediaId,
        purpose: { in: ['KYC_DOCUMENT', 'KYC_SELFIE'] },
        visibility: 'PRIVATE',
        deletedAt: null,
        OR: [
          { applicationDocuments: { id: applicationId } },
          { applicationSelfies: { id: applicationId } },
        ],
      },
      select: {
        cloudinaryPublicId: true,
        format: true,
        resourceType: true,
      },
    });
    if (!media) {
      throw new NotFoundException('Private application media not found.');
    }

    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'Cloudinary access is not configured.',
      );
    }
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    return {
      url: cloudinary.utils.private_download_url(
        media.cloudinaryPublicId,
        media.format,
        {
          resource_type: media.resourceType as 'image' | 'video' | 'raw',
          type: 'authenticated',
          expires_at: expiresAt,
        },
      ),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }
}
