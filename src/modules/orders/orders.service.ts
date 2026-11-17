import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  FulfilmentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ProductStatus,
  UserRole,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { UpdateShipmentDto } from './dto/update-shipment.dto.js';

const serviceFeeBasisPoints = 150;
const orderInclude = {
  items: {
    include: {
      product: { select: { id: true, slug: true, name: true } },
      seller: { select: { id: true, name: true, slug: true, ownerId: true } },
    },
  },
  payments: {
    select: {
      id: true,
      reference: true,
      status: true,
      amountKobo: true,
      currency: true,
      authorizationUrl: true,
      verifiedAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  shipments: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private expiryTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    void this.expirePendingOrders().catch((error) =>
      console.error('Unable to expire pending orders during startup.', error),
    );
    this.expiryTimer = setInterval(() => {
      void this.expirePendingOrders().catch((error) =>
        console.error('Unable to expire pending orders.', error),
      );
    }, 60_000);
    this.expiryTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  async expirePendingOrders() {
    const ttlMinutes = this.config.get<number>('PENDING_ORDER_TTL_MINUTES', 30);
    const expiredBefore = new Date(Date.now() - ttlMinutes * 60_000);
    const candidates = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: { lt: expiredBefore },
        payments: { none: { status: PaymentStatus.SUCCESS } },
      },
      select: { id: true },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    let expired = 0;
    for (const candidate of candidates) {
      const buyerId = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirst({
          where: {
            id: candidate.id,
            status: OrderStatus.PENDING_PAYMENT,
            createdAt: { lt: expiredBefore },
            payments: { none: { status: PaymentStatus.SUCCESS } },
          },
          include: { items: true },
        });
        if (!order) return null;
        const updated = await tx.order.updateMany({
          where: { id: order.id, status: OrderStatus.PENDING_PAYMENT },
          data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
        });
        if (updated.count !== 1) return null;
        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            status: { in: [PaymentStatus.INITIALIZED, PaymentStatus.PENDING] },
          },
          data: { status: PaymentStatus.ABANDONED },
        });
        for (const item of order.items) {
          if (item.productId) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }
        return order.buyerId;
      });
      if (!buyerId) continue;
      expired += 1;
      await this.notifications.create(
        buyerId,
        'ORDER',
        'Unpaid order expired',
        'Your unpaid order was cancelled and its reserved stock was released. You can place the order again.',
        '/orders',
      );
    }
    await this.payments.retryLatePaymentRefunds();
    return { expired };
  }

  async checkout(userId: string, input: CheckoutDto) {
    const address = await this.prisma.address.findFirst({
      where: { id: input.addressId, userId },
    });
    if (!address)
      throw new NotFoundException('Choose one of your saved addresses.');
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: { include: { product: { include: { seller: true } } } },
      },
    });
    if (!cart?.items.length)
      throw new BadRequestException('Your cart is empty.');

    const deliveryMethod = input.deliveryMethod ?? 'standard';
    const deliveryFeeKobo = this.getDeliveryFeeKobo(
      address.state,
      address.area ?? address.city,
      deliveryMethod,
    );
    const created = await this.prisma.$transaction(async (tx) => {
      const currentItems = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        include: { product: { include: { seller: true } } },
      });
      if (!currentItems.length)
        throw new BadRequestException('Your cart is empty.');
      let subtotalKobo = 0n;
      const itemData: Prisma.OrderItemCreateWithoutOrderInput[] = [];
      for (const item of currentItems) {
        const product = item.product;
        if (product.status !== ProductStatus.ACTIVE || !product.seller.active) {
          throw new ConflictException(
            `${product.name} is no longer available.`,
          );
        }

        const reserved = await tx.product.updateMany({
          where: {
            id: product.id,
            status: ProductStatus.ACTIVE,
            stock: { gte: item.quantity },
          },
          data: { stock: { decrement: item.quantity } },
        });
        if (reserved.count !== 1) {
          throw new ConflictException(
            `There is not enough stock for ${product.name}.`,
          );
        }
        subtotalKobo += product.priceKobo * BigInt(item.quantity);
        itemData.push({
          product: { connect: { id: product.id } },
          seller: { connect: { id: product.sellerId } },
          productName: product.name,
          productSlug: product.slug,
          quantity: item.quantity,
          unitPriceKobo: product.priceKobo,
          options: item.options as Prisma.InputJsonValue,
        });
      }
      const serviceFeeKobo =
        (subtotalKobo * BigInt(serviceFeeBasisPoints) + 5_000n) / 10_000n;
      const totalKobo = subtotalKobo + deliveryFeeKobo + serviceFeeKobo;
      const order = await tx.order.create({
        data: {
          orderNumber: `OMZ-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
          buyerId: userId,
          addressId: address.id,
          currency: 'NGN',
          subtotalKobo,
          deliveryFeeKobo,
          serviceFeeKobo,
          totalKobo,
          status: OrderStatus.PENDING_PAYMENT,
          deliveryMethod,
          addressSnapshot: {
            fullName: address.fullName,
            phone: address.phone,
            line1: address.line1,
            city: address.city,
            state: address.state,
            country: address.country,
            landmark: address.landmark,
            latitude: address.latitude,
            longitude: address.longitude,
          },
          items: { create: itemData },
        },
        select: { id: true },
      });
      return order;
    });

    let payment: Awaited<ReturnType<PaymentsService['initializeOrder']>>;
    try {
      payment = await this.payments.initializeOrder(userId, created.id, {
        saveCard: input.saveCard,
        savedPaymentMethodId: input.savedPaymentMethodId,
      });
    } catch (error) {
      await this.releaseUnpaidOrder(created.id);
      throw error;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const item of cart.items) {
          const current = await tx.cartItem.findFirst({
            where: { id: item.id, cartId: cart.id, quantity: item.quantity },
            select: { id: true, options: true },
          });
          if (
            current &&
            JSON.stringify(current.options) === JSON.stringify(item.options)
          ) {
            await tx.cartItem.delete({ where: { id: current.id } });
          }
        }
      });
    } catch (error) {
      console.error(
        'Payment initialized but the completed cart could not be cleared.',
        error,
      );
    }
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: created.id },
      include: orderInclude,
    });
    return { order: this.toOrder(order), payment };
  }

  async checkoutMarketResponse(
    userId: string,
    responseId: string,
    input: CheckoutDto,
  ) {
    const address = await this.prisma.address.findFirst({
      where: { id: input.addressId, userId },
    });
    if (!address)
      throw new NotFoundException('Choose one of your saved addresses.');
    const response = await this.prisma.marketResponse.findFirst({
      where: {
        id: responseId,
        status: 'ACCEPTED',
        request: { buyerId: userId, status: 'ACCEPTED' },
      },
      include: {
        request: { select: { title: true, quantity: true } },
        product: {
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
            stock: true,
            seller: { select: { id: true, active: true } },
          },
        },
        seller: { select: { id: true, active: true } },
      },
    });
    if (!response) throw new NotFoundException('Accepted offer not found.');
    if (!response.seller.active)
      throw new ConflictException('This seller is no longer available.');
    if (response.product && response.product.status !== ProductStatus.ACTIVE) {
      throw new ConflictException('The linked product is no longer available.');
    }

    let order = await this.prisma.order.findUnique({
      where: { marketResponseId: response.id },
      include: { items: true },
    });
    const deliveryMethod = input.deliveryMethod ?? 'standard';
    const deliveryFeeKobo = this.getDeliveryFeeKobo(
      address.state,
      address.area ?? address.city,
      deliveryMethod,
    );
    if (order?.status === OrderStatus.CANCELLED) {
      order = await this.prisma.$transaction(async (tx) => {
        if (response.productId) {
          const reserved = await tx.product.updateMany({
            where: {
              id: response.productId,
              status: ProductStatus.ACTIVE,
              stock: { gte: response.request.quantity },
            },
            data: { stock: { decrement: response.request.quantity } },
          });
          if (reserved.count !== 1)
            throw new ConflictException(
              'There is not enough stock to retry this offer.',
            );
        }
        return tx.order.update({
          where: { id: order!.id, status: OrderStatus.CANCELLED },
          data: {
            status: OrderStatus.PENDING_PAYMENT,
            cancelledAt: null,
            addressId: address.id,
            deliveryMethod,
            deliveryFeeKobo,
            serviceFeeKobo:
              (response.priceKobo * BigInt(serviceFeeBasisPoints) + 5_000n) /
              10_000n,
            subtotalKobo: response.priceKobo,
            totalKobo:
              response.priceKobo +
              deliveryFeeKobo +
              (response.priceKobo * BigInt(serviceFeeBasisPoints) + 5_000n) /
                10_000n,
            addressSnapshot: {
              fullName: address.fullName,
              phone: address.phone,
              line1: address.line1,
              city: address.city,
              state: address.state,
              country: address.country,
              landmark: address.landmark,
              latitude: address.latitude,
              longitude: address.longitude,
            },
          },
          include: { items: true },
        });
      });
    }

    if (!order) {
      const serviceFeeKobo =
        (response.priceKobo * BigInt(serviceFeeBasisPoints) + 5_000n) / 10_000n;
      const unitPriceKobo =
        response.priceKobo / BigInt(response.request.quantity);
      const remainder = response.priceKobo % BigInt(response.request.quantity);
      order = await this.prisma.$transaction(async (tx) => {
        if (response.productId) {
          const reserved = await tx.product.updateMany({
            where: {
              id: response.productId,
              status: ProductStatus.ACTIVE,
              stock: { gte: response.request.quantity },
            },
            data: { stock: { decrement: response.request.quantity } },
          });
          if (reserved.count !== 1)
            throw new ConflictException(
              'There is not enough stock to fulfill this offer.',
            );
        }
        return tx.order.create({
          data: {
            orderNumber: `OMZ-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
            buyerId: userId,
            addressId: address.id,
            marketResponseId: response.id,
            currency: 'NGN',
            subtotalKobo: response.priceKobo,
            deliveryFeeKobo,
            serviceFeeKobo,
            totalKobo: response.priceKobo + deliveryFeeKobo + serviceFeeKobo,
            status: OrderStatus.PENDING_PAYMENT,
            deliveryMethod,
            addressSnapshot: {
              fullName: address.fullName,
              phone: address.phone,
              line1: address.line1,
              city: address.city,
              state: address.state,
              country: address.country,
              landmark: address.landmark,
              latitude: address.latitude,
              longitude: address.longitude,
            },
            items: {
              create: Array.from(
                { length: response.request.quantity },
                (_, index) => ({
                  productId: response.productId,
                  sellerId: response.sellerId,
                  productName: response.product?.name ?? response.request.title,
                  productSlug: response.product?.slug ?? '',
                  quantity: 1,
                  unitPriceKobo:
                    unitPriceKobo + (BigInt(index) < remainder ? 1n : 0n),
                  options: { marketResponseId: response.id },
                }),
              ),
            },
          },
          include: { items: true },
        });
      });
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        'This accepted offer already has a paid order.',
      );
    }
    const payment = await this.payments.initializeOrder(userId, order.id, {
      saveCard: input.saveCard,
      savedPaymentMethodId: input.savedPaymentMethodId,
      metadata: { marketResponseId: response.id },
    });
    const fullOrder = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: orderInclude,
    });
    return { order: this.toOrder(fullOrder), payment };
  }

  async quote(
    userId: string,
    input: {
      addressId: string;
      deliveryMethod: 'standard' | 'express' | 'pickup';
    },
  ) {
    const address = await this.prisma.address.findFirst({
      where: { id: input.addressId, userId },
      select: { state: true, city: true, area: true },
    });
    if (!address)
      throw new NotFoundException('Choose one of your saved addresses.');
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: { include: { product: { select: { priceKobo: true } } } },
      },
    });
    const subtotalKobo = (cart?.items ?? []).reduce(
      (sum, item) => sum + item.product.priceKobo * BigInt(item.quantity),
      0n,
    );
    const deliveryFeeKobo = this.getDeliveryFeeKobo(
      address.state,
      address.area ?? address.city,
      input.deliveryMethod,
    );
    const serviceFeeKobo =
      (subtotalKobo * BigInt(serviceFeeBasisPoints) + 5_000n) / 10_000n;
    return {
      subtotal: Number(subtotalKobo / 100n),
      deliveryFee: Number(deliveryFeeKobo / 100n),
      serviceFee: Number(serviceFeeKobo / 100n),
      total: Number((subtotalKobo + deliveryFeeKobo + serviceFeeKobo) / 100n),
      currency: 'NGN',
    };
  }

  async quoteMarketResponse(
    userId: string,
    responseId: string,
    input: {
      addressId: string;
      deliveryMethod: 'standard' | 'express' | 'pickup';
    },
  ) {
    const [address, response] = await Promise.all([
      this.prisma.address.findFirst({
        where: { id: input.addressId, userId },
        select: { state: true, city: true, area: true },
      }),
      this.prisma.marketResponse.findFirst({
        where: {
          id: responseId,
          status: 'ACCEPTED',
          request: { buyerId: userId, status: 'ACCEPTED' },
        },
        select: { priceKobo: true },
      }),
    ]);
    if (!address)
      throw new NotFoundException('Choose one of your saved addresses.');
    if (!response) throw new NotFoundException('Accepted offer not found.');
    const deliveryFeeKobo = this.getDeliveryFeeKobo(
      address.state,
      address.area ?? address.city,
      input.deliveryMethod,
    );
    const serviceFeeKobo =
      (response.priceKobo * BigInt(serviceFeeBasisPoints) + 5_000n) / 10_000n;
    return {
      subtotal: Number(response.priceKobo / 100n),
      deliveryFee: Number(deliveryFeeKobo / 100n),
      serviceFee: Number(serviceFeeKobo / 100n),
      total: Number(
        (response.priceKobo + deliveryFeeKobo + serviceFeeKobo) / 100n,
      ),
      currency: 'NGN',
    };
  }

  async listBuyerOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { buyerId: userId },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { items: orders.map((order) => this.toOrder(order)) };
  }

  async listSellerOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { items: { some: { seller: { ownerId: userId } } } },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: orders.map((order) => this.toOrder(order, userId)),
    };
  }

  async getOrder(user: AuthenticatedUser, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Order not found.');
    const isSeller = order.items.some(
      (item) => item.seller.ownerId === user.id,
    );
    if (
      order.buyerId !== user.id &&
      !isSeller &&
      user.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('You cannot view this order.');
    }
    return this.toOrder(order, isSeller ? user.id : undefined);
  }

  async updateShipment(
    userId: string,
    orderId: string,
    input: UpdateShipmentDto,
  ) {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        orderId,
        order: { items: { some: { seller: { ownerId: userId } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!shipment) throw new NotFoundException('Paid seller order not found.');
    const transitions: Record<FulfilmentStatus, FulfilmentStatus[]> = {
      AWAITING_DISPATCH: [FulfilmentStatus.PACKED],
      PACKED: [FulfilmentStatus.HANDED_OVER],
      HANDED_OVER: [FulfilmentStatus.IN_TRANSIT],
      IN_TRANSIT: [],
      DELIVERED: [],
      CANCELLED: [],
    };
    const next = input.status as FulfilmentStatus;
    if (!transitions[shipment.status].includes(next)) {
      throw new ConflictException(
        'This shipment status transition is not allowed.',
      );
    }
    const updated = await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: next,
        method: input.method,
        hub: input.hub,
        carrier: input.carrier,
        waybill: input.waybill,
        trackingUrl: input.trackingUrl,
        handedOverAt:
          next === FulfilmentStatus.HANDED_OVER ? new Date() : undefined,
      },
    });
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: shipment.orderId },
      select: { buyerId: true, orderNumber: true },
    });
    await this.notifications.create(
      order.buyerId,
      'ORDER',
      `Delivery update for ${order.orderNumber}`,
      `Your order is now ${next.toLowerCase().replaceAll('_', ' ')}.`,
      `/orders/${shipment.orderId}`,
    );
    return updated;
  }

  async markDeliveredByAdmin(orderId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    if (!shipment || shipment.status !== FulfilmentStatus.IN_TRANSIT) {
      throw new ConflictException(
        'Only an in-transit shipment can be marked delivered.',
      );
    }
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { buyerId: true, orderNumber: true },
    });
    await this.prisma.$transaction([
      this.prisma.shipment.update({
        where: { id: shipment.id },
        data: { status: FulfilmentStatus.DELIVERED, deliveredAt: new Date() },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.OUT_FOR_DELIVERY },
      }),
    ]);
    await this.notifications.create(
      order.buyerId,
      'ORDER',
      `Order ${order.orderNumber} delivered`,
      'Your delivery was marked as delivered. Please confirm receipt in your order history.',
      `/orders/${orderId}`,
    );
    return { success: true };
  }

  async confirmBuyerDelivery(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: userId },
      include: {
        shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
        items: { include: { seller: { select: { ownerId: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.shipments[0]?.status !== FulfilmentStatus.DELIVERED) {
      throw new ConflictException(
        'Delivery must be recorded before confirming receipt.',
      );
    }
    const confirmedAt = new Date();
    const confirmation = await this.prisma.order.updateMany({
      where: { id: orderId, buyerId: userId, buyerConfirmedDeliveredAt: null },
      data: { buyerConfirmedDeliveredAt: confirmedAt },
    });
    if (confirmation.count) {
      await Promise.all(
        [...new Set(order.items.map((item) => item.seller.ownerId))].map(
          (sellerUserId) =>
            this.notifications.create(
              sellerUserId,
              'ORDER',
              'Buyer confirmed delivery',
              'The buyer confirmed receipt. Admin confirmation is still required before settlement.',
              `/seller/orders`,
            ),
        ),
      );
    }
    return { success: true };
  }

  async confirmAdminDelivery(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shipments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (
      (order.status !== OrderStatus.PLACED &&
        order.status !== OrderStatus.OUT_FOR_DELIVERY) ||
      !order.buyerConfirmedDeliveredAt ||
      order.shipments[0]?.status !== FulfilmentStatus.DELIVERED
    ) {
      throw new ConflictException(
        'Buyer confirmation and delivered status are required.',
      );
    }
    if (!order.adminConfirmedDeliveredAt) {
      const updated = await this.prisma.order.updateMany({
        where: { id: orderId, adminConfirmedDeliveredAt: null },
        data: {
          adminConfirmedDeliveredAt: new Date(),
          status: OrderStatus.DELIVERED,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Delivery has already been confirmed.');
      }
    }
    const settlements = await this.payments.releaseSellerFunds(orderId);
    return { success: true, settlements };
  }

  async cancelUnpaidOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: userId },
      include: {
        items: true,
        payments: { select: { id: true, status: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        'Only an unpaid order can be cancelled here.',
      );
    }
    if (order.payments.some((payment) => payment.status === 'SUCCESS')) {
      throw new ConflictException(
        'A paid order cannot be cancelled through this endpoint.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: {
          id: orderId,
          buyerId: userId,
          status: OrderStatus.PENDING_PAYMENT,
        },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (result.count !== 1)
        throw new ConflictException('The order has already changed.');
      await tx.payment.updateMany({
        where: { orderId, status: { in: ['INITIALIZED', 'PENDING'] } },
        data: { status: 'ABANDONED' },
      });
      for (const item of order.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
          const cart = await tx.cart.upsert({
            where: { userId },
            create: { userId },
            update: {},
          });
          const candidates = await tx.cartItem.findMany({
            where: { cartId: cart.id, productId: item.productId },
            select: { id: true, quantity: true, options: true },
          });
          const existing = candidates.find(
            (candidate) =>
              JSON.stringify(candidate.options) ===
              JSON.stringify(item.options),
          );
          if (existing) {
            await tx.cartItem.update({
              where: { id: existing.id },
              data: { quantity: existing.quantity + item.quantity },
            });
          } else {
            await tx.cartItem.create({
              data: {
                cartId: cart.id,
                productId: item.productId,
                quantity: item.quantity,
                options: item.options as Prisma.InputJsonValue,
              },
            });
          }
        }
      }
    });
    return { success: true };
  }

  private async releaseUnpaidOrder(orderId: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, status: OrderStatus.PENDING_PAYMENT },
        include: { items: true },
      });
      if (!order) return;
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
      });
      for (const item of order.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    });
  }

  getDeliveryFeeKobo(state: string, area: string, method: string): bigint {
    if (method === 'pickup') return 0n;
    if (!/abuja|federal capital territory|fct/i.test(state)) {
      const base = 350_000n;
      return method === 'express' ? (base * 3n) / 2n : base;
    }
    const location = `${area} ${state}`.toLowerCase();
    const zones: [RegExp, bigint][] = [
      [/\bapo\b/, 100_000n],
      [/\bgarki\b/, 150_000n],
      [/\bwuse\b/, 200_000n],
      [/\basokoro\b/, 200_000n],
      [/\blugbe\b/, 200_000n],
      [/\bjabi\b/, 220_000n],
      [/\bmaitama\b/, 250_000n],
      [/\bgwarinpa\b/, 300_000n],
      [/\bkubwa\b/, 350_000n],
    ];
    const fee =
      zones.find(([pattern]) => pattern.test(location))?.[1] ?? 350_000n;
    return method === 'express' ? (fee * 3n) / 2n : fee;
  }

  private toOrder(
    order: Prisma.OrderGetPayload<{ include: typeof orderInclude }>,
    sellerUserId?: string,
  ) {
    const items = order.items
      .filter((item) => !sellerUserId || item.seller.ownerId === sellerUserId)
      .map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        productSlug: item.productSlug,
        quantity: item.quantity,
        unitPrice: Number(item.unitPriceKobo / 100n),
        lineTotal: Number((item.unitPriceKobo * BigInt(item.quantity)) / 100n),
        options: item.options,
        seller: {
          id: item.seller.id,
          name: item.seller.name,
          slug: item.seller.slug,
        },
      }));
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      subtotal: Number(order.subtotalKobo / 100n),
      deliveryFee: Number(order.deliveryFeeKobo / 100n),
      serviceFee: Number(order.serviceFeeKobo / 100n),
      total: Number(order.totalKobo / 100n),
      deliveryMethod: order.deliveryMethod,
      address: order.addressSnapshot,
      items,
      payments: order.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amountKobo / 100n),
        amountKobo: undefined,
      })),
      shipment: order.shipments[0] ?? null,
      buyerConfirmedDeliveredAt: order.buyerConfirmedDeliveredAt,
      adminConfirmedDeliveredAt: order.adminConfirmedDeliveredAt,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
    };
  }
}
