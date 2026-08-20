import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** A full-store count can hold thousands of lines; this bounds the request body. */
const MAX_WRITE_OFF_ITEMS = 10000;

export class CompleteCountDto {
  @ApiPropertyOptional({
    example: false,
    description:
      'Treat EVERY uncounted line as not physically present and set its stock to 0. ' +
      'Ignored when writeOffItemIds is supplied.',
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  writeOffUncounted?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Write off only these count-item ids. Takes precedence over writeOffUncounted, ' +
      'including when empty (= write nothing off). Ids that are not eligible uncounted ' +
      'lines of this document are ignored. Use this rather than the boolean: stock that ' +
      'is missing at count time may still be in transit and arrive later.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WRITE_OFF_ITEMS)
  @IsString({ each: true })
  writeOffItemIds?: string[];
}
