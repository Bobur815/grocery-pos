import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SmenaService } from './smena.service';
import { SyncSmenaBulkDto } from './dto/sync-smena.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StoreGuard } from '../../common/guards/store.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentStore } from '../../common/decorators/current-store.decorator';

@ApiTags('smena')
@Controller('smena')
@UseGuards(JwtAuthGuard, StoreGuard)
@ApiBearerAuth('JWT-auth')
export class SmenaController {
  constructor(private readonly smenaService: SmenaService) {}

  /**
   * Not @Roles-guarded: a cashier's terminal pushes its own closed shifts, and cashiers are
   * USER role. Store scoping comes from the token via StoreGuard, so a terminal can only ever
   * write into its own store.
   */
  @Post('sync-bulk')
  @ApiOperation({ summary: 'Sync closed shifts from a POS terminal' })
  @ApiResponse({ status: 201, description: 'Shifts synced' })
  async syncBulk(@CurrentStore() storeId: string, @Body() dto: SyncSmenaBulkDto) {
    return this.smenaService.syncFromTerminal(storeId, dto.smenas);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List synced shifts (Admin only)' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Shifts with their cash movements' })
  async findAll(
    @CurrentStore() storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.smenaService.findAll(
      storeId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }
}
