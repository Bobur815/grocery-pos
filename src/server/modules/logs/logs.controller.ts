import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LogsService } from './logs.service';
import { UploadLogsDto } from './dto/upload-logs.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StoreGuard } from '../../common/guards/store.guard';
import { CurrentStore } from '../../common/decorators/current-store.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('logs')
@Controller('logs')
@ApiBearerAuth('JWT-auth')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard, StoreGuard)
  @ApiOperation({ summary: 'Terminal uploads a batch of log entries' })
  async upload(
    @CurrentStore() storeId: string,
    @Body() dto: UploadLogsDto,
  ) {
    return this.logsService.uploadLogs(storeId, dto);
  }

  @Get('meta')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Distinct stores and terminals present in logs' })
  async getMeta(@CurrentUser() user: { role: string; storeId: string | null }) {
    return this.logsService.getMeta(user.role, user.storeId ?? null);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Query terminal logs (admin/super-admin)' })
  async getLogs(
    @CurrentUser() user: { role: string; storeId: string | null },
    @Query('storeId') storeId?: string,
    @Query('terminalId') terminalId?: string,
    @Query('level') level?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logsService.getLogs(user.role, user.storeId ?? null, {
      storeId,
      terminalId,
      level,
      from,
      to,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
