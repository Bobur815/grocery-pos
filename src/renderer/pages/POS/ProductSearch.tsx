import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useProducts } from "../../hooks/useProducts";
import { Input } from "../../components/common/Input";
import { Button } from "../../components/common/Button";
import { ProductFilters } from "../../components/products/ProductFilters";
import { Product, ProductFilterParams } from "@shared/types";
import { formatQuantity } from "../../utils/formatters";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { ChevronDown, ChevronUp, Keyboard, ListFilterPlus, X } from "lucide-react";
import { VirtualKeyboard } from "../../components/common/VirtualKeyboard";
import {
  SearchInputWrapper,
  InputControls,
  ClearButton,
  KbToggle,
} from "../../components/common/SearchControls";
import { debounce } from "../../utils/helpers";

const Container = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.md};
`;

const SearchHeader = styled.div`
  padding: ${({ theme }) => theme.spacing.sm};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  position: relative;
`;

const FilterDropdown = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 20;
  background-color: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-top: none;
  border-radius: 0 0 ${({ theme }) => theme.borderRadius}
    ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.md};
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
`;

const SearchRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
`;

const ProductsGrid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`;

const ProductCard = styled.button<{ $lowStock?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid
    ${({ theme, $lowStock }) =>
      $lowStock ? theme.colors.warning : theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  width: 100%;
  min-height: 42px;
  flex-shrink: 0;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    background-color: ${({ theme }) => theme.colors.primary}08;
  }

  &:active {
    background-color: ${({ theme }) => theme.colors.primary}18;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const ProductName = styled.span`
  flex: 1;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
  min-width: 0;
`;

const ProductPrice = styled.span`
  color: ${({ theme }) => theme.colors.primary};
  font-weight: bold;
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
`;

const ProductStock = styled.span<{ $low?: boolean }>`
  font-size: 11px;
  color: ${({ theme, $low }) =>
    $low ? theme.colors.warning : theme.colors.textSecondary};
  white-space: nowrap;
  flex-shrink: 0;
`;

const NoResults = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: ${({ theme }) => theme.spacing.xl};
  grid-column: 1 / -1;
`;

interface ProductSearchProps {
  onSelect: (product: Product) => void;
  // Raise the on-screen keyboard above a host modal (e.g. the Catalog modal, overlay z-index 1000).
  keyboardZIndex?: number;
}

export function ProductSearch({ onSelect, keyboardZIndex }: ProductSearchProps) {
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ProductFilterParams>({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [topSelling, setTopSelling] = useState<Product[]>([]);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const {
    products,
    categories,
    suppliers,
    search,
    loadProducts,
    loadCategories,
    loadSuppliers,
    getTopSelling,
    isLoading,
  } = useProducts();

  useEffect(() => {
    loadCategories();
    loadSuppliers();
  }, [loadCategories, loadSuppliers]);

  // Load top-selling products on mount
  useEffect(() => {
    getTopSelling().then((data) => setTopSelling(data as unknown as Product[]));
  }, [getTopSelling]);

  const hasActiveFilters =
    filters.categoryId;

  const debouncedSearch = useMemo(
    () =>
      debounce((query: string, f: ProductFilterParams, active: boolean) => {
        if (query.trim() || active) {
          const params: ProductFilterParams = { ...f };
          if (query.trim()) {
            params.query = query;
          }
          loadProducts(params);
        }
      }, 300),
    [loadProducts],
  );

  useEffect(() => {
    debouncedSearch(searchQuery, filters, !!hasActiveFilters);
  }, [searchQuery, filters, hasActiveFilters, debouncedSearch]);


  // Refresh products when stock changes (after sale/edit/delete)
  useEffect(() => {
    const refresh = () => {
      getTopSelling().then((data) =>
        setTopSelling(data as unknown as Product[]),
      );
      if (searchQuery.trim() || hasActiveFilters) {
        const params: ProductFilterParams = { ...filters };
        if (searchQuery.trim()) params.query = searchQuery;
        loadProducts(params);
      }
    };
    window.addEventListener("stock-updated", refresh);
    return () => window.removeEventListener("stock-updated", refresh);
  }, [getTopSelling, searchQuery, hasActiveFilters, filters, loadProducts]);


  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");

  const getProductName = (product: Product) => {
    return i18n.language === "uz" ? product.nameUz : product.nameRu;
  };

  const handleVirtualKeyPress = (key: string) => {
    if (key === "BACKSPACE") {
      setSearchQuery((prev) => prev.slice(0, -1));
      return;
    }
    if (key === "ENTER") return;
    setSearchQuery((prev) => prev + key);
  };

  const displayProducts: Product[] = (
    searchQuery.trim() || hasActiveFilters
      ? (products as unknown as Product[])
      : topSelling
  ).filter((p) => p.isActive);

  return (
    <Container>
      <SearchHeader>
        <SearchRow>
          <SearchInputWrapper>
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("common.search")}
              style={{ padding: "10px 16px", paddingRight: "60px" }}
              autoFocus
            />
            <InputControls>
              {searchQuery.length > 0 && (
                <ClearButton onClick={() => setSearchQuery("")} tabIndex={-1}>
                  <X size={16} />
                </ClearButton>
              )}
              <KbToggle
                type="button"
                tabIndex={-1}
                $active={keyboardOpen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setKeyboardOpen((prev) => !prev)}
              >
                <Keyboard size={18} />
                {keyboardOpen ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </KbToggle>
            </InputControls>
          </SearchInputWrapper>
        </SearchRow>
      </SearchHeader>

      <ProductsGrid>
        {isLoading ? (
          <NoResults>{t("common.loading")}</NoResults>
        ) : displayProducts.length === 0 ? (
          <NoResults>{t("products.noResults")}</NoResults>
        ) : (
          displayProducts.map((product) => (
            <ProductCard
              key={product.id}
              onClick={() => onSelect(product)}
              disabled={product.stock <= 0}
              $lowStock={product.stock <= product.minStock && product.stock > 0}
            >
              <ProductName>{getProductName(product)}</ProductName>
              <ProductStock $low={product.stock <= product.minStock}>
                {product.stock <= 0
                  ? t("products.outOfStock")
                  : formatQuantity(
                      product.stock,
                      product.unit || "шт",
                      i18n.language as "ru" | "uz",
                    )}
              </ProductStock>
              <ProductPrice>{formatCurrency(product.price)}</ProductPrice>
            </ProductCard>
          ))
        )}
      </ProductsGrid>

      {keyboardOpen && (
        <VirtualKeyboard
          fixed
          zIndex={keyboardZIndex}
          onKeyPress={handleVirtualKeyPress}
          onClose={() => setKeyboardOpen(false)}
        />
      )}
    </Container>
  );
}
