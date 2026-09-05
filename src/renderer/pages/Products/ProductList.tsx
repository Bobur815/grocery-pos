// src/renderer/pages/Products/ProductList.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useProducts } from "../../hooks/useProducts";
import { useAuthStore } from "../../store/auth-store";
import { useModeStore } from "../../store/mode-store";
import { Table } from "../../components/common/Table";
import { Pagination } from "../../components/common/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { ProductFilters } from "../../components/products/ProductFilters";
import { Product, ProductFilterParams } from "@shared/types";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CirclePlus,
  Edit,
  Keyboard,
  ListIndentIncrease,
  Trash,
  X,
} from "lucide-react";
import { formatDate } from "../../utils/formatters";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { debounce } from "../../utils/helpers";
import { VirtualKeyboard } from "../../components/common/VirtualKeyboard";
import {
  SearchInputWrapper,
  InputControls,
  ClearButton,
  KbToggle,
} from "../../components/common/SearchControls";
import { ProductForm } from "./ProductForm";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  position: relative;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-left: 25px;
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Filters = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

export function ProductList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    products,
    categories,
    suppliers,
    loadProducts,
    loadCategories,
    loadSuppliers,
    deleteProduct,
    isLoading,
  } = useProducts();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ProductFilterParams>({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [missingMxikOnly, setMissingMxikOnly] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [formModal, setFormModal] = useState<{
    open: boolean;
    productId?: string;
  }>({ open: false });
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    product?: Product;
  }>({ open: false });
  const isAdmin = user?.role === "ADMIN";
  // Product master data is server-owned once the store is cashier-only, so the terminal browses
  // it read-only. The list itself, search and details all stay available.
  const posAdminLocked = useModeStore((s) => s.posAdminLocked);
  const canManageProducts = isAdmin && !posAdminLocked;

  useEffect(() => {
    loadProducts();
    loadCategories();
    loadSuppliers();
  }, [loadProducts, loadCategories, loadSuppliers]);

  // Reload products while preserving the current search query + active filters
  // (plain loadProducts() would reset the list to unfiltered).
  const reloadWithFilters = useCallback(() => {
    const params: ProductFilterParams = { ...filters };
    if (searchQuery) params.query = searchQuery;
    loadProducts(params);
  }, [loadProducts, filters, searchQuery]);

  const debouncedSearch = useMemo(
    () =>
      debounce((query: string, f: ProductFilterParams) => {
        const params: ProductFilterParams = { ...f };
        if (query) {
          params.query = query;
        }
        loadProducts(params);
      }, 300),
    [loadProducts],
  );

  useEffect(() => {
    debouncedSearch(searchQuery, filters);
  }, [searchQuery, filters, debouncedSearch]);

  // A product needs an MXIK code to be fiscalized (REGOS:VCR). Surface the ones missing it.
  const isMissingMxik = (p: Product) => p.isActive && !p.mxik;
  const missingMxikCount = useMemo(
    () => products.filter(isMissingMxik).length,
    [products],
  );
  const displayedProducts = useMemo(
    () => (missingMxikOnly ? products.filter(isMissingMxik) : products),
    [products, missingMxikOnly],
  );

  const {
    pageData,
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    pageSizeOptions,
    pageOffset,
    goToPage,
    setPageSize,
  } = usePagination(displayedProducts);

  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");

  const handleDeleteConfirm = async () => {
    if (!deleteModal.product) return;
    const success = await deleteProduct(String(deleteModal.product.id));
    if (success) {
      setDeleteModal({ open: false });
      reloadWithFilters();
    }
  };

  const handleVirtualKeyPress = (key: string) => {
    if (key === "BACKSPACE") {
      setSearchQuery((prev) => prev.slice(0, -1));
      return;
    }
    if (key === "ENTER") return;
    setSearchQuery((prev) => prev + key);
  };

  const columns = [
    {
      key: "index",
      header: "#",
      render: (_: Product, index: number) => pageOffset + index + 1,
    },
    { key: "id", header: t("pos.id"), render: (p: Product) => p.storeProductCode ?? p.id },
    {
      key: "mxik",
      header: "MXIK",
      render: (product: Product) =>
        product.mxik ? (
          product.mxik
        ) : (
          <span style={{ color: "#f44336", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <AlertTriangle size={14} /> {t("products.noMxik", "нет")}
          </span>
        ),
    },
    { key: "barcode", header: t("products.barcode") },
    {
      key: "internalCode",
      header: t("products.internalCode"),
      render: (product: Product) => product.internalCode || "-",
    },
    {
      key: "name",
      header: t("products.name"),
      render: (product: Product) =>
        i18n.language === "uz" ? product.nameUz : product.nameRu,
    },
    {
      key: "price",
      header: t("products.price"),
      render: (product: Product) => formatCurrency(product.price),
    },
    {
      key: "vatRate",
      header: t("products.vatRate", "НДС, %"),
      render: (product: Product) =>
        product.vatRate != null ? `${product.vatRate.toFixed(2)}%` : "—",
    },
    {
      key: "stock",
      header: t("products.stock"),
      render: (product: Product) => (
        <span
          style={{
            color: product.stock <= product.minStock ? "#f44336" : "inherit",
          }}
        >
          {product.stock} {product.unit}
        </span>
      ),
    },
    {
      key: "expiryDate",
      header: t("products.expiryDate"),
      render: (product: Product) =>
        product.expiryDate ? formatDate(product.expiryDate) : "-",
    },
    {
      key: "supplier",
      header: t("products.supplier"),
      render: (product: Product) =>
        product.supplier
          ? i18n.language === "uz"
            ? product.supplier.nameUz
            : product.supplier.nameRu
          : "-",
    },
    {
      key: "category",
      header: t("products.category"),
      render: (product: Product) =>
        product.category
          ? i18n.language === "uz"
            ? product.category.nameUz
            : product.category.nameRu
          : "-",
    },
  ];
  
  if (isAdmin) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      render: (product: Product) => (
        <div style={{ display: "flex", gap: "8px" }}>
          {canManageProducts && (
            <Button
              variant="secondary"
              size="small"
              tooltip={t("common.edit")}
              onClick={() =>
                setFormModal({ open: true, productId: String(product.id) })
              }
            >
              <Edit size={16} />
            </Button>
          )}

          {canManageProducts && (
            <Button
              variant="danger"
              size="small"
              tooltip={t("common.delete")}
              onClick={() => setDeleteModal({ open: true, product })}
            >
              <Trash size={16} />
            </Button>
          )}

          <Button
            variant="primary"
            size="small"
            tooltip={t("products.viewDetails")}
            onClick={() => navigate(`/products/${product.id}`)}
          >
            <ListIndentIncrease size={16} />
          </Button>
        </div>
      ),
    });
  }

  return (
    <Container>
      <Header>
        <Title>{t("products.title")}</Title>
        {canManageProducts && (
          <Button
            style={{ fontSize: "26px" }}
            onClick={() => setFormModal({ open: true })}
          >
            <CirclePlus size={24} /> {t("products.add")}
          </Button>
        )}
      </Header>

      <Filters>
        <SearchInputWrapper>
          <Input
            type="text"
            placeholder={t("common.search")}
            style={{
              padding: "8px 16px",
              fontSize: "18px",
              fontWeight: "bold",
              paddingRight: "60px",
            }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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

        <Button
          style={{ padding: "0px 12px" }}
          size="small"
          onClick={() => setIsFilterOpen(!isFilterOpen)}
        >
          {t("filters.filters")}{" "}
          {isFilterOpen ? <ChevronUp /> : <ChevronDown />}
        </Button>

        <Button
          style={{ padding: "0px 12px" }}
          size="small"
          variant={missingMxikOnly ? "primary" : "secondary"}
          tooltip={t("products.missingMxikHint", "Товары без MXIK не фискализируются")}
          onClick={() => setMissingMxikOnly((prev) => !prev)}
        >
          <AlertTriangle size={16} /> {t("products.missingMxik", "Без MXIK")}
          {missingMxikCount > 0 ? ` (${missingMxikCount})` : ""}
        </Button>
      </Filters>

      <ProductFilters
        filters={filters}
        onChange={setFilters}
        categories={categories as any}
        suppliers={suppliers as any}
        isOpen={isFilterOpen}
      />

      <Table<Product>
        columns={columns}
        data={pageData}
        loading={isLoading}
        emptyMessage={t("products.noProducts")}
        footer={
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            onPageChange={goToPage}
            onPageSizeChange={setPageSize}
          />
        }
      />

      {keyboardOpen && (
        <VirtualKeyboard
          fixed
          onKeyPress={handleVirtualKeyPress}
          onClose={() => setKeyboardOpen(false)}
        />
      )}

      {formModal.open && (
        <ProductForm
          productId={formModal.productId}
          onClose={() => setFormModal({ open: false })}
          onSuccess={() => {
            setFormModal({ open: false });
            reloadWithFilters();
          }}
        />
      )}

      {deleteModal.open && deleteModal.product && (
        <ConfirmDialog
          title={t("common.delete")}
          message={t("common.confirmDelete")}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteModal({ open: false })}
        />
      )}
    </Container>
  );
}
