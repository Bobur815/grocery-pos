import { IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteCountDto {
  @ApiPropertyOptional({
    example: false,
    description:
      'Treat every uncounted line as not physically present and set its stock to 0',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  writeOffUncounted?: boolean;
}
