import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from './payments.service.js';

describe('PaymentsService bank challenges', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists the next challenge step without saving the submitted secret', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      payment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'payment-1',
          metadata: { orderId: 'order-1', saveCard: true },
        }),
        updateMany,
      },
    } as unknown as PrismaService;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          message: 'Verification required',
          data: {
            status: 'send_phone',
            reference: 'payment-reference',
            display_text: 'Enter the phone number registered to your card.',
          },
        }),
      }),
    );
    const service = new PaymentsService(
      prisma,
      new ConfigService({ PAYSTACK_SECRET_KEY: 'test-secret' }),
      {} as NotificationsService,
    );

    await expect(
      service.submitChallenge('buyer-1', 'payment-reference', 'pin', '1234'),
    ).resolves.toMatchObject({
      reference: 'payment-reference',
      status: 'send_phone',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: {
        authorizationUrl: 'Enter the phone number registered to your card.',
        metadata: {
          orderId: 'order-1',
          saveCard: true,
          challengeStatus: 'send_phone',
        },
      },
    });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain('1234');
  });
});
