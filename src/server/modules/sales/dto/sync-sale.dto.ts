import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsArray,
  ValidateNested,
  IsOptional,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncSaleItemDto {
  @ApiProperty({ example: 'clxyz123', description: 'Sale item ID' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 1, description: 'Product ID' })
  @IsInt()
  @Type(() => Number)
  productId!: number;

  @ApiProperty({ example: 'Coca-Cola 1L', description: 'Product name' })
  @IsString()
  @IsNotEmpty()
  productName!: string;

  @ApiProperty({ example: '4780001234567', description: 'Product barcode' })
  @IsString()
  @IsNotEmpty()
  barcode!: string;

  @ApiProperty({ example: '2.5', description: 'Quantity sold' })
  @IsString()
  @IsNotEmpty()
  quantity!: string;

  @ApiProperty({ example: '12000', description: 'Unit price' })
  @IsString()
  @IsNotEmpty()
  unitPrice!: string;

  @ApiProperty({ example: '30000', description: 'Subtotal (quantity * unitPrice)' })
  @IsString()
  @IsNotEmpty()
  subtotal!: string;

  @ApiPropertyOptional({ example: 5, description: 'Pieces in one sold quantity unit (1 = piece, N = box). Absent on older terminals → 1' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  piecesPerUnit?: number;
}

export class SyncSaleDto {
  @ApiProperty({ example: 'clxyz456', description: 'Sale ID from POS terminal' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 'REC-001-20240130-001', description: 'Receipt number' })
  @IsString()
  @IsNotEmpty()
  receiptNumber!: string;

  @ApiProperty({ example: '100000', description: 'Total amount before discount' })
  @IsString()
  @IsNotEmpty()
  totalAmount!: string;

  @ApiPropertyOptional({ example: '5000', description: 'Discount amount' })
  @IsOptional()
  @IsString()
  discountAmount?: string;

  @ApiProperty({ example: '95000', description: 'Final amount after discount' })
  @IsString()
  @IsNotEmpty()
  finalAmount!: string;

  @ApiProperty({ example: 'cash', description: 'Payment method (cash/card)' })
  @IsString()
  @IsNotEmpty()
  paymentMethod!: string;

  @ApiProperty({ example: 'cluser123', description: 'Cashier user ID' })
  @IsString()
  @IsNotEmpty()
  cashierId!: string;

  @ApiProperty({ example: 'Иван Иванов', description: 'Cashier name' })
  @IsString()
  @IsNotEmpty()
  cashierName!: string;

  @ApiPropertyOptional({ example: '+998901234567', description: 'Cashier phone for server-side ID resolution' })
  @IsOptional()
  @IsString()
  cashierPhone?: string;

  @ApiProperty({ example: 'T1', description: 'POS terminal ID' })
  @IsString()
  @IsNotEmpty()
  terminalId!: string;

  @ApiProperty({ example: '2024-01-30T10:30:00.000Z', description: 'Sale timestamp' })
  @IsDateString()
  createdAt!: string;

  @ApiProperty({ type: [SyncSaleItemDto], description: 'Sale items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncSaleItemDto)
  items!: SyncSaleItemDto[];
}
