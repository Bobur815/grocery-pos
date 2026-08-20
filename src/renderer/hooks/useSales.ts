import { useState, useCallback } from 'react';
import type { Sale } from '@shared/types/sale.types';
import type { SaleTender } from '@shared/constants';

interface CreateSaleData {
  items: Array<{
    productId: string;
    productName: string;
    barcode: string;
    quantity: number;
    unitPrice: number;
  }>;
  paymentMethod: SaleTender;
  discountAmount?: number;
  // Scanned mandatory-marking (Asl-Belgisi) codes, by line barcode — used for fiscalization
  markingCodes?: Array<{ barcode: string; label: string }>;
  // When true, send the receipt to REGOS:VCR to fiscalize immediately. Default (false/absent)
  // leaves the sale un-fiscalized (PENDING) so it can be fiscalized later from Sales History.
  fiscalize?: boolean;
}

interface Summary {
  date: string;
  totalSales: number;
  totalRevenue: number;
  totalItems: number;
  cashSales: number;
  cardSales: number;
  averageTransaction: number;
}

export function useSales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSales = useCallback(async (filters?: { startDate?: string; endDate?: string; terminalId?: string }) => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await window.electronAPI.sales.getAll(filters);
      setSales(data as Sale[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createSale = useCallback(async (data: CreateSaleData): Promise<Sale> => {
    setIsLoading(true);
    setError(null);

    try {
      const sale = await window.electronAPI.sales.create(data);
      return sale as Sale;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create sale';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getSaleById = useCallback(async (id: string): Promise<Sale | null> => {
    try {
      const sale = await window.electronAPI.sales.getById(id);
      return sale as Sale;
    } catch (err) {
      console.error('Failed to get sale:', err);
      return null;
    }
  }, []);

  const updateSale = useCallback(async (id: string, data: CreateSaleData): Promise<Sale> => {
    setIsLoading(true);
    setError(null);

    try {
      const sale = await window.electronAPI.sales.update(id, data);
      return sale as Sale;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update sale';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteSale = useCallback(async (id: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      await window.electronAPI.sales.delete(id);
      setSales((prev) => prev.filter((s) => s.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sale');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getTodaySummary = useCallback(async (): Promise<Summary | null> => {
    setIsLoading(true);

    try {
      const summary = await window.electronAPI.sales.getTodaySummary();
      return summary as Summary;
    } catch (err) {
      console.error('Failed to get summary:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    sales,
    isLoading,
    error,
    loadSales,
    createSale,
    updateSale,
    deleteSale,
    getSaleById,
    getTodaySummary,
  };
}
