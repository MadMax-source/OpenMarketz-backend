import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { SaveAddressDto } from './dto/save-address.dto.js';

type PlaceComponent = { longText?: string; types?: string[] };
type PlaceDetails = {
  id: string;
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  addressComponents: PlaceComponent[];
};

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  list(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async autocomplete(input: string) {
    const query = input?.trim();
    if (!query || query.length < 3 || query.length > 200) {
      throw new BadRequestException('Enter at least 3 characters to search.');
    }
    const key = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!key)
      throw new ServiceUnavailableException(
        'Address search is not configured.',
      );

    const response = await fetch(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
        },
        body: JSON.stringify({
          input: query,
          includedRegionCodes: ['ng'],
          languageCode: 'en',
        }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok)
      throw new BadGatewayException(
        'Address search is temporarily unavailable.',
      );
    const payload = (await response.json()) as {
      suggestions?: {
        placePrediction?: { placeId?: string; text?: { text?: string } };
      }[];
    };
    return (payload.suggestions ?? []).flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      return prediction?.placeId && prediction.text?.text
        ? [{ placeId: prediction.placeId, description: prediction.text.text }]
        : [];
    });
  }

  async save(userId: string, input: SaveAddressDto, addressId?: string) {
    if (addressId) {
      const existing = await this.prisma.address.findFirst({
        where: { id: addressId, userId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Address not found.');
    }
    let addressDetails: {
      line1: string;
      city: string;
      state: string;
      googlePlaceId: string | null;
      area: string;
      latitude: number | null;
      longitude: number | null;
    };
    if (input.googlePlaceId) {
      const place = await this.getPlace(input.googlePlaceId);
      const getComponent = (...types: string[]) =>
        place.addressComponents.find((component) =>
          component.types?.some((type) => types.includes(type)),
        )?.longText;
      if (getComponent('country') !== 'Nigeria') {
        throw new BadRequestException('Delivery addresses must be in Nigeria.');
      }
      const state = getComponent('administrative_area_level_1');
      const city =
        getComponent('sublocality_level_1', 'neighborhood', 'locality') ??
        getComponent('administrative_area_level_2');
      if (!state || !city) {
        throw new BadRequestException(
          'Choose a complete street address in Nigeria.',
        );
      }
      addressDetails = {
        line1: place.formattedAddress,
        city,
        state,
        googlePlaceId: place.id,
        area: city,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
      };
    } else {
      const line1 = input.line1?.trim();
      const city = input.city?.trim();
      const state = input.state?.trim();
      if (!line1 || !city || !state) {
        throw new BadRequestException(
          'Enter a street address, city, and state.',
        );
      }
      addressDetails = {
        line1,
        city,
        state,
        googlePlaceId: null,
        area: city,
        latitude: null,
        longitude: null,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault || !addressId) {
        await tx.address.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }
      const data = {
        fullName: input.fullName.trim(),
        phone: input.phone.trim(),
        line1: addressDetails.line1,
        city: addressDetails.city,
        state: addressDetails.state,
        country: 'NG',
        landmark: input.landmark?.trim() || null,
        label: input.label,
        googlePlaceId: addressDetails.googlePlaceId,
        area: addressDetails.area,
        latitude: addressDetails.latitude,
        longitude: addressDetails.longitude,
        isDefault: input.isDefault ?? !addressId,
      };
      return addressId
        ? tx.address.update({ where: { id: addressId }, data })
        : tx.address.create({ data: { userId, ...data } });
    });
  }

  async setDefault(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
      select: { id: true },
    });
    if (!address) throw new NotFoundException('Address not found.');
    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      this.prisma.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      }),
    ]);
    return this.prisma.address.findUniqueOrThrow({ where: { id: addressId } });
  }

  async remove(userId: string, addressId: string) {
    const deleted = await this.prisma.address.deleteMany({
      where: { id: addressId, userId },
    });
    if (deleted.count !== 1) throw new NotFoundException('Address not found.');
    return { success: true };
  }

  private async getPlace(placeId: string): Promise<PlaceDetails> {
    const key = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!key)
      throw new ServiceUnavailableException(
        'Address search is not configured.',
      );
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(placeId)) {
      throw new BadRequestException(
        'Choose an address from the search results.',
      );
    }
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents',
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (response.status === 404)
      throw new BadRequestException('Choose a valid address.');
    if (!response.ok)
      throw new BadGatewayException(
        'Address details are temporarily unavailable.',
      );
    return (await response.json()) as PlaceDetails;
  }
}
