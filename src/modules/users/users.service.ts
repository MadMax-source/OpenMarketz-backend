import { ForbiddenException, Injectable } from '@nestjs/common';
import { MediaPurpose, MediaVisibility } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, input: UpdateProfileDto) {
    if (input.avatarMediaId) {
      const avatar = await this.prisma.mediaAsset.findFirst({
        where: {
          id: input.avatarMediaId,
          ownerId: userId,
          purpose: MediaPurpose.AVATAR,
          visibility: MediaVisibility.PUBLIC,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!avatar) {
        throw new ForbiddenException(
          'The profile image must be uploaded to your account first.',
        );
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName?.trim(),
        lastName: input.lastName?.trim(),
        phone: input.phone?.trim(),
        country: input.country?.toUpperCase(),
        region: input.region?.trim(),
        birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
        gender: input.gender,
        marketingOptIn: input.marketingOptIn,
        avatarMediaId: input.avatarMediaId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        country: true,
        region: true,
        birthDate: true,
        gender: true,
        emailVerifiedAt: true,
        marketingOptIn: true,
        twoFactorEnabled: true,
        avatarMedia: { select: { id: true, secureUrl: true } },
        sellerApplication: {
          select: { id: true, brandName: true, status: true },
        },
        store: { select: { id: true, slug: true, name: true, verified: true } },
        createdAt: true,
      },
    });
  }
}
