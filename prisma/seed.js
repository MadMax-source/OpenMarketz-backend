import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  {
    slug: 'phones',
    name: 'Phones & Gadgets',
    description:
      'Smartphones, audio, wearables and accessories from trusted tech sellers.',
    sortOrder: 1,
  },
  {
    slug: 'fashion',
    name: 'Fashion',
    description:
      'Ankara, sneakers, bags and everyday style from local designers.',
    sortOrder: 2,
  },
  {
    slug: 'home',
    name: 'Home & Kitchen',
    description:
      'Appliances, decor and essentials to make your space feel like home.',
    sortOrder: 3,
  },
  {
    slug: 'beauty',
    name: 'Health & Beauty',
    description:
      'Skincare, haircare and wellness from authentic, verified brands.',
    sortOrder: 4,
  },
  {
    slug: 'computers',
    name: 'Computing',
    description: 'Laptops, peripherals and work-from-anywhere gear.',
    sortOrder: 5,
  },
  {
    slug: 'grocery',
    name: 'Groceries',
    description: 'Fresh produce and pantry staples delivered to your door.',
    sortOrder: 6,
  },
  {
    slug: 'sports',
    name: 'Sports & Fitness',
    description: 'Jerseys, training kits and equipment for every game.',
    sortOrder: 7,
  },
  {
    slug: 'automotive',
    name: 'Automotive',
    description: 'Car electronics, care products and spare parts.',
    sortOrder: 8,
  },
];

try {
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
        active: true,
      },
      create: category,
    });
  }
} finally {
  await prisma.$disconnect();
}
