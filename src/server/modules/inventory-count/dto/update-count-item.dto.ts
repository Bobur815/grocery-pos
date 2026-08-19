import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCountItemDto {
  @ApiProperty({ example: 12.5, description: 'Physically counted quantity' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  countedQty!: number;
}
