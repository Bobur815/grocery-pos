import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ProductType, ProductUnit } from '../../../../shared/types/product.types';

const PRODUCT_UNITS: ProductUnit[] = ['шт', 'кг', 'л', 'м'];
const PRODUCT_TYPES: ProductType[] = ['REGULAR', 'BULK_WEIGHTED', 'PREPACKAGED'];

export class UpdateProductDto {
  @ApiPropertyOptional({ example: '4780001234567', description: 'Product barcode' })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({ example: 'Coca-Cola 1.5L', description: 'Product name in Uzbek' })
  @IsOptional()
  @IsString()
  nameUz?: string;

  @ApiPropertyOptional({ example: 'Кока-Кола 1.5Л', description: 'Product name in Russian' })
  @IsOptional()
  @IsString()
  nameRu?: string;

  @ApiPropertyOptional({ example: 15000, description: 'Selling price' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @ApiPropertyOptional({ example: 12000, description: 'Purchase cost' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cost?: number;

  @ApiPropertyOptional({ example: 50, description: 'Current stock quantity' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  stock?: number;

  @ApiPropertyOptional({ example: 5, description: 'Minimum stock alert level' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minStock?: number;

  @ApiPropertyOptional({ example: 'кг', description: 'Unit of measurement (шт, кг, л, м)' })
  @IsOptional()
  @IsIn(PRODUCT_UNITS)
  unit?: ProductUnit;

  @ApiPropertyOptional({ example: 2, description: 'Category ID' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  categoryId?: number;

  @ApiPropertyOptional({ example: 'supplier-cuid', description: 'Supplier ID' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Production date (ISO string)' })
  @IsOptional()
  @IsString()
  productionDate?: string;

  @ApiPropertyOptional({ example: '2027-01-01', description: 'Expiry date (ISO string)' })
  @IsOptional()
  @IsString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 5, description: 'Discount percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discountPercent?: number;

  @ApiPropertyOptional({ example: false, description: 'Is on promotion' })
  @IsOptional()
  @IsBoolean()
  isOnPromotion?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: '00000000000000000', description: 'Uzbekistan national catalog code' })
  @IsOptional()
  @IsString()
  mxik?: string;

  @ApiPropertyOptional({ example: '1234567', description: 'REGOS:VCR package (unit) code from MXIK — for marked goods' })
  @IsOptional()
  @IsString()
  packageCode?: string;

  @ApiPropertyOptional({ example: 12, description: 'VAT % for this product (0 or 12). Null → use store global default' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  vatRate?: number;

  @ApiPropertyOptional({ example: 'REGULAR', description: 'Product type (REGULAR, BULK_WEIGHTED, PREPACKAGED)' })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: ProductType;

  @ApiPropertyOptional({ example: '000042', description: '6-digit PLU code for weighted products' })
  @IsOptional()
  @IsString()
  internalCode?: string;

  @ApiPropertyOptional({ example: 10, description: 'Bulk quantity' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  bulkQuantity?: number;

  @ApiPropertyOptional({ example: 0.1, description: 'Minimum sale quantity (kg)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minSaleQty?: number;

  @ApiPropertyOptional({ example: 50, description: 'Maximum sale quantity (kg)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxSaleQty?: number;
}
