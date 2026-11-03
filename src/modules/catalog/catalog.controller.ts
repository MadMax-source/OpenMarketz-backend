import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/public.decorator.js';
import { CatalogService } from './catalog.service.js';
import { ListProductsDto } from './dto/list-products.dto.js';

@ApiTags('Catalogue')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'List active product categories' })
  listCategories() {
    return this.catalog.listCategories();
  }

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Browse active public products' })
  listProducts(@Query() query: ListProductsDto) {
    return this.catalog.listPublicProducts(query);
  }

  @Public()
  @Get('products/:slug')
  @ApiOperation({ summary: 'Read an active public product by slug' })
  getProduct(@Param('slug') slug: string) {
    return this.catalog.getPublicProduct(slug);
  }
}
