import { useCallback } from 'react';
import { useProductsStore, Category } from '../store/products-store';
import { Product, Supplier, ProductFilterParams } from '@shared/types';

export function useProducts() {
  const {
    products,
    categories,
    suppliers,
    isLoading,
    error,
    setProducts,
    setCategories,
    setSuppliers,
    setLoading,
    setError,
  } = useProductsStore();

  const loadProducts = useCallback(async (filters?: ProductFilterParams) => {
    setLoading(true);
    setError(null);

    try {
      const data = await window.electronAPI.products.getAll(filters);
      setProducts(data as Product[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [setProducts, setLoading, setError]);

  const loadCategories = useCallback(async () => {
    try {
      const data = await window.electronAPI.categories.getAll();
      setCategories(data as Category[]);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, [setCategories]);

  const loadSuppliers = useCallback(async () => {
    try {
      const data = await window.electronAPI.suppliers.getAll();
      setSuppliers(data as Supplier[]);
    } catch (err) {
      console.error('Failed to load suppliers:', err);
    }
  }, [setSuppliers]);

  const search = useCallback(async (query: string, extraFilters?: ProductFilterParams) => {
    setLoading(true);

    try {
      const data = await window.electronAPI.products.getAll({ ...extraFilters, query });
      setProducts(data as Product[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [setProducts, setLoading, setError]);

  const searchByBarcode = useCallback(async (barcode: string) => {
    try {
      const product = await window.electronAPI.products.getByBarcode(barcode);
      return product as Product | null;
    } catch (err) {
      console.error('Failed to find product:', err);
      return null;
    }
  }, []);

  const getById = useCallback(async (id: string, opts?: { byDbId?: boolean }) => {
    try {
      const product = await window.electronAPI.products.getById(id, opts);
      return product as Product | null;
    } catch (err) {
      console.error('Failed to get product:', err);
      return null;
    }
  }, []);

  const findByInternalCode = useCallback(async (internalCode: string) => {
    try {
      const product = await window.electronAPI.products.findByInternalCode(internalCode);
      return product as Product | null;
    } catch (err) {
      console.error('Failed to find product by PLU:', err);
      return null;
    }
  }, []);

  const createProduct = useCallback(async (data: Partial<Product>) => {
    setLoading(true);

    try {
      await window.electronAPI.products.create(data);
      await loadProducts();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product');
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadProducts, setLoading, setError]);

  const updateProduct = useCallback(async (id: string, data: Partial<Product>) => {
    setLoading(true);

    try {
      await window.electronAPI.products.update(id, data);
      await loadProducts();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update product');
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadProducts, setLoading, setError]);

  const deleteProduct = useCallback(async (id: string) => {
    setLoading(true);

    try {
      await window.electronAPI.products.delete(id);
      await loadProducts();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete product');
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadProducts, setLoading, setError]);

  const getLowStock = useCallback(async () => {
    try {
      const data = await window.electronAPI.inventory.getLowStock();
      return data as Product[];
    } catch (err) {
      console.error('Failed to get low stock:', err);
      return [];
    }
  }, []);

  const getTopSelling = useCallback(async (limit?: number) => {
    try {
      const data = await window.electronAPI.products.getTopSelling(limit);
      return data as Product[];
    } catch (err) {
      console.error('Failed to get top selling products:', err);
      return [];
    }
  }, []);

  const getTopCategories = useCallback(async (limit?: number) => {
    try {
      return await window.electronAPI.categories.getTopSelling(limit);
    } catch (err) {
      console.error('Failed to get top selling categories:', err);
      return [];
    }
  }, []);

  return {
    products,
    categories,
    suppliers,
    isLoading,
    error,
    loadProducts,
    loadCategories,
    loadSuppliers,
    search,
    searchByBarcode,
    getById,
    findByInternalCode,
    createProduct,
    updateProduct,
    deleteProduct,
    getLowStock,
    getTopSelling,
    getTopCategories,
  };
}
