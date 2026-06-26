import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useProducts } from "../../hooks/useProducts";
import { Input } from "../../components/common/Input";
import { Product, ProductFilterParams } from "@shared/types";
import { formatQuantity } from "../../utils/formatters";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { ChevronDown, ChevronUp, Keyboard, X } from "lucide-react";
import { VirtualKeyboard } from "../../components/common/VirtualKeyboard";
import {
  SearchInputWrapper,
  InputControls,
  ClearButton,
  KbToggle,
} from "../../components/common/SearchControls";
import { debounce } from "../../utils/helpers";
import { isMarkedMxik } from "../../../shared/utils/marking";

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

const SearchRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
`;

const PriceField = styled.input`
  width: 120px;
  flex-shrink: 0;
  padding: 10px 12px;
  font-size: 14px;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const CategoryBar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  align-items: stretch;
`;

const CategoryButton = styled.button<{ $active?: boolean }>`
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: ${({ theme }) => theme.borderRadius};
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary + "12" : theme.colors.background};
  color: ${({ theme, $active }) => ($active ? theme.colors.primary : theme.colors.text)};

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const CategorySelect = styled.select<{ $active?: boolean }>`
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  font-size: 13px;
  border-radius: ${({ theme }) => theme.borderRadius};
  cursor: pointer;
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary + "12" : theme.colors.background};
  color: ${({ theme, $active }) => ($active ? theme.colors.primary : theme.colors.text)};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const ProductsGrid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  /* Keep rows at their natural height and packed at the top — otherwise the grid's
     default align-content: stretch balloons a sparse row to fill the flex height. */
  grid-auto-rows: min-content;
  align-content: start;
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
  const [priceQuery, setPriceQuery] = useState("");
  // Which text field the on-screen keyboard types into.
  const [activeField, setActiveField] = useState<"search" | "price">("search");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [topCategories, setTopCategories] = useState<
    { id: number; nameRu: string; nameUz: string }[]
  >([]);
  const [topSelling, setTopSelling] = useState<Product[]>([]);
  const [keyboardOpen, setKeyboardOpen] = useState(true);
  const {
    products,
    categories,
    loadProducts,
    loadCategories,
    getTopSelling,
    getTopCategories,
    isLoading,
  } = useProducts();

  // Load top-selling products + the 5 top-selling categories + the full list (for the dropdown).
  useEffect(() => {
    getTopSelling().then((data) => setTopSelling(data as unknown as Product[]));
    getTopCategories(5).then(setTopCategories);
    loadCategories();
  }, [getTopSelling, getTopCategories, loadCategories]);

  const debouncedLoad = useMemo(
    () =>
      debounce((query: string, categoryId: number | null, price: string) => {
        const exactPrice = price.trim() ? Number(price) : null;
        if (query.trim() || categoryId != null || exactPrice != null) {
          const params: ProductFilterParams = {};
          if (query.trim()) params.query = query;
          if (categoryId != null) params.categoryId = categoryId;
          // Exact price match — set both bounds to the same value.
          if (exactPrice != null && !Number.isNaN(exactPrice)) {
            params.priceMin = exactPrice;
            params.priceMax = exactPrice;
          }
          loadProducts(params);
        }
      }, 300),
    [loadProducts],
  );

  useEffect(() => {
    debouncedLoad(searchQuery, selectedCategoryId, priceQuery);
  }, [searchQuery, selectedCategoryId, priceQuery, debouncedLoad]);

  // Refresh products when stock changes (after sale/edit/delete)
  useEffect(() => {
    const refresh = () => {
      getTopSelling().then((data) =>
        setTopSelling(data as unknown as Product[]),
      );
      const exactPrice = priceQuery.trim() ? Number(priceQuery) : null;
      if (searchQuery.trim() || selectedCategoryId != null || exactPrice != null) {
        const params: ProductFilterParams = {};
        if (searchQuery.trim()) params.query = searchQuery;
        if (selectedCategoryId != null) params.categoryId = selectedCategoryId;
        if (exactPrice != null && !Number.isNaN(exactPrice)) {
          params.priceMin = exactPrice;
          params.priceMax = exactPrice;
        }
        loadProducts(params);
      }
    };
    window.addEventListener("stock-updated", refresh);
    return () => window.removeEventListener("stock-updated", refresh);
  }, [getTopSelling, searchQuery, selectedCategoryId, priceQuery, loadProducts]);

  const categoryName = (c: { nameRu: string; nameUz: string }) =>
    i18n.language === "uz" ? c.nameUz || c.nameRu : c.nameRu;

  // Marked goods (MXIK group 022) are hidden per-product from the catalog below — they require a
  // QR scan — so categories are no longer excluded wholesale (a category's group list spans many
  // groups and doesn't imply its products are marked).
  const visibleTopCategories = topCategories;

  // Categories not already shown as a top-5 button — offered in the dropdown.
  const topCategoryIds = new Set(visibleTopCategories.map((c) => c.id));
  const otherCategories = categories.filter(
    (c) => !topCategoryIds.has(Number(c.id)),
  );
  const selectedIsOther =
    selectedCategoryId != null && !topCategoryIds.has(selectedCategoryId);


  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");

  const getProductName = (product: Product) => {
    return i18n.language === "uz" ? product.nameUz : product.nameRu;
  };

  const handleVirtualKeyPress = (key: string) => {
    if (key === "ENTER") return;
    const setter = activeField === "price" ? setPriceQuery : setSearchQuery;
    if (key === "BACKSPACE") {
      setter((prev) => prev.slice(0, -1));
      return;
    }
    // Price field accepts digits only — ignore any non-numeric key.
    if (activeField === "price" && /\D/.test(key)) return;
    setter((prev) => prev + key);
  };

  const displayProducts: Product[] = (
    searchQuery.trim() || selectedCategoryId != null || priceQuery.trim()
      ? (products as unknown as Product[])
      : topSelling
  ).filter((p) => p.isActive && !isMarkedMxik(p.mxik));

  return (
    <Container>
      <SearchHeader>
        <SearchRow>
          <SearchInputWrapper>
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setActiveField("search")}
              placeholder={t("common.search")}
              style={{ padding: "10px 16px", paddingRight: "40px" }}
              autoFocus
            />
            <InputControls>
              {searchQuery.length > 0 && (
                <ClearButton onClick={() => setSearchQuery("")} tabIndex={-1}>
                  <X size={16} />
                </ClearButton>
              )}
            </InputControls>
          </SearchInputWrapper>
          <PriceField
            type="text"
            inputMode="numeric"
            value={priceQuery}
            onChange={(e) => setPriceQuery(e.target.value.replace(/\D/g, ""))}
            onFocus={() => setActiveField("price")}
            placeholder={t("products.exactPrice", "Цена")}
          />
          <KbToggle
            type="button"
            tabIndex={-1}
            $active={keyboardOpen}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setKeyboardOpen((prev) => !prev)}
          >
            <Keyboard size={18} />
            {keyboardOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </KbToggle>
        </SearchRow>

        <CategoryBar>
          {visibleTopCategories.map((c) => (
            <CategoryButton
              key={c.id}
              type="button"
              $active={selectedCategoryId === c.id}
              onClick={() =>
                setSelectedCategoryId(selectedCategoryId === c.id ? null : c.id)
              }
              title={categoryName(c)}
            >
              {categoryName(c)}
            </CategoryButton>
          ))}
          <CategorySelect
            $active={selectedIsOther}
            value={selectedIsOther ? String(selectedCategoryId) : ""}
            onChange={(e) =>
              setSelectedCategoryId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">{t("products.otherCategories", "Другие категории")}</option>
            {otherCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryName(c)}
              </option>
            ))}
          </CategorySelect>
        </CategoryBar>
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
