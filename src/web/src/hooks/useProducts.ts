import { useCallback } from 'react';
import { useProductsStore, Category } from '../store/products-store';
import { Product, Supplier, ProductFilterParams } from '@shared/types';
import { products as productsApi, categories as categoriesApi, inventory as inventoryApi } from '../api/client';

// Map raw server response fields to Product type
function transformProduct(p: any): Product {
  return {
    ...p,
    isActive: p.isActive ?? p.active,
    price: Number(p.price),
    cost: p.cost != null ? Number(p.cost) : undefined,
    stock: Number(p.stock),
    minStock: Number(p.minStock),
    pendingPrice: p.pendingPrice != null ? Number(p.pendingPrice) : p.pendingPrice,
    pendingPriceThreshold: p.pendingPriceThreshold != null ? Number(p.pendingPriceThreshold) : p.pendingPriceThreshold,
    discountPercent: p.discountPercent != null ? Number(p.discountPercent) : undefined,
  };
}

// Apply filters that the server doesn't handle
function applyClientFilters(products: Product[], filters: ProductFilterParams): Product[] {
  let result = products;
  const now = new Date();

  if (filters.query) {
    const q = filters.query.toLowerCase();
    result = result.filter(
      (p) =>
        p.nameRu.toLowerCase().includes(q) ||
        p.nameUz.toLowerCase().includes(q) ||
        p.barcode.includes(q),
    );
  }
  if (filters.active !== undefined) {
    result = result.filter((p) => p.isActive === filters.active);
  }
  if (filters.categoryId) {
    result = result.filter((p) => p.categoryId === filters.categoryId);
  }
  if (filters.supplierId) {
    result = result.filter((p) => p.supplierId === filters.supplierId);
  }
  if (filters.unit && filters.unit !== 'all') {
    result = result.filter((p) => p.unit === filters.unit);
  }
  if (filters.priceMin !== undefined) {
    result = result.filter((p) => p.price >= filters.priceMin!);
  }
  if (filters.priceMax !== undefined) {
    result = result.filter((p) => p.price <= filters.priceMax!);
  }
  if (filters.promotionStatus === 'on_promotion') {
    result = result.filter((p) => p.isOnPromotion);
  } else if (filters.promotionStatus === 'no_promotion') {
    result = result.filter((p) => !p.isOnPromotion);
  }
  if (filters.availability === 'in_stock') {
    result = result.filter((p) => p.stock > 0 && p.stock > p.minStock);
  } else if (filters.availability === 'out_of_stock') {
    result = result.filter((p) => p.stock <= 0);
  } else if (filters.availability === 'low_stock') {
    result = result.filter((p) => p.stock > 0 && p.stock <= p.minStock);
  }
  if (filters.expiryStatus === 'expired') {
    result = result.filter((p) => p.expiryDate && new Date(p.expiryDate) < now);
  } else if (filters.expiryStatus === 'expiring_soon') {
    const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    result = result.filter(
      (p) => p.expiryDate && new Date(p.expiryDate) >= now && new Date(p.expiryDate) <= soon,
    );
  } else if (filters.expiryStatus === 'fresh') {
    const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    result = result.filter((p) => !p.expiryDate || new Date(p.expiryDate) > soon);
  }

  return result;
}

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
      // Fetch all products (active + inactive); status is filtered client-side.
      const raw = await productsApi.getAll();
      const allProducts = (raw as any[]).map(transformProduct);
      // Apply remaining filters client-side
      const filtered = filters ? applyClientFilters(allProducts, filters) : allProducts;
      setProducts(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [setProducts, setLoading, setError]);

  const loadCategories = useCallback(async () => {
    try {
      const data = await categoriesApi.getAll();
      setCategories(data as Category[]);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, [setCategories]);

  const loadSuppliers = useCallback(async () => {
    try {
      const { suppliers: suppliersApi } = await import('../api/client');
      const data = await suppliersApi.getAll();
      setSuppliers(data as Supplier[]);
    } catch (err) {
      console.error('Failed to load suppliers:', err);
    }
  }, [setSuppliers]);

  const search = useCallback(async (query: string, extraFilters?: ProductFilterParams) => {
    setLoading(true);

    try {
      const raw = await productsApi.getAll();
      const allProducts = (raw as any[]).map(transformProduct);
      const filtered = applyClientFilters(allProducts, { ...extraFilters, query });
      setProducts(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [setProducts, setLoading, setError]);

  const searchByBarcode = useCallback(async (barcode: string) => {
    try {
      const product = await productsApi.getByBarcode(barcode);
      return product ? transformProduct(product) : null;
    } catch (err) {
      console.error('Failed to find product:', err);
      return null;
    }
  }, []);

  const getById = useCallback(async (id: string, byDbId = false) => {
    try {
      const product = await productsApi.getById(id, byDbId);
      return product ? transformProduct(product) : null;
    } catch (err) {
      console.error('Failed to get product:', err);
      return null;
    }
  }, []);

  const findByInternalCode = useCallback(async (internalCode: string) => {
    try {
      const product = await productsApi.findByInternalCode(internalCode);
      return product ? transformProduct(product) : null;
    } catch (err) {
      console.error('Failed to find product by PLU:', err);
      return null;
    }
  }, []);

  const createProduct = useCallback(async (data: Partial<Product>) => {
    setLoading(true);

    try {
      await productsApi.create(data);
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
      await productsApi.update(id, data);
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
      await productsApi.delete(id);
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
      const data = await inventoryApi.getLowStock();
      return data as Product[];
    } catch (err) {
      console.error('Failed to get low stock:', err);
      return [];
    }
  }, []);

  const getTopSelling = useCallback(async (limit?: number) => {
    try {
      const data = await productsApi.getTopSelling(limit);
      return data as Product[];
    } catch (err) {
      console.error('Failed to get top selling products:', err);
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
  };
}
