import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaPurpose, MediaVisibility } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';

type CloudinaryAsset = {
  public_id: string;
  resource_type: string;
  type: string;
  secure_url?: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  asset_folder?: string;
};

const MIME_TYPES: Record<MediaPurpose, string[]> = {
  AVATAR: ['image/jpeg', 'image/png', 'image/webp'],
  PRODUCT: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ],
  STORE_LOGO: ['image/jpeg', 'image/png', 'image/webp'],
  STORE_BANNER: ['image/jpeg', 'image/png', 'image/webp'],
  MARKET_REQUEST: ['image/jpeg', 'image/png', 'image/webp'],
  MESSAGE: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/ogg',
  ],
  KYC_DOCUMENT: ['image/jpeg', 'image/png', 'application/pdf'],
  KYC_SELFIE: ['image/jpeg', 'image/png'],
};

const MAX_BYTES: Record<MediaPurpose, number> = {
  AVATAR: 3 * 1024 * 1024,
  PRODUCT: 100 * 1024 * 1024,
  STORE_LOGO: 5 * 1024 * 1024,
  STORE_BANNER: 10 * 1024 * 1024,
  MARKET_REQUEST: 10 * 1024 * 1024,
  MESSAGE: 15 * 1024 * 1024,
  KYC_DOCUMENT: 10 * 1024 * 1024,
  KYC_SELFIE: 10 * 1024 * 1024,
};

@Injectable()
export class CloudinaryService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async createUploadIntent(userId: string, input: CreateUploadIntentDto) {
    const { cloudName, apiKey, apiSecret } = this.credentials();
    await this.validatePurposeAccess(userId, input.purpose);
    if (!MIME_TYPES[input.purpose].includes(input.contentType.toLowerCase())) {
      throw new UnsupportedMediaTypeException(
        'That file type is not allowed for this upload.',
      );
    }

    const resourceType = input.contentType.startsWith('video/')
      ? 'video'
      : input.contentType.startsWith('audio/') ||
          input.contentType === 'application/pdf'
        ? 'raw'
        : 'image';
    const type =
      input.purpose === MediaPurpose.KYC_DOCUMENT ||
      input.purpose === MediaPurpose.KYC_SELFIE
        ? 'authenticated'
        : 'upload';
    const publicId = `${userId}/${input.purpose.toLowerCase()}/${randomUUID()}`;
    await this.prisma.mediaUploadIntent.create({
      data: {
        ownerId: userId,
        purpose: input.purpose,
        publicId,
        resourceType,
        uploadType: type,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const allowedFormats = MIME_TYPES[input.purpose].map((mime) => {
      if (mime === 'application/pdf') return 'pdf';
      return mime
        .split('/')[1]
        .replace('quicktime', 'mov')
        .replace('mpeg', 'mp3');
    });
    const params = {
      timestamp,
      public_id: publicId,
      type,
      overwrite: false,
      allowed_formats: [...new Set(allowedFormats)].join(','),
    };
    const signature = cloudinary.utils.api_sign_request(params, apiSecret);

    return {
      cloudName,
      apiKey,
      resourceType,
      uploadType: type,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
      publicId,
      timestamp,
      signature,
      params,
      maxBytes: MAX_BYTES[input.purpose],
    };
  }

  async finalizeUpload(
    userId: string,
    purpose: MediaPurpose,
    publicId: string,
  ) {
    this.credentials();
    const existing = await this.prisma.mediaAsset.findUnique({
      where: { cloudinaryPublicId: publicId },
    });
    if (existing) {
      if (existing.ownerId !== userId || existing.purpose !== purpose) {
        throw new ForbiddenException('This upload is not available.');
      }
      return this.toResponse(existing);
    }

    const intent = await this.prisma.mediaUploadIntent.findFirst({
      where: {
        ownerId: userId,
        purpose,
        publicId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!intent) {
      throw new ForbiddenException(
        'This upload is not authorized, has expired, or has already been used.',
      );
    }

    const type = intent.uploadType;
    const resourceType = intent.resourceType;
    let remote: CloudinaryAsset;
    try {
      remote = (await cloudinary.api.resource(publicId, {
        resource_type: resourceType,
        type,
      })) as CloudinaryAsset;
    } catch {
      throw new ServiceUnavailableException(
        'The upload could not be verified with Cloudinary.',
      );
    }

    if (
      remote.public_id !== publicId ||
      remote.type !== type ||
      remote.resource_type !== resourceType
    ) {
      throw new ForbiddenException(
        'The uploaded asset does not match this request.',
      );
    }

    const format = remote.format.toLowerCase();
    const mime = this.mimeFor(format, resourceType);
    if (!MIME_TYPES[purpose].includes(mime)) {
      throw new UnsupportedMediaTypeException(
        'The uploaded file type is not allowed for this purpose.',
      );
    }
    if (remote.bytes < 1 || remote.bytes > MAX_BYTES[purpose]) {
      throw new UnsupportedMediaTypeException(
        'The uploaded file exceeds the allowed size.',
      );
    }

    const asset = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.mediaUploadIntent.findFirst({
        where: {
          id: intent.id,
          ownerId: userId,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!current) {
        throw new ForbiddenException('This upload has already been finalized.');
      }

      const created = await transaction.mediaAsset.create({
        data: {
          ownerId: userId,
          cloudinaryPublicId: publicId,
          resourceType,
          secureUrl: type === 'upload' ? remote.secure_url : null,
          format,
          bytes: remote.bytes,
          width: remote.width,
          height: remote.height,
          durationSeconds: remote.duration,
          purpose,
          visibility:
            type === 'authenticated'
              ? MediaVisibility.PRIVATE
              : MediaVisibility.PUBLIC,
        },
      });
      await transaction.mediaUploadIntent.update({
        where: { id: intent.id },
        data: { usedAt: new Date() },
      });
      return created;
    });
    return this.toResponse(asset);
  }

  private async validatePurposeAccess(
    userId: string,
    purpose: MediaPurpose,
  ): Promise<void> {
    if (purpose === MediaPurpose.PRODUCT) {
      const store = await this.prisma.sellerStore.findFirst({
        where: { ownerId: userId, active: true },
      });
      if (!store) {
        throw new ForbiddenException(
          'An approved active seller account is required to upload product media.',
        );
      }
    }
  }

  private credentials() {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'Cloudinary uploads are not configured.',
      );
    }
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
    return { cloudName, apiKey, apiSecret };
  }

  private mimeFor(format: string, resourceType: string): string {
    if (format === 'pdf') return 'application/pdf';
    if (resourceType === 'video') {
      if (format === 'mov') return 'video/quicktime';
      return `video/${format}`;
    }
    if (resourceType === 'raw') {
      if (format === 'mp3') return 'audio/mpeg';
      if (format === 'm4a') return 'audio/mp4';
      if (format === 'ogg') return 'audio/ogg';
      if (format === 'webm') return 'audio/webm';
    }
    return `image/${format === 'jpg' ? 'jpeg' : format}`;
  }

  private toResponse(asset: {
    id: string;
    purpose: MediaPurpose;
    secureUrl: string | null;
    format: string;
    bytes: number;
    width: number | null;
    height: number | null;
    visibility: MediaVisibility;
  }) {
    return {
      id: asset.id,
      purpose: asset.purpose,
      url: asset.visibility === MediaVisibility.PUBLIC ? asset.secureUrl : null,
      format: asset.format,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
    };
  }
}
