import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsArray,
  ValidateNested,
  IsOptional,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Money crosses the wire as a string, matching SyncSaleDto. Decimals are parsed straight into
 * Prisma.Decimal server-side — a JSON number would round the som figures on the way in.
 */
export class SyncSmenaMovementDto {
  @ApiProperty({ example: 'clmov123' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 'PAY_OUT', enum: ['PAY_IN', 'PAY_OUT'] })
  @IsIn(['PAY_IN', 'PAY_OUT'])
  type!: 'PAY_IN' | 'PAY_OUT';

  @ApiProperty({ example: '50000' })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiPropertyOptional({ example: 'Инкассация' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ example: '2026-08-29T10:30:00.000Z' })
  @IsDateString()
  createdAt!: string;
}

export class SyncSmenaDto {
  @ApiProperty({ example: 'clsmena123', description: 'Terminal shift ID, reused as the PK' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 'T1' })
  @IsString()
  @IsNotEmpty()
  terminalId!: string;

  @ApiProperty({ example: 'cluser123' })
  @IsString()
  @IsNotEmpty()
  cashierId!: string;

  @ApiProperty({ example: 'Иван Иванов' })
  @IsString()
  @IsNotEmpty()
  cashierName!: string;

  @ApiPropertyOptional({
    example: '998901234567',
    description:
      'Cashier phone, used to resolve the VPS user id — the terminal may know this cashier ' +
      'under a different id. Optional: terminals older than this field simply do not send it.',
  })
  @IsOptional()
  @IsString()
  cashierPhone?: string;

  @ApiProperty({ example: '200000', description: 'Cash counted into the drawer at open' })
  @IsString()
  @IsNotEmpty()
  initialCash!: string;

  @ApiProperty({ example: '850000', description: 'Cash counted out of the drawer at close' })
  @IsString()
  @IsNotEmpty()
  finalCash!: string;

  @ApiProperty({ example: 42 })
  @IsInt()
  @Type(() => Number)
  zReportNumber!: number;

  @ApiPropertyOptional({ example: 1001, description: 'REGOS:VCR Z-report id' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  regosZReportId?: number;

  @ApiProperty({ example: '650000', description: 'Cash tender only — what actually hit the till' })
  @IsString()
  @IsNotEmpty()
  cashSalesAmount!: string;

  @ApiProperty({ example: '300000', description: 'Card + UzQR — settles to the bank, not the till' })
  @IsString()
  @IsNotEmpty()
  cardSalesAmount!: string;

  @ApiProperty({ example: '0' })
  @IsString()
  @IsNotEmpty()
  payInTotal!: string;

  @ApiProperty({ example: '0' })
  @IsString()
  @IsNotEmpty()
  payOutTotal!: string;

  @ApiProperty({ example: '0', description: 'Refunded to customers out of the drawer' })
  @IsString()
  @IsNotEmpty()
  returnAmount!: string;

  @ApiProperty({ example: '2026-08-29T08:00:00.000Z' })
  @IsDateString()
  openedAt!: string;

  @ApiProperty({ example: '2026-08-29T20:00:00.000Z' })
  @IsDateString()
  closedAt!: string;

  @ApiProperty({ type: [SyncSmenaMovementDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncSmenaMovementDto)
  movements!: SyncSmenaMovementDto[];
}

export class SyncSmenaBulkDto {
  @ApiProperty({ type: [SyncSmenaDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncSmenaDto)
  smenas!: SyncSmenaDto[];
}
