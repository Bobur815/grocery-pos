import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScanCountDto {
  @ApiProperty({ example: '4780001234567', description: 'Scanned product barcode' })
  @IsString()
  @IsNotEmpty()
  barcode!: string;

  @ApiPropertyOptional({ example: 1, description: 'Amount to add to the line (default 1)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  qty?: number;
}
