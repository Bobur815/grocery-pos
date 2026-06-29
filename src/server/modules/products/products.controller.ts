import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { StoreGuard } from "../../common/guards/store.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentStore } from "../../common/decorators/current-store.decorator";
import { UserRole } from "@prisma/client";
import { ProductFilters } from "./types/product.types";

@ApiTags("products")
@Controller("products")
@UseGuards(JwtAuthGuard, StoreGuard)
@ApiBearerAuth("JWT-auth")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: "Get all products for the store" })
  @ApiQuery({ name: "categoryId", required: false, type: Number })
  @ApiQuery({ name: "active", required: false, type: Boolean })
  @ApiQuery({ name: "updatedAfter", required: false, type: String })
  @ApiResponse({ status: 200, description: "List of products" })
  async findAll(
    @CurrentStore() storeId: string,
    @Query("categoryId") categoryId?: string,
    @Query("active") active?: string,
    @Query("updatedAfter") updatedAfter?: string,
  ) {
    const filters: ProductFilters = {};

    if (categoryId) filters.categoryId = parseInt(categoryId, 10);
    if (active !== undefined) filters.active = active === "true";
    if (updatedAfter) filters.updatedAfter = new Date(updatedAfter);

    return this.productsService.findAll(storeId, filters);
  }

  @Get("search")
  @ApiOperation({ summary: "Search products by name or barcode" })
  @ApiQuery({ name: "q", required: true, description: "Search query" })
  @ApiResponse({ status: 200, description: "Search results" })
  async search(@CurrentStore() storeId: string, @Query("q") query: string) {
    return this.productsService.search(storeId, query || "");
  }

  @Get(":id/analytics")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Get product sales analytics (Admin only)" })
  @ApiQuery({ name: "startDate", required: false, type: String })
  @ApiQuery({ name: "endDate", required: false, type: String })
  async getAnalytics(
    @CurrentStore() storeId: string,
    @Param("id", ParseIntPipe) id: number,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
  ) {
    const end = endDate ? new Date(endDate + "T23:59:59Z") : new Date();
    const start = startDate
      ? new Date(startDate + "T00:00:00Z")
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.productsService.getAnalytics(id, storeId, start, end);
  }

  @Get("barcode/:barcode")
  @ApiOperation({ summary: "Get product by barcode" })
  @ApiResponse({ status: 200, description: "Product details" })
  async findByBarcode(
    @CurrentStore() storeId: string,
    @Param("barcode") barcode: string,
  ) {
    return this.productsService.findByBarcode(storeId, barcode);
  }

  @Get("internal-code/:code")
  @ApiOperation({ summary: "Get product by internalCode (PLU)" })
  @ApiResponse({ status: 200, description: "Product details" })
  async findByInternalCode(
    @CurrentStore() storeId: string,
    @Param("code") code: string,
  ) {
    return this.productsService.findByInternalCode(storeId, code);
  }

  @Get("next-internal-code")
  @ApiOperation({ summary: "Get next auto-generated internalCode (PLU)" })
  @ApiResponse({ status: 200, description: "Next internalCode as string" })
  async getNextInternalCode(@CurrentStore() storeId: string) {
    return this.productsService.getNextInternalCode(storeId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get product by ID" })
  @ApiQuery({
    name: "byDbId",
    required: false,
    description:
      "Resolve by real DB primary key only (edit/details). Default resolves storeProductCode first.",
  })
  @ApiResponse({ status: 200, description: "Product details" })
  @ApiResponse({ status: 404, description: "Product not found" })
  async findOne(
    @CurrentStore() storeId: string,
    @Param("id", ParseIntPipe) id: number,
    @Query("byDbId") byDbId?: string,
  ) {
    return this.productsService.findById(id, storeId, byDbId === "true");
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Create new product (Admin only)" })
  @ApiResponse({ status: 201, description: "Product created" })
  @ApiResponse({ status: 409, description: "Barcode already exists" })
  async create(
    @CurrentStore() storeId: string,
    @Body() createProductDto: CreateProductDto,
  ) {
    return this.productsService.create(storeId, createProductDto);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Update product (Admin only)" })
  @ApiResponse({ status: 200, description: "Product updated" })
  @ApiResponse({ status: 404, description: "Product not found" })
  async update(
    @CurrentStore() storeId: string,
    @Param("id", ParseIntPipe) id: number,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return this.productsService.update(id, storeId, updateProductDto);
  }

  @Post("sync-bulk")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @ApiOperation({
    summary: "Bulk create new offline-created products from POS terminal (Admin only). Existing products are left unchanged — VPS is the source of truth for product master data.",
  })
  async syncBulk(
    @CurrentStore() storeId: string,
    @Body() body: { products: any[] },
  ) {
    return this.productsService.syncBulk(storeId, body.products ?? []);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Hard delete product and its sales (Admin only)" })
  @ApiResponse({ status: 200, description: "Product deleted" })
  @ApiResponse({ status: 404, description: "Product not found" })
  async remove(
    @CurrentStore() storeId: string,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.productsService.hardDelete(id, storeId);
  }
}
