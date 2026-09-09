import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StoreGuard } from '../../common/guards/store.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentStore } from '../../common/decorators/current-store.decorator';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard, StoreGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth('JWT-auth')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('daily')
  @ApiOperation({ summary: 'Get daily analytics (Admin only)' })
  @ApiQuery({ name: 'date', required: false, type: String, description: 'Date (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Daily analytics data' })
  async getDailyAnalytics(@CurrentStore() storeId: string, @Query('date') date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    return this.analyticsService.getDailyAnalytics(storeId, targetDate);
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Get monthly analytics (Admin only)' })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number, description: '0-11' })
  @ApiResponse({ status: 200, description: 'Monthly analytics data' })
  async getMonthlyAnalytics(
    @CurrentStore() storeId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : new Date().getMonth();
    return this.analyticsService.getMonthlyAnalytics(storeId, targetYear, targetMonth);
  }

  @Get('data')
  @ApiOperation({ summary: 'Get full analytics data (Admin only)' })
  @ApiQuery({ name: 'startDate', required: true, type: String })
  @ApiQuery({ name: 'endDate', required: true, type: String })
  @ApiQuery({ name: 'categoryId', required: false, type: Number })
  async getAnalyticsData(
    @CurrentStore() storeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    // A non-numeric or absent categoryId means "all categories" rather than an error: this only
    // narrows one card, and a bad value should not cost the caller the whole analytics payload.
    const category = Number(categoryId);
    return this.analyticsService.getAnalyticsData(
      storeId,
      start,
      end,
      Number.isInteger(category) ? category : undefined,
    );
  }

  @Get('product-performance')
  @ApiOperation({ summary: 'Get product performance report (Admin only)' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Product performance data' })
  async getProductPerformance(
    @CurrentStore() storeId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.analyticsService.getProductPerformance(storeId, start, end);
  }
}
