import { Controller, Get, Post, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AslBelgisiService, ApiKeyStatus } from './aslbelgisi.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentStore } from '../../common/decorators/current-store.decorator';

@ApiTags('aslbelgisi')
@Controller('aslbelgisi')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class AslBelgisiController {
  constructor(private readonly service: AslBelgisiService) {}

  @Post('verify')
  @ApiOperation({ summary: 'Verify a DataMatrix marking code via ASL BELGISI' })
  verify(@Body('code') code: string, @CurrentStore() storeId: string) {
    return this.service.verifyCode(code, storeId);
  }

  @Get('api-key')
  @ApiOperation({ summary: 'Whether an ASL BELGISI key is configured, and when it expires' })
  keyStatus(@CurrentStore() storeId: string): Promise<ApiKeyStatus> {
    return this.service.getApiKeyStatus(storeId);
  }

  @Put('api-key')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Rotate this store’s ASL BELGISI API key (admin only)' })
  setKey(@Body('key') key: string, @CurrentStore() storeId: string): Promise<ApiKeyStatus> {
    return this.service.setApiKey(storeId, key);
  }
}
