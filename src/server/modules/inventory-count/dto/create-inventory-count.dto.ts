import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryCountScope } from '@prisma/client';

export class CreateInventoryCountDto {
  @ApiPropertyOptional({
    enum: InventoryCountScope,
    example: 'FULL',
    description: 'FULL counts every active product; CATEGORY counts one category',
  })
  @IsOptional()
  @IsEnum(InventoryCountScope)
  scope?: InventoryCountScope;

  @ApiPropertyOptional({ example: 3, description: 'Required when scope = CATEGORY' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  categoryId?: number;

  @ApiPropertyOptional({ example: 'Oylik inventarizatsiya', description: 'Free-text note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
