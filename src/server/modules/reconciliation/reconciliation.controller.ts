import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { MoneyReconciliationService } from './money.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StoreGuard } from '../../common/guards/store.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentStore } from '../../common/decorators/current-store.decorator';

/** Web/admin only and store-scoped, the same boundary StockManagement already sits behind. */
@ApiTags('reconciliation')
@Controller('reconciliation')
@UseGuards(JwtAuthGuard, StoreGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth('JWT-auth')
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly money: MoneyReconciliationService,
  ) {}

  @Get('goods')
  @ApiOperation({ summary: 'Per-SKU goods reconciliation in quantities (Admin only)' })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'ISO date' })
  @ApiQuery({ name: 'countId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Book vs counted per product, plus the cross-check' })
  async goods(
    @CurrentStore() storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('countId') countId?: string,
  ) {
    return this.reconciliation.goods(storeId, {
      periodStart: from ? new Date(from) : undefined,
      periodEnd: to ? new Date(to) : undefined,
      countId,
    });
  }

  @Get('money')
  @ApiOperation({ summary: 'Money reconciliation — tender breakdown (Admin only)' })
  @ApiQuery({ name: 'from', required: true, type: String, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: true, type: String, description: 'ISO date' })
  @ApiResponse({ status: 200, description: 'Sales by tender; cash variance pending shift sync' })
  async moneyReport(
    @CurrentStore() storeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const end = to ? new Date(to) : new Date();
    return this.money.reconcile(storeId, start, end);
  }

  @Post('seed-opening')
  @ApiOperation({
    summary:
      'Seed one OPENING movement per product from current stock. Idempotent — safe to re-run.',
  })
  @ApiResponse({ status: 201, description: 'Number of products seeded' })
  async seedOpening(@CurrentStore() storeId: string) {
    return this.reconciliation.seedOpening(storeId);
  }
}
