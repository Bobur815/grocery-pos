import { PaymentMethod } from '../constants/payment-methods';

export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface Sale {
  id: string;
  receiptNumber: string;
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
  paymentMethod: string;
  cashierId: string;
  cashierName: string;
  terminalId: string;
  synced: boolean;
  createdAt: string;
  updatedAt?: string;
  items: SaleItem[];
  totalCost?: number;
  margin?: number;
  // REGOS:VCR fiscalization
  fiscalStatus?: string | null; // PENDING | FISCALIZED | FAILED | DISABLED
  fiscalError?: string | null;
  regosReceiptNo?: string | null;
  regosQrCodeUrl?: string | null;
  refunded?: boolean;
}

export interface SaleItem {
  id?: string;
  saleId?: string;
  productId: string;
  productName: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface CartItem {
  productId: string;
  barcode: string;
  name: string;
  price: number;
  quantity: number;
  discount: number;
  subtotal: number;
  unit: string;
  maxStock: number;
}

export interface SaleCreateInput {
  items: SaleItemInput[];
  discount?: number;
  discountType?: DiscountType;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  cashAmount?: number;
  cardAmount?: number;
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
  discount?: number;
}

export interface SaleSyncData {
  id: string;
  storeId: string;
  receiptNumber: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  discountType: DiscountType;
  finalAmount: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  cardAmount?: number;
  cashierId: string;
  cashierName: string;
  terminalId: string;
  createdAt: string;
}

export interface DailySummary {
  date: string;
  totalSales: number;
  totalRevenue: number;
  transactionCount: number;
  averageTransaction: number;
}
