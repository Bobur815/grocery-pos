import { IsString, IsNotEmpty, IsOptional, IsObject, IsBoolean, IsIn, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StoreSettingsDto {
  @ApiPropertyOptional({ example: 0.12, description: 'Tax rate (0-1)' })
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({ example: 'Welcome to our store!', description: 'Receipt header text' })
  @IsOptional()
  @IsString()
  receiptHeader?: string;

  @ApiPropertyOptional({ example: 'Thank you for shopping!', description: 'Receipt footer text' })
  @IsOptional()
  @IsString()
  receiptFooter?: string;

  @ApiPropertyOptional({ example: 'UZS', description: 'Currency code' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png', description: 'Store logo URL' })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}

export class CreateStoreDto {
  @ApiProperty({ example: 'My Grocery Store', description: 'Store name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: '123 Main Street, Tashkent', description: 'Store address' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: '+998901234567', description: 'Store phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ enum: ['OFFLINE_ONLY', 'ONLINE'], description: 'Operating mode (defaults to ONLINE)' })
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
