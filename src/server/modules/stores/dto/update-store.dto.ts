import { IsString, IsOptional, IsObject, IsBoolean, IsIn, MaxLength, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StoreSettingsDto } from './create-store.dto';

export class UpdateStoreDto {
  @ApiPropertyOptional({ example: 'My Updated Store', description: 'Store name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '456 New Street, Samarkand', description: 'Store address' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: '+998907654321', description: 'Store phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: true, description: 'Whether the store is active' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'paid', description: 'AI invoice scanning tier: free or paid' })
  @IsOptional()
  @IsString()
  @IsIn(['free', 'paid'])
  aiPlan?: string;

  @ApiPropertyOptional({ example: 'PRO', description: 'Subscription plan: STARTER, PRO, or VIP' })
  @IsOptional()
  @IsString()
  @IsIn(['STARTER', 'PRO', 'VIP'])
  subscriptionPlan?: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z', description: 'Subscription expiry date (null = perpetual)' })
  @IsOptional()
  @IsDateString()
  subscriptionExpiresAt?: string;

  @ApiPropertyOptional({ enum: ['OFFLINE_ONLY', 'ONLINE'], description: 'Operating mode' })
  @IsOptional()
  @IsString()
  @IsIn(['OFFLINE_ONLY', 'ONLINE'])
  mode?: 'OFFLINE_ONLY' | 'ONLINE';

  @ApiPropertyOptional({ example: false, description: 'Restrict the Electron app to cashier operation and narrow its sync' })
  @IsOptional()
  @IsBoolean()
  posAdminLocked?: boolean;

  @ApiPropertyOptional({ type: StoreSettingsDto, description: 'Store settings' })
  @IsOptional()
  @IsObject()
  settings?: StoreSettingsDto;
}
