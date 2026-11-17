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
import { SaveAddressDto } from './dto/save-address.dto.js';
import { AddressesService } from './addresses.service.js';

@ApiTags('Addresses')
@ApiBearerAuth()
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.addresses.list(user.id);
  }

  @Get('places')
  autocomplete(
    @CurrentUser() user: AuthenticatedUser,
    @Query('input') input: string,
  ) {
    void user;
    return this.addresses.autocomplete(input);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: SaveAddressDto) {
    return this.addresses.save(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: SaveAddressDto,
  ) {
    return this.addresses.save(user.id, body, id);
  }

  @Patch(':id/default')
  setDefault(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.addresses.setDefault(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.addresses.remove(user.id, id);
  }
}
