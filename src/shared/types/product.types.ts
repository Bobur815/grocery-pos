import { Supplier } from './supplier.types';

export type ProductUnit = 'шт' | 'кг' | 'л' | 'м';
export type ProductType = 'REGULAR' | 'BULK_WEIGHTED' | 'PREPACKAGED';

// Re-export Supplier for backwards compatibility
export type { Supplier } from './supplier.types';

export interface Product {
  id: number;
  storeId?: string;
  barcode: string;
  nameRu: string;
  nameUz: string;
  descriptionRu?: string;
  descriptionUz?: string;
  price: number;
  cost?: number;
  unit: ProductUnit;
  stock: number;
  minStock: number;
  categoryId?: number;
  category?: Category;
  supplierId?: string;
  supplier?: Supplier;
  productionDate?: string;
  expiryDate?: string;
  discountPercent?: number;
  isOnPromotion: boolean;
  pendingPrice?: number | null;
  pendingPriceThreshold?: number | null;
  mxik?: string;
  packageCode?: string;
  vatRate?: number | null; // VAT % for this product's MXIK (0/12). Null → use global default
  // Authoritative Asl-Belgisi marking flag from tasnif `label`. Null = unchecked → callers fall
  // back to the isMarkedMxik(mxik) group heuristic. See productRequiresMarking() in shared/utils/marking.
  isMarked?: boolean | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Weighted product fields
  productType?: ProductType;
  internalCode?: string;
  bulkQuantity?: number;
  minSaleQty?: number;
  maxSaleQty?: number;
  storeProductCode?: number | null;
}

export interface PreWeighedItem {
  id: string;
  productId: number;
  product?: Product;
  internalCode: string;
  weight: number;  // kg
  barcode: string;
  pricePerKg: number;
  totalPrice: number;
  status: 'AVAILABLE' | 'SOLD';
  createdAt: string;
  soldAt?: string | null;
  saleId?: string | null;
}

export interface Category {
  id: number;
  storeId?: string;
  nameRu: string;
  nameUz: string;
  mxikGroupCode?: string | null;
  parentId?: number;
  parent?: Category;
  children?: Category[];
  products?: Product[];
  createdAt: string;
  updatedAt: string;
}

export type StockAvailability = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
export type ExpiryStatus = 'all' | 'fresh' | 'expiring_soon' | 'expired';
export type PromotionStatus = 'all' | 'on_promotion' | 'no_promotion';

export interface ProductFilterParams {
  query?: string;
  categoryId?: number;
  supplierId?: string;
  priceMin?: number;
  priceMax?: number;
  availability?: StockAvailability;
  expiryStatus?: ExpiryStatus;
  unit?: ProductUnit | 'all';
  promotionStatus?: PromotionStatus;
  active?: boolean;
}

export interface ProductCreateInput {
  barcode: string;
  nameRu: string;
  nameUz: string;
  descriptionRu?: string;
  descriptionUz?: string;
  price: number;
  cost?: number;
  unit?: ProductUnit;
  stock?: number;
  minStock?: number;
  categoryId?: number;
  supplierId?: string;
  productionDate?: string;
  expiryDate?: string;
  discountPercent?: number;
  isOnPromotion?: boolean;
  mxik?: string;
  packageCode?: string;
  vatRate?: number | null;
  isMarked?: boolean | null;
  productType?: ProductType;
  internalCode?: string;
  bulkQuantity?: number;
  minSaleQty?: number;
  maxSaleQty?: number;
}

export interface ProductUpdateInput {
  barcode?: string;
  nameRu?: string;
  nameUz?: string;
  descriptionRu?: string;
  descriptionUz?: string;
  price?: number;
  cost?: number;
  unit?: ProductUnit;
  stock?: number;
  minStock?: number;
  categoryId?: number;
  isActive?: boolean;
  supplierId?: string;
  productionDate?: string;
  expiryDate?: string;
  discountPercent?: number;
  isOnPromotion?: boolean;
  mxik?: string;
  packageCode?: string;
  vatRate?: number | null;
  isMarked?: boolean | null;
  productType?: ProductType;
  internalCode?: string;
  bulkQuantity?: number;
  minSaleQty?: number;
  maxSaleQty?: number;
}

export interface ProductSearchQuery {
  query?: string;
  categoryId?: number;
  isActive?: boolean;
  lowStock?: boolean;
  page?: number;
  limit?: number;
}

export interface LowStockProduct {
  id: number;
  barcode: string;
  nameRu: string;
  nameUz: string;
  stock: number;
  minStock: number;
  unit: ProductUnit;
}
