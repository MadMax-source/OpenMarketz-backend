import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaPurpose,
  MediaVisibility,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { ListProductsDto } from './dto/list-products.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';

const productInclude = {
  category: { select: { slug: true, name: true } },
  seller: {
    select: {
      id: true,
      slug: true,
      name: true,
      verified: true,
      location: true,
      rating: true,
      reviewCount: true,
    },
  },
  media: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      media: {
        select: {
          id: true,
          secureUrl: true,
          resourceType: true,
          purpose: true,
          visibility: true,
        },
      },
    },
  },
  variants: { select: { id: true, name: true, options: true } },
};

type ProductRecord = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories() {
    return this.prisma.category.findMany({
      where: { active: true },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listPublicProducts(query: ListProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
      seller: { active: true },
      ...(query.category
        ? { category: { slug: query.category.toLowerCase(), active: true } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q.trim(), mode: 'insensitive' } },
              { brand: { contains: query.q.trim(), mode: 'insensitive' } },
              {
                description: { contains: query.q.trim(), mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };

    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: products.map((product) => this.toPublicProduct(product)),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  async getPublicProduct(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        slug,
        status: ProductStatus.ACTIVE,
        seller: { active: true },
      },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found.');
    return this.toPublicProduct(product);
  }

  async listSellerProducts(userId: string, query: ListProductsDto) {
    const store = await this.requireSellerStore(userId);
    const where: Prisma.ProductWhereInput = {
      sellerId: store.id,
      ...(query.category
        ? { category: { slug: query.category.toLowerCase() } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q.trim(), mode: 'insensitive' } },
              { brand: { contains: query.q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      items: products.map((product) => this.toSellerProduct(product)),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  async createProduct(userId: string, input: CreateProductDto) {
    const store = await this.requireSellerStore(userId);
    this.validatePrices(
      input.price,
      input.compareAt,
      input.minPrice,
      input.negotiable,
    );
    const category = await this.prisma.category.findFirst({
      where: { slug: input.categorySlug.toLowerCase(), active: true },
      select: { id: true },
    });
    if (!category)
      throw new BadRequestException('Choose an active product category.');

    const media = await this.findOwnedProductMedia(userId, input.mediaIds);
    const slug = `${this.slugify(input.name)}-${randomUUID().slice(0, 8)}`;
    const status = input.status ?? ProductStatus.ACTIVE;
    const product = await this.prisma.product.create({
      data: {
        sellerId: store.id,
        categoryId: category.id,
        slug,
        name: input.name.trim(),
        brand: input.brand.trim(),
        description: input.description.trim(),
        highlights: input.highlights.map((value) => value.trim()),
        specifications: input.specifications ?? {},
        condition: input.condition,
        priceKobo: BigInt(input.price) * 100n,
        compareAtKobo:
          input.compareAt === undefined ? null : BigInt(input.compareAt) * 100n,
        minPriceKobo:
          input.negotiable && input.minPrice !== undefined
            ? BigInt(input.minPrice) * 100n
            : null,
        negotiable: input.negotiable,
        stock: input.stock,
        freeDelivery: input.freeDelivery,
        unitLabel: input.unitLabel?.trim(),
        status,
        media: {
          create: media.map((asset, index) => ({
            mediaId: asset.id,
            sortOrder: index,
            role: asset.resourceType,
          })),
        },
        variants: {
          create: (input.variants ?? []).map((variant) => ({
            name: variant.name.trim(),
            options: variant.options.map((option) => option.trim()),
          })),
        },
      },
      include: productInclude,
    });
    return this.toSellerProduct(product);
  }

  async updateProduct(
    userId: string,
    productId: string,
    input: UpdateProductDto,
  ) {
    const store = await this.requireSellerStore(userId);
    const current = await this.prisma.product.findFirst({
      where: { id: productId, sellerId: store.id },
      include: productInclude,
    });
    if (!current) throw new NotFoundException('Product not found.');

    const price = input.price ?? Number(current.priceKobo / 100n);
    const compareAt =
      input.compareAt ??
      (current.compareAtKobo === null
        ? undefined
        : Number(current.compareAtKobo / 100n));
    const negotiable = input.negotiable ?? current.negotiable;
    const minPrice = negotiable
      ? (input.minPrice ??
        (current.minPriceKobo === null
          ? undefined
          : Number(current.minPriceKobo / 100n)))
      : undefined;
    this.validatePrices(price, compareAt, minPrice, negotiable);

    const category = input.categorySlug
      ? await this.prisma.category.findFirst({
          where: { slug: input.categorySlug.toLowerCase(), active: true },
          select: { id: true },
        })
      : null;
    if (input.categorySlug && !category) {
      throw new BadRequestException('Choose an active product category.');
    }

    const media = input.mediaIds
      ? await this.findOwnedProductMedia(userId, input.mediaIds)
      : null;
    const updated = await this.prisma.$transaction(async (transaction) => {
      if (media) {
        await transaction.productMedia.deleteMany({
          where: { productId: productId },
        });
        await transaction.productMedia.createMany({
          data: media.map((asset, index) => ({
            productId,
            mediaId: asset.id,
            sortOrder: index,
            role: asset.resourceType,
          })),
        });
      }
      if (input.variants) {
        await transaction.productVariant.deleteMany({ where: { productId } });
        if (input.variants.length) {
          await transaction.productVariant.createMany({
            data: input.variants.map((variant) => ({
              productId,
              name: variant.name.trim(),
              options: variant.options.map((option) => option.trim()),
            })),
          });
        }
      }
      return transaction.product.update({
        where: { id: productId },
        data: {
          categoryId: category?.id,
          name: input.name?.trim(),
          brand: input.brand?.trim(),
          description: input.description?.trim(),
          highlights: input.highlights?.map((value) => value.trim()),
          specifications: input.specifications,
          condition: input.condition,
          priceKobo:
            input.price === undefined ? undefined : BigInt(input.price) * 100n,
          compareAtKobo:
            input.compareAt === undefined
              ? undefined
              : BigInt(input.compareAt) * 100n,
          minPriceKobo:
            input.negotiable === false
              ? null
              : input.minPrice === undefined
                ? undefined
                : BigInt(input.minPrice) * 100n,
          negotiable: input.negotiable,
          stock: input.stock,
          freeDelivery: input.freeDelivery,
          unitLabel: input.unitLabel?.trim(),
          status: input.status,
        },
        include: productInclude,
      });
    });
    return this.toSellerProduct(updated);
  }

  async archiveProduct(userId: string, productId: string) {
    const store = await this.requireSellerStore(userId);
    const result = await this.prisma.product.updateMany({
      where: { id: productId, sellerId: store.id },
      data: {
        status: ProductStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });
    if (!result.count) throw new NotFoundException('Product not found.');
    return { message: 'Product archived.' };
  }

  private async requireSellerStore(userId: string) {
    const store = await this.prisma.sellerStore.findFirst({
      where: { ownerId: userId, active: true },
    });
    if (!store) {
      throw new ForbiddenException(
        'An approved active seller account is required for this action.',
      );
    }
    return store;
  }

  private async findOwnedProductMedia(userId: string, ids: string[]) {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A media item can only be attached once.');
    }
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: ids },
        ownerId: userId,
        purpose: MediaPurpose.PRODUCT,
        visibility: MediaVisibility.PUBLIC,
        deletedAt: null,
      },
      select: { id: true, resourceType: true },
    });
    if (assets.length !== ids.length) {
      throw new ForbiddenException(
        'Every product image or video must be uploaded to your account first.',
      );
    }
    return ids.map((id) => assets.find((asset) => asset.id === id)!);
  }

  private validatePrices(
    price: number,
    compareAt: number | undefined,
    minPrice: number | undefined,
    negotiable: boolean,
  ): void {
    if (compareAt !== undefined && compareAt <= price) {
      throw new BadRequestException(
        'The original price must be greater than the selling price.',
      );
    }
    if (minPrice !== undefined && (!negotiable || minPrice >= price)) {
      throw new BadRequestException(
        'The private minimum price must be lower than the selling price and bargaining must be enabled.',
      );
    }
  }

  private toPublicProduct(product: ProductRecord) {
    const media = product.media
      .filter(
        (entry) =>
          entry.media.purpose === MediaPurpose.PRODUCT &&
          entry.media.visibility === MediaVisibility.PUBLIC &&
          entry.media.secureUrl,
      )
      .map((entry) => ({
        id: entry.media.id,
        url: entry.media.secureUrl!,
        type: entry.media.resourceType,
      }));
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      category: product.category.slug,
      seller: {
        id: product.seller.id,
        slug: product.seller.slug,
        name: product.seller.name,
        verified: product.seller.verified,
        location: product.seller.location,
        rating: Number(product.seller.rating),
        reviews: product.seller.reviewCount,
      },
      price: Number(product.priceKobo / 100n),
      compareAt:
        product.compareAtKobo === null
          ? undefined
          : Number(product.compareAtKobo / 100n),
      rating: Number(product.averageRating),
      reviews: product.reviewCount,
      sold: product.soldCount,
      stock: product.stock,
      image: media.find((asset) => asset.type === 'image')?.url ?? '',
      gallery: media
        .filter((asset) => asset.type === 'image')
        .map((asset) => asset.url),
      video: media.find((asset) => asset.type === 'video')?.url,
      media,
      freeDelivery: product.freeDelivery,
      description: product.description,
      highlights: product.highlights,
      specs: product.specifications,
      variants: product.variants,
      negotiable: product.negotiable,
      condition: product.condition,
      unitLabel: product.unitLabel ?? undefined,
      createdAt: product.createdAt,
    };
  }

  private toSellerProduct(product: ProductRecord) {
    return {
      ...this.toPublicProduct(product),
      status: product.status,
      minPrice:
        product.minPriceKobo === null
          ? undefined
          : Number(product.minPriceKobo / 100n),
      updatedAt: product.updatedAt,
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);
  }
}
