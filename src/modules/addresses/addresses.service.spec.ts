import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service.js';
import { AddressesService } from './addresses.service.js';

describe('AddressesService manual addresses', () => {
  it('saves a typed Nigerian address without calling Google Places', async () => {
    const savedAddress = {
      id: 'address-1',
      line1: '12 Market Road',
      city: 'Lagos',
      state: 'Lagos',
      country: 'NG',
      googlePlaceId: null,
      area: 'Lagos',
      latitude: null,
      longitude: null,
    };
    const transaction = {
      address: {
        updateMany: vi.fn(),
        create: vi.fn().mockResolvedValue(savedAddress),
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      address: {},
    } as unknown as PrismaService;
    const service = new AddressesService(
      prisma,
      new ConfigService({}),
    );

    await expect(
      service.save(
        'buyer-1',
        {
          fullName: 'Test Buyer',
          phone: '08030000000',
          line1: '12 Market Road',
          city: 'Lagos',
          state: 'Lagos',
          label: 'Home',
        },
      ),
    ).resolves.toMatchObject(savedAddress);

    expect(transaction.address.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'buyer-1',
        line1: '12 Market Road',
        city: 'Lagos',
        state: 'Lagos',
        googlePlaceId: null,
        latitude: null,
        longitude: null,
      }),
    });
  });
});
