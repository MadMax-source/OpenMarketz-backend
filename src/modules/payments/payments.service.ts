import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentProvider,
  PaymentStatus,
  Prisma,
  SellerSettlementStatus,
} from '@prisma/client';
import {
  createCipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

type PaystackResponse<T> = { status: boolean; message: string; data: T };
type PaystackAuthorization = {
  authorization_code?: string;
  signature?: string;
  card_type?: string;
  last4?: string;
  exp_month?: string;
  exp_year?: string;
  bank?: string;
  reusable?: boolean;
};
type PaystackTransaction = {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  authorization?: PaystackAuthorization;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async initializeOrder(
    userId: string,
    orderId: string,
    options: {
      saveCard?: boolean;
      savedPaymentMethodId?: string;
      payerEmail?: string;
      metadata?: Prisma.InputJsonObject;
    } = {},
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: userId },
      include: { buyer: { select: { email: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('This order is not awaiting payment.');
    }

    const prior = await this.prisma.payment.findFirst({
      where: {
        orderId,
        status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const priorChallengeStatus =
      prior?.metadata &&
      typeof prior.metadata === 'object' &&
      'challengeStatus' in prior.metadata &&
      typeof prior.metadata.challengeStatus === 'string'
        ? prior.metadata.challengeStatus
        : undefined;
    if (prior && (prior.authorizationUrl || priorChallengeStatus)) {
      return {
        reference: prior.reference,
        authorizationUrl: prior.authorizationUrl,
        amount: Number(prior.amountKobo / 100n),
        currency: prior.currency,
        status: priorChallengeStatus,
      };
    }

    const secret = this.requireSecret();
    const reference = `omz_${randomUUID().replaceAll('-', '')}`;
    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        provider: PaymentProvider.PAYSTACK,
        reference,
        amountKobo: order.totalKobo,
        status: PaymentStatus.INITIALIZED,
        metadata: {
          orderId,
          saveCard: options.saveCard ?? false,
          savedPaymentMethodId: options.savedPaymentMethodId ?? null,
          ...options.metadata,
        },
        payerEmail: options.payerEmail,
      },
    });

    try {
      if (options.savedPaymentMethodId) {
        return await this.chargeSavedMethod(
          userId,
          order,
          payment,
          options.savedPaymentMethodId,
          secret,
        );
      }

      const response = await this.paystack<{
        authorization_url: string;
        access_code: string;
        reference: string;
      }>(
        '/transaction/initialize',
        {
          email: options.payerEmail ?? order.buyer.email,
          amount: order.totalKobo.toString(),
          currency: order.currency,
          reference,
          callback_url: this.callbackUrl(order.id, reference),
          metadata: {
            order_id: order.id,
            user_id: userId,
            save_card: options.saveCard ?? false,
          },
        },
        secret,
      );
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          authorizationUrl: response.data.authorization_url,
          status: PaymentStatus.PENDING,
        },
      });
      return {
        reference,
        authorizationUrl: response.data.authorization_url,
        amount: Number(order.totalKobo / 100n),
        currency: order.currency,
      };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Paystack initialization failed.',
        },
      });
      throw error;
    }
  }

  async initializeExistingPayment(
    userId: string,
    paymentId: string,
    payerEmail: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId },
      include: { order: { include: { buyer: { select: { id: true } } } } },
    });
    if (!payment?.order || payment.order.buyer.id !== userId) {
      throw new NotFoundException('Payment not found.');
    }
    if (payment.status !== PaymentStatus.INITIALIZED) {
      throw new BadRequestException(
        'This payment is no longer awaiting initialization.',
      );
    }
    const response = await this.paystack<{
      authorization_url: string;
      access_code: string;
    }>(
      '/transaction/initialize',
      {
        email: payerEmail,
        amount: payment.amountKobo.toString(),
        currency: payment.currency,
        reference: payment.reference,
        callback_url: this.callbackUrl(
          payment.order.id,
          payment.reference,
          Boolean(
            payment.metadata &&
            typeof payment.metadata === 'object' &&
            'gift' in payment.metadata &&
            payment.metadata.gift === true,
          ),
        ),
        metadata: payment.metadata as Prisma.InputJsonObject,
      },
      this.requireSecret(),
    );
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        payerEmail,
        authorizationUrl: response.data.authorization_url,
        status: PaymentStatus.PENDING,
      },
    });
    return {
      reference: payment.reference,
      authorizationUrl: response.data.authorization_url,
      amount: Number(payment.amountKobo / 100n),
      currency: payment.currency,
    };
  }

  async listSavedMethods(userId: string) {
    return this.prisma.savedPaymentMethod.findMany({
      where: { userId, active: true },
      select: {
        id: true,
        cardType: true,
        last4: true,
        expMonth: true,
        expYear: true,
        bank: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeSavedMethod(userId: string, methodId: string) {
    const result = await this.prisma.savedPaymentMethod.updateMany({
      where: { id: methodId, userId, active: true },
      data: { active: false },
    });
    if (result.count !== 1)
      throw new NotFoundException('Saved payment method not found.');
    return { success: true };
  }

  async verifyForUser(userId: string, reference: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { reference, order: { buyerId: userId } },
      select: { id: true },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    return this.verifyAndApply(reference);
  }

  async verifyReference(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    return this.verifyAndApply(reference);
  }

  async submitOtp(userId: string, reference: string, otp: string) {
    return this.submitChallenge(userId, reference, 'otp', otp);
  }

  async submitChallenge(
    userId: string,
    reference: string,
    type: 'otp' | 'pin' | 'phone' | 'birthday',
    value: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        reference,
        order: { buyerId: userId },
        status: PaymentStatus.PENDING,
      },
      select: { id: true, metadata: true },
    });
    if (!payment) throw new NotFoundException('Pending payment not found.');
    const challengeFields = {
      otp: ['otp', '/transaction/submit_otp'],
      pin: ['pin', '/transaction/submit_pin'],
      phone: ['phone', '/transaction/submit_phone'],
      birthday: ['birthday', '/transaction/submit_birthday'],
    } as const;
    const [field, path] = challengeFields[type];
    const result = await this.paystack<{
      status: string;
      reference: string;
      display_text?: string;
    }>(path, { [field]: value, reference }, this.requireSecret());
    if (result.data.status === 'success') return this.verifyAndApply(reference);
    const challengeStatus = (
      ['send_otp', 'send_pin', 'send_phone', 'send_birthday'] as const
    ).find((status) => status === result.data.status);
    if (challengeStatus) {
      const metadata =
        payment.metadata &&
        typeof payment.metadata === 'object' &&
        !Array.isArray(payment.metadata)
          ? (payment.metadata as Prisma.InputJsonObject)
          : {};
      const updated = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: {
          authorizationUrl: result.data.display_text ?? null,
          metadata: { ...metadata, challengeStatus },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('This payment has already changed.');
      }
    }
    return {
      reference,
      status: result.data.status,
      message:
        result.data.display_text ?? 'Complete the requested bank verification.',
    };
  }

  async verifyWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    if (!rawBody || !signature)
      throw new BadRequestException('Invalid payment webhook.');
    const secret = this.requireSecret();
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException('Invalid payment webhook signature.');
    }

    let event: {
      event?: string;
      data?: { reference?: string; id?: number | string; status?: string };
    };
    try {
      event = JSON.parse(rawBody.toString('utf8')) as typeof event;
    } catch {
      throw new BadRequestException('Invalid payment webhook payload.');
    }
    if (!event.event || !event.data?.reference) {
      return { received: true, processed: false };
    }
    const eventId = `${event.event}:${event.data.reference}:${event.data.id ?? 'unknown'}`;
    const duplicate = await this.prisma.paymentEvent.findUnique({
      where: { providerEventId: eventId },
      select: { id: true, processedAt: true },
    });
    if (duplicate?.processedAt) return { received: true, processed: true };
    if (!duplicate) {
      try {
        await this.prisma.paymentEvent.create({
          data: {
            provider: 'PAYSTACK',
            providerEventId: eventId,
            eventType: event.event,
            payload: JSON.parse(
              rawBody.toString('utf8'),
            ) as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
      }
    }

    if (event.event === 'charge.success') {
      await this.verifyAndApply(event.data.reference);
    } else if (event.event === 'charge.failed') {
      await this.markFailed(event.data.reference);
    } else if (
      event.event === 'transfer.success' ||
      event.event === 'transfer.failed'
    ) {
      await this.applyTransferEvent(
        event.data.reference,
        event.event === 'transfer.success',
      );
    } else {
      return { received: true, processed: false };
    }
    await this.prisma.paymentEvent.update({
      where: { providerEventId: eventId },
      data: { processedAt: new Date() },
    });
    return { received: true, processed: true };
  }

  async listPayoutBanks() {
    const secret = this.requireSecret();
    const result = await this.paystack<{ name: string; code: string }[]>(
      '/bank?country=nigeria&currency=NGN',
      undefined,
      secret,
      'GET',
    );
    return result.data.map((bank) => ({ name: bank.name, code: bank.code }));
  }

  async saveSellerPayoutAccount(
    userId: string,
    input: { bankCode: string; bankName: string; accountNumber: string },
  ) {
    const store = await this.prisma.sellerStore.findUnique({
      where: { ownerId: userId },
      include: { payoutAccount: true },
    });
    if (!store?.payoutAccount)
      throw new ForbiddenException('An approved seller account is required.');
    const secret = this.requireSecret();
    const resolved = await this.paystack<{
      account_name: string;
      account_number: string;
    }>(
      `/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`,
      undefined,
      secret,
      'GET',
    );
    if (resolved.data.account_number !== input.accountNumber) {
      throw new BadRequestException('The bank account could not be verified.');
    }
    const recipient = await this.paystack<{ recipient_code: string }>(
      '/transferrecipient',
      {
        type: 'nuban',
        name: resolved.data.account_name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: 'NGN',
      },
      secret,
    );
    const keyHex = this.config.get<string>('KYC_ENCRYPTION_KEY');
    if (!keyHex || keyHex === '0'.repeat(64)) {
      throw new ServiceUnavailableException(
        'Payout details cannot be saved until encryption is configured.',
      );
    }
    await this.prisma.payoutAccount.update({
      where: { storeId: store.id },
      data: {
        bankCode: input.bankCode,
        bankName: input.bankName,
        accountName: resolved.data.account_name,
        accountNumberCiphertext: this.encrypt(
          input.accountNumber,
          Buffer.from(keyHex, 'hex'),
        ),
        paystackRecipientCode: recipient.data.recipient_code,
        verifiedAt: new Date(),
      },
    });
    return {
      bankName: input.bankName,
      accountName: resolved.data.account_name,
      accountNumberLast4: input.accountNumber.slice(-4),
      verified: true,
    };
  }

  async releaseSellerFunds(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        settlements: true,
        items: {
          include: {
            seller: { include: { payoutAccount: true } },
          },
        },
      },
    });
    if (!order?.adminConfirmedDeliveredAt) {
      throw new BadRequestException(
        'Admin delivery confirmation is required before settlement.',
      );
    }
    const heldEntries = await this.prisma.ledgerEntry.findMany({
      where: { orderId, entryType: 'SELLER_HELD' },
      select: { sellerId: true, amountKobo: true },
    });
    if (!heldEntries.length)
      throw new BadRequestException(
        'No held seller funds were found for this order.',
      );
    const totals = new Map<string, bigint>();
    for (const entry of heldEntries) {
      if (entry.sellerId) {
        totals.set(
          entry.sellerId,
          (totals.get(entry.sellerId) ?? 0n) + entry.amountKobo,
        );
      }
    }

    const results: { sellerId: string; status: string }[] = [];
    for (const [sellerId, amountKobo] of totals) {
      const store = order.items.find(
        (item) => item.sellerId === sellerId,
      )?.seller;
      const recipientCode = store?.payoutAccount?.paystackRecipientCode;
      if (!store || !recipientCode) {
        throw new ConflictException(
          'Every seller must have a verified Paystack payout account before release.',
        );
      }
      let settlement = order.settlements.find(
        (item) => item.sellerId === sellerId,
      );
      if (!settlement) {
        settlement = await this.prisma.sellerSettlement.create({
          data: {
            orderId,
            sellerId,
            amountKobo,
            reference: `omz_settle_${randomUUID().replaceAll('-', '')}`,
          },
        });
      }
      if (settlement.status === SellerSettlementStatus.SUCCESS) {
        results.push({ sellerId, status: 'SUCCESS' });
        continue;
      }
      if (settlement.status === SellerSettlementStatus.PROCESSING) {
        results.push({ sellerId, status: 'PROCESSING' });
        continue;
      }
      const response = await this.paystack<{
        reference: string;
        transfer_code: string;
        status: string;
      }>(
        '/transfer',
        {
          source: 'balance',
          amount: settlement.amountKobo.toString(),
          recipient: recipientCode,
          reason: `OpenMarketz order ${order.orderNumber} seller settlement`,
          reference: settlement.reference,
        },
        this.requireSecret(),
      );
      const success = response.data.status === 'success';
      await this.prisma.sellerSettlement.update({
        where: { id: settlement.id },
        data: {
          status: success
            ? SellerSettlementStatus.SUCCESS
            : SellerSettlementStatus.PROCESSING,
          transferCode: response.data.transfer_code,
          failureReason: null,
        },
      });
      if (success)
        await this.recordSellerPayout(orderId, sellerId, settlement.amountKobo);
      results.push({ sellerId, status: success ? 'SUCCESS' : 'PROCESSING' });
    }
    return { orderId, settlements: results };
  }

  private async markFailed(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
      include: { order: { include: { items: true } } },
    });
    if (!payment || !payment.order || payment.status === PaymentStatus.SUCCESS)
      return;
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { id: payment.id, status: { not: PaymentStatus.SUCCESS } },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: 'Paystack reported a failed charge.',
        },
      });
      const activePayment = await tx.payment.findFirst({
        where: {
          orderId: payment.orderId,
          id: { not: payment.id },
          status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING] },
        },
        select: { id: true },
      });
      if (activePayment || payment.order!.status !== 'PENDING_PAYMENT') return;
      await tx.order.update({
        where: { id: payment.orderId! },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      for (const item of payment.order!.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    });
  }

  private async applyTransferEvent(reference: string, success: boolean) {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { reference },
    });
    if (!settlement) return;
    if (settlement.status === SellerSettlementStatus.SUCCESS) return;
    await this.prisma.sellerSettlement.update({
      where: { id: settlement.id },
      data: {
        status: success
          ? SellerSettlementStatus.SUCCESS
          : SellerSettlementStatus.FAILED,
        failureReason: success
          ? null
          : 'Paystack reported that the transfer failed.',
      },
    });
    if (success) {
      await this.recordSellerPayout(
        settlement.orderId,
        settlement.sellerId,
        settlement.amountKobo,
      );
    }
  }

  private async recordSellerPayout(
    orderId: string,
    sellerId: string,
    amountKobo: bigint,
  ) {
    const existing = await this.prisma.ledgerEntry.findFirst({
      where: { orderId, sellerId, entryType: 'SELLER_PAID' },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.ledgerEntry.create({
      data: {
        orderId,
        sellerId,
        entryType: 'SELLER_PAID',
        amountKobo,
      },
    });
  }

  private encrypt(value: string, key: Buffer) {
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

  private async verifyAndApply(reference: string) {
    const secret = this.requireSecret();
    const verified = await this.paystack<PaystackTransaction>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      undefined,
      secret,
      'GET',
    );
    const transaction = verified.data;
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
      include: {
        order: {
          include: {
            items: {
              select: {
                sellerId: true,
                quantity: true,
                unitPriceKobo: true,
                seller: { select: { ownerId: true } },
              },
            },
          },
        },
        giftContribution: {
          select: {
            id: true,
            wishlistId: true,
            wishlist: { select: { ownerId: true, name: true } },
          },
        },
      },
    });
    if (!payment || !payment.order)
      throw new NotFoundException('Payment not found.');
    if (transaction.reference !== payment.reference) {
      throw new BadRequestException('Payment reference does not match.');
    }
    if (transaction.status !== 'success') {
      return { reference, status: transaction.status };
    }
    if (
      BigInt(transaction.amount) !== payment.amountKobo ||
      transaction.currency !== payment.currency
    ) {
      throw new BadRequestException(
        'The verified payment amount does not match the order.',
      );
    }
    if (payment.status === PaymentStatus.SUCCESS) {
      return { reference, status: 'success' };
    }
    if (
      payment.status === PaymentStatus.REFUND_PENDING ||
      payment.failureReason === 'LATE_PAYMENT_REFUND_REQUESTED'
    ) {
      return { reference, status: 'refund_pending' };
    }

    const authorization = transaction.authorization;
    const result = await this.prisma.$transaction(async (tx) => {
      const orderUpdated = await tx.order.updateMany({
        where: { id: payment.orderId!, status: 'PENDING_PAYMENT' },
        data: { status: 'PLACED', paidAt: new Date() },
      });
      if (orderUpdated.count !== 1) {
        const currentOrder = await tx.order.findUnique({
          where: { id: payment.orderId! },
          select: { status: true },
        });
        if (currentOrder?.status === 'CANCELLED') {
          await tx.payment.updateMany({
            where: {
              id: payment.id,
              status: {
                in: [
                  PaymentStatus.INITIALIZED,
                  PaymentStatus.PENDING,
                  PaymentStatus.ABANDONED,
                ],
              },
            },
            data: {
              status: PaymentStatus.ABANDONED,
              providerTransactionId: String(transaction.id),
              failureReason: 'LATE_PAYMENT_REFUND_PENDING',
            },
          });
          return 'late' as const;
        }
        return 'already-applied' as const;
      }
      const updated = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: PaymentStatus.SUCCESS } },
        data: {
          status: PaymentStatus.SUCCESS,
          providerTransactionId: String(transaction.id),
          verifiedAt: new Date(),
        },
      });
      if (updated.count !== 1)
        throw new ConflictException('This payment has already changed.');
      await tx.shipment.create({ data: { orderId: payment.orderId! } });

      const itemSubtotal = payment.order!.subtotalKobo;
      const serviceFee = payment.order!.serviceFeeKobo;
      const sellerTotals = new Map<string, bigint>();
      for (const item of payment.order!.items) {
        sellerTotals.set(
          item.sellerId,
          (sellerTotals.get(item.sellerId) ?? 0n) +
            item.unitPriceKobo * BigInt(item.quantity),
        );
      }
      let feeAllocated = 0n;
      const totals = [...sellerTotals.entries()];
      for (const [index, [sellerId, amount]] of totals.entries()) {
        const feeShare =
          index === totals.length - 1
            ? serviceFee - feeAllocated
            : (serviceFee * amount) / itemSubtotal;
        feeAllocated += feeShare;
        await tx.ledgerEntry.createMany({
          data: [
            {
              paymentId: payment.id,
              orderId: payment.orderId,
              sellerId,
              entryType: 'SELLER_HELD',
              amountKobo: amount - feeShare,
            },
            {
              paymentId: payment.id,
              orderId: payment.orderId,
              sellerId,
              entryType: 'PLATFORM_FEE',
              amountKobo: feeShare,
            },
          ],
        });
      }
      if (payment.order!.deliveryFeeKobo > 0n) {
        await tx.ledgerEntry.create({
          data: {
            paymentId: payment.id,
            orderId: payment.orderId,
            entryType: 'DELIVERY_COLLECTED',
            amountKobo: payment.order!.deliveryFeeKobo,
          },
        });
      }
      if (
        payment.metadata &&
        typeof payment.metadata === 'object' &&
        'saveCard' in payment.metadata &&
        payment.metadata.saveCard === true &&
        authorization?.authorization_code &&
        authorization.signature &&
        authorization.last4 &&
        authorization.exp_month &&
        authorization.exp_year &&
        authorization.reusable
      ) {
        await tx.savedPaymentMethod.upsert({
          where: { authorizationCode: authorization.authorization_code },
          create: {
            userId: payment.order!.buyerId,
            authorizationCode: authorization.authorization_code,
            signature: authorization.signature,
            cardType: authorization.card_type,
            last4: authorization.last4,
            expMonth: authorization.exp_month,
            expYear: authorization.exp_year,
            bank: authorization.bank,
            reusable: true,
          },
          update: { active: true, reusable: true },
        });
      }
      if (payment.giftContribution) {
        await tx.giftContribution.updateMany({
          where: {
            id: payment.giftContribution.id,
            status: 'PENDING',
          },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }
      return 'applied' as const;
    });
    if (result === 'late') {
      await this.refundLatePayment(payment.id);
      const refreshed = await this.prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: { status: true },
      });
      return {
        reference,
        status:
          refreshed.status === PaymentStatus.REFUNDED
            ? 'refunded'
            : 'refund_pending',
      };
    }
    if (result === 'applied') {
      await Promise.all([
        this.notifications.create(
          payment.order.buyerId,
          'ORDER',
          `Order ${payment.order.orderNumber} paid`,
          'Your payment was verified and your order is being prepared.',
          `/orders/${payment.order.id}`,
        ),
        ...[
          ...new Set(payment.order.items.map((item) => item.seller.ownerId)),
        ].map((sellerUserId) =>
          this.notifications.create(
            sellerUserId,
            'ORDER',
            'A new order was paid',
            `Order ${payment.order!.orderNumber} is ready for fulfillment.`,
            '/seller/orders',
          ),
        ),
        ...(payment.giftContribution
          ? [
              this.notifications.create(
                payment.giftContribution.wishlist.ownerId,
                'WISHLIST',
                `A gift was paid for "${payment.giftContribution.wishlist.name}"`,
                'A gift contribution has been paid and is being prepared for delivery.',
                '/wishlist',
              ),
            ]
          : []),
      ]);
    }
    return { reference, status: 'success' };
  }

  async retryLatePaymentRefunds() {
    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.ABANDONED,
        failureReason: 'LATE_PAYMENT_REFUND_PENDING',
        providerTransactionId: { not: null },
        order: { status: 'CANCELLED' },
      },
      select: { id: true },
      take: 50,
      orderBy: { updatedAt: 'asc' },
    });
    for (const payment of payments) {
      await this.refundLatePayment(payment.id);
    }
    return { retried: payments.length };
  }

  private async refundLatePayment(paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        status: PaymentStatus.ABANDONED,
        failureReason: 'LATE_PAYMENT_REFUND_PENDING',
        providerTransactionId: { not: null },
      },
      select: {
        id: true,
        reference: true,
        providerTransactionId: true,
        amountKobo: true,
        order: { select: { buyerId: true, orderNumber: true } },
      },
    });
    if (!payment?.providerTransactionId || !payment.order) return false;
    const claimed = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.ABANDONED,
        failureReason: 'LATE_PAYMENT_REFUND_PENDING',
      },
      data: { status: PaymentStatus.REFUND_PENDING },
    });
    if (claimed.count !== 1) return false;
    try {
      await this.paystack<{ status: string }>(
        '/refund',
        {
          transaction: payment.providerTransactionId,
          amount: payment.amountKobo.toString(),
        },
        this.requireSecret(),
      );
      const updated = await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.REFUND_PENDING,
        },
        data: { failureReason: 'LATE_PAYMENT_REFUND_REQUESTED' },
      });
      if (updated.count) {
        await this.notifications.create(
          payment.order.buyerId,
          'ORDER',
          'Late payment refund requested',
          `Payment for cancelled order ${payment.order.orderNumber} arrived after the order expired. Paystack accepted a refund request for processing.`,
          '/orders',
        );
      }
      return updated.count === 1;
    } catch (error) {
      console.error(
        `Paystack refund retry failed for payment ${payment.reference}.`,
        error,
      );
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.REFUND_PENDING },
        data: { status: PaymentStatus.ABANDONED },
      });
      return false;
    }
  }

  private async chargeSavedMethod(
    userId: string,
    order: {
      id: string;
      totalKobo: bigint;
      currency: string;
      buyer: { email: string };
    },
    payment: { id: string; reference: string },
    methodId: string,
    secret: string,
  ) {
    const method = await this.prisma.savedPaymentMethod.findFirst({
      where: { id: methodId, userId, active: true, reusable: true },
    });
    if (!method) throw new NotFoundException('Saved payment method not found.');
    const response = await this.paystack<{
      status: string;
      reference: string;
      display_text?: string;
    }>(
      '/transaction/charge_authorization',
      {
        authorization_code: method.authorizationCode,
        email: order.buyer.email,
        amount: order.totalKobo.toString(),
        currency: order.currency,
        reference: payment.reference,
        metadata: { order_id: order.id, user_id: userId },
      },
      secret,
    );
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.PENDING,
        authorizationUrl: response.data.display_text ?? null,
        metadata: {
          ...((
            await this.prisma.payment.findUniqueOrThrow({
              where: { id: payment.id },
              select: { metadata: true },
            })
          ).metadata as Prisma.InputJsonObject),
          challengeStatus: response.data.status,
        },
      },
    });
    if (response.data.status === 'success') {
      await this.verifyAndApply(payment.reference);
    }
    await this.prisma.savedPaymentMethod.update({
      where: { id: method.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      reference: payment.reference,
      authorizationUrl: response.data.display_text ?? null,
      status: response.data.status,
      amount: Number(order.totalKobo / 100n),
      currency: order.currency,
    };
  }

  private async paystack<T>(
    path: string,
    body: Record<string, unknown> | undefined,
    secret: string,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<PaystackResponse<T>> {
    const response = await fetch(`https://api.paystack.co${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = (await response.json().catch(() => undefined)) as
      PaystackResponse<T> | undefined;
    if (!response.ok || !payload?.status) {
      throw new BadGatewayException(
        'Paystack could not complete this payment request. Please try again.',
      );
    }
    return payload;
  }

  private requireSecret() {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new ServiceUnavailableException(
        'Paystack payments are not configured.',
      );
    }
    return secret;
  }

  private callbackUrl(orderId: string, reference: string, gift = false) {
    const configured = this.config.get<string>('PAYSTACK_CALLBACK_URL');
    if (!configured) return undefined;
    const callback = new URL(configured);
    callback.searchParams.set('order', orderId);
    callback.searchParams.set('reference', reference);
    if (gift) callback.searchParams.set('gift', '1');
    return callback.toString();
  }
}
