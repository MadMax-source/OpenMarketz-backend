import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: { include: { product: { include: { seller: true } } } },
      },
    });
    if (!cart) return { items: [], subtotal: 0, currency: 'NGN' };
    const items = cart.items
      .filter((item) => item.product.status === ProductStatus.ACTIVE)
      .map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        options: item.options,
        product: {
          id: item.product.id,
          slug: item.product.slug,
          name: item.product.name,
          price: Number(item.product.priceKobo / 100n),
          stock: item.product.stock,
          seller: {
            id: item.product.seller.id,
            name: item.product.seller.name,
            slug: item.product.seller.slug,
          },
        },
        lineTotal: Number(item.product.priceKobo / 100n) * item.quantity,
      }));
    return {
      id: cart.id,
      items,
      subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
      currency: 'NGN',
      updatedAt: cart.updatedAt,
    };
  }

  async upsertItem(userId: string, input: UpdateCartItemDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: input.productId,
        status: ProductStatus.ACTIVE,
        seller: { active: true },
      },
      select: { id: true, stock: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    if (input.quantity > product.stock) {
      throw new BadRequestException('The requested quantity is not available.');
    }

    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      const options = (input.options ?? {}) as Prisma.InputJsonValue;
      const candidates = await tx.cartItem.findMany({
        where: { cartId: cart.id, productId: product.id },
        select: { id: true, options: true },
      });
      const optionsKey = JSON.stringify(options);
      const existing = candidates.find(
        (candidate) => JSON.stringify(candidate.options) === optionsKey,
      );
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: input.quantity },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            productId: product.id,
            quantity: input.quantity,
            options,
          },
        });
      }
    });
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Cart item not found.');
    await this.prisma.cartItem.delete({ where: { id: item.id } });
    return this.getCart(userId);
  }

  async clear(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { cart: { userId } } });
    return { success: true };
  }
}
