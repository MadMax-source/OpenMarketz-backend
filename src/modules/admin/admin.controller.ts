import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { Roles } from '../../common/roles.decorator.js';
import { ReviewSellerApplicationDto } from './dto/review-seller-application.dto.js';
import { AdminService } from './admin.service.js';

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('seller-applications')
  listSellerApplications() {
    return this.admin.listSellerApplications();
  }

  @Patch('seller-applications/:id')
  reviewSellerApplication(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewSellerApplicationDto,
  ) {
    return this.admin.reviewSellerApplication(id, user.id, body);
  }

  @Get('seller-applications/:applicationId/media/:mediaId/access')
  getPrivateApplicationMediaUrl(
    @Param('applicationId') applicationId: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.admin.getPrivateApplicationMediaUrl(applicationId, mediaId);
  }
}
