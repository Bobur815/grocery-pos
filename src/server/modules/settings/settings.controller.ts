import { Controller, Get, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StoreGuard } from '../../common/guards/store.guard';
import { CurrentStore } from '../../common/decorators/current-store.decorator';
import { IsString } from 'class-validator';

class SetSettingDto {
  @IsString() value!: string;
}

@ApiTags('settings')
@Controller('settings')
@UseGuards(JwtAuthGuard, StoreGuard)
@ApiBearerAuth('JWT-auth')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all settings for the store' })
  async getAll(@CurrentStore() storeId: string) {
    return this.settingsService.getAll(storeId);
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a single setting by key' })
  async get(@CurrentStore() storeId: string, @Param('key') key: string) {
    const value = await this.settingsService.get(storeId, key);
    return { key, value };
  }

  @Put(':key')
  @ApiOperation({ summary: 'Set a setting value' })
  async set(
    @CurrentStore() storeId: string,
    @Param('key') key: string,
    @Body() body: SetSettingDto,
  ) {
    await this.settingsService.set(storeId, key, body.value);
    return { key, value: body.value };
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Delete a setting by key' })
  async remove(@CurrentStore() storeId: string, @Param('key') key: string) {
    await this.settingsService.delete(storeId, key);
    return { key, deleted: true };
  }
}
