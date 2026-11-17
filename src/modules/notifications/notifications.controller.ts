import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/authenticated-user.js';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user.id);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.getPreferences(user.id);
  }

  @Patch('preferences')
  updatePreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateNotificationPreferenceDto,
  ) {
    return this.notifications.updatePreference(user.id, body);
  }
}
