import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { CatalogService } from './catalog.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { ListProductsDto } from './dto/list-products.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { UpdateStockDto } from './dto/update-stock.dto.js';

@ApiTags('Seller products')
@ApiBearerAuth()
@Controller('seller/products')
export class SellerProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProductsDto,
  ) {
    return this.catalog.listSellerProducts(user.id, query);
  }

  @Post()
  createProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProductDto,
  ) {
    return this.catalog.createProduct(user.id, body);
  }

  @Patch(':id')
  updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(user.id, id, body);
  }

  @Patch(':id/stock')
  updateStock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateStockDto,
  ) {
    return this.catalog.updateProduct(user.id, id, { stock: body.stock });
  }

  @Delete(':id')
  archiveProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.catalog.archiveProduct(user.id, id);
  }
}
