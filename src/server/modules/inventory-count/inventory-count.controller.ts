import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InventoryCountService } from './inventory-count.service';
import { CreateInventoryCountDto } from './dto/create-inventory-count.dto';
import { UpdateCountItemDto } from './dto/update-count-item.dto';
import { ScanCountDto } from './dto/scan-count.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StoreGuard } from '../../common/guards/store.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentStore } from '../../common/decorators/current-store.decorator';
import { InventoryCountStatus, User } from '@prisma/client';

@ApiTags('inventory-counts')
@Controller('inventory-counts')
@UseGuards(JwtAuthGuard, StoreGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth('JWT-auth')
export class InventoryCountController {
  constructor(private readonly inventoryCountService: InventoryCountService) {}

  @Post()
  @ApiOperation({ summary: 'Open a new stocktake document (Admin only)' })
  @ApiResponse({ status: 201, description: 'Stocktake created' })
  @ApiResponse({ status: 400, description: 'Another stocktake is already open, or scope is empty' })
  async create(
    @CurrentStore() storeId: string,
    @Body() dto: CreateInventoryCountDto,
    @CurrentUser() user: User,
  ) {
    return this.inventoryCountService.create(storeId, dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List stocktake documents (Admin only)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Matches №, note or employee' })
  @ApiQuery({ name: 'status', required: false, enum: InventoryCountStatus })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated list of stocktakes' })
  async findAll(
    @CurrentStore() storeId: string,
    @Query('search') search?: string,
    @Query('status') status?: InventoryCountStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryCountService.findAll(storeId, {
      search,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one stocktake with all its lines (Admin only)' })
  @ApiResponse({ status: 200, description: 'Stocktake document' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(@CurrentStore() storeId: string, @Param('id') id: string) {
    return this.inventoryCountService.findOne(storeId, id);
  }

  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Set the counted quantity for one line (Admin only)' })
  @ApiResponse({ status: 200, description: 'Updated line plus progress counters' })
  async setItem(
    @CurrentStore() storeId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCountItemDto,
  ) {
    return this.inventoryCountService.setItemCount(storeId, id, itemId, dto.countedQty);
  }

  @Post(':id/scan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add a scanned barcode to the count (Admin only)' })
  @ApiResponse({ status: 200, description: 'Updated line plus progress counters' })
  @ApiResponse({ status: 404, description: 'Barcode is not part of this stocktake' })
  async scan(
    @CurrentStore() storeId: string,
    @Param('id') id: string,
    @Body() dto: ScanCountDto,
  ) {
    return this.inventoryCountService.scan(storeId, id, dto.barcode, dto.qty ?? 1);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply counted quantities to stock and lock the document (Admin only)' })
  @ApiResponse({ status: 200, description: 'Stocktake completed' })
  @ApiResponse({ status: 400, description: 'Nothing counted, or the document is already closed' })
  async complete(
    @CurrentStore() storeId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.inventoryCountService.complete(storeId, id, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an open stocktake (Admin only)' })
  @ApiResponse({ status: 200, description: 'Stocktake cancelled' })
  @ApiResponse({ status: 400, description: 'Completed documents cannot be cancelled' })
  async cancel(@CurrentStore() storeId: string, @Param('id') id: string) {
    return this.inventoryCountService.cancel(storeId, id);
  }
}
