// src/web/src/pages/Products/ProductList.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProductForm } from "./ProductForm";
import styled from "styled-components";
import { useProducts } from "../../hooks/useProducts";
import { useAuthStore } from "../../store/auth-store";
import { Table } from "@components/common/Table";
import { Pagination } from "@components/common/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { Button } from "@components/common/Button";
import { Input } from "@components/common/Input";
import { Select } from "@components/common/Select";
import { ProductFilters } from "@components/products/ProductFilters";
import { Product, ProductFilterParams } from "@shared/types";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  Edit,
  Trash,
  X,
  Eye,
  Plus,
  ScanBarcode,
} from "lucide-react";
import { keyframes } from "styled-components";
import { formatDate } from "../../utils/formatters";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { debounce } from "../../utils/helpers";
import {
  MobileCard,
  MobileCardList,
  DesktopOnly,
} from "../../components/common/MobileCard";
import {
  mxik as mxikApi,
  products as productsApi,
  aslBelgisi,
} from "../../api/client";
import { BarcodeScannerModal } from "../../components/common/BarcodeScannerModal";
import { useToast } from "@context/ToastContext";
import { ListFilter } from "lucide-react";

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb, 59, 130, 246), 0.5); }
  70% { box-shadow: 0 0 0 12px rgba(var(--primary-rgb, 59, 130, 246), 0); }
  100% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb, 59, 130, 246), 0); }
`;

const FAB = styled.button`
  position: fixed;
  bottom: 50px;
  right: 16px;
  z-index: 100;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: none;
  background-color: ${({ theme }) => theme.colors.primary};
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  animation: ${pulse} 2s ease-out infinite;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    transform: scale(1.1);
  }

  &:active {
    transform: scale(0.95);
  }
`;

const MobileSentinel = styled.div`
  height: 1px;
  @media (min-width: 769px) {
    display: none;
  }
`;

const MOBILE_PAGE_SIZE = 20;

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

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
    gap: ${({ theme }) => theme.spacing.sm};
  }
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.75rem;
  color: ${({ theme }) => theme.colors.text};

  @media (max-width: 768px) {
    font-size: 1.5rem;
  }
`;

const Filters = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ClearButton = styled.button`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary || "#666"};
  transition: color 0.2s ease;

  &:hover {
    color: ${({ theme }) => theme.colors.primary || "#000"};
  }

  &:focus {
    outline: 2px solid ${({ theme }) => theme.colors.primary};
    outline-offset: 2px;
    border-radius: 4px;
  }
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
    searchByBarcode,
    isLoading,
  } = useProducts();
  const [searchQuery, setSearchQuery] = useState("");
  // Default to active products; the status select below can reveal inactive / all.
  const [filters, setFilters] = useState<ProductFilterParams>({ active: true });
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [missingMxikOnly, setMissingMxikOnly] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

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

  const [showFabScanner, setShowFabScanner] = useState(false);
  const [fabInitialData, setFabInitialData] = useState<{
    barcode?: string;
    mxik?: string;
    nameRu?: string;
    nameUz?: string;
    productionDate?: string;
    expiryDate?: string;
    packageCode?: string;
  } | null>(null);
  const [fabArrivalProductId, setFabArrivalProductId] = useState<string | null>(
    null,
  );

  const reloadWithFilters = useCallback(() => {
    const params: ProductFilterParams = { ...filters };
    if (searchQuery) params.query = searchQuery;
    loadProducts(params);
  }, [loadProducts, filters, searchQuery]);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

  const toast = useToast();

  async function handleFabScan(qrData: string) {
    setShowFabScanner(false);
    const type = aslBelgisi.detectQrType(qrData);

    if (type === "fiscal") {
      toast.error(t("scanner.productNotFound"));
      setShowProductForm(true);
      return;
    }

    let barcode: string | undefined;
    if (type === "datamatrix") {
      barcode = aslBelgisi.extractGtinFromDataMatrix(qrData) ?? undefined;
    } else if (type === "barcode") {
      barcode = qrData;
    }

    // 1. Check existing DB first
    if (barcode) {
      const existing = await searchByBarcode(barcode);
      if (existing) {
        setFabArrivalProductId(String(existing.id));
        return;
      }
    }

    // 2. Not in DB — build initial data for new product form
    const initial: {
      barcode?: string;
      mxik?: string;
      nameRu?: string;
      nameUz?: string;
      productionDate?: string;
      expiryDate?: string;
      packageCode?: string;
    } = {};

    if (type === "datamatrix") {
      if (barcode) initial.barcode = barcode;
      try {
        const info = await aslBelgisi.verifyMarkingCode(qrData);
        if (info.isValid) {
          if (info.productionDate) initial.productionDate = info.productionDate;
          if (info.expirationDate) initial.expiryDate = info.expirationDate;
          const MULTI_PACK_TYPES = ["GROUP", "BOX_LV_1", "BOX_LV_2"];
          if (info.packageType && MULTI_PACK_TYPES.includes(info.packageType)) {
            toast.error(
              `Multi-pack: ${info.packageType}. Check quantity before saving.`,
            );
          }
        }
      } catch {
        // partial data — continue
      }
    } else if (type === "mxik") {
      initial.mxik = qrData;
    } else {
      initial.barcode = barcode;
    }

    // 3. Search tasnif for name + MXIK
    if (initial.barcode) {
      try {
        const result = await mxikApi.searchByBarcode(initial.barcode);
        if (result?.code) initial.mxik = result.code;
        if (result?.nameRu) initial.nameRu = result.nameRu;
        if (result?.name) initial.nameUz = result.name;
        if (result?.packageCode) initial.packageCode = result.packageCode;
      } catch {
        // no match — continue with barcode only
      }
    }

    setFabInitialData(initial);
    setShowProductForm(true);
  }

  const [mobileCount, setMobileCount] = useState(MOBILE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset mobile count when the displayed list changes (new search/filter/MXIK toggle)
  useEffect(() => {
    setMobileCount(MOBILE_PAGE_SIZE);
  }, [displayedProducts]);

  // Infinite scroll: load next batch when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && mobileCount < displayedProducts.length) {
          setMobileCount((c) =>
            Math.min(c + MOBILE_PAGE_SIZE, displayedProducts.length),
          );
        }
      },
      { rootMargin: "150px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mobileCount, displayedProducts.length]);

  useEffect(() => {
    loadProducts(filters);
    loadCategories();
    loadSuppliers();
  }, [loadProducts, loadCategories, loadSuppliers]);

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

  const handleDelete = async (product: Product) => {
    if (!window.confirm(t("common.confirmDelete"))) return;
    const success = await deleteProduct(String(product.id));
    if (success) reloadWithFilters();
  };

  const columns = [
    {
      key: "index",
      header: "#",
      render: (_: Product, index: number) => pageOffset + index + 1,
    },
    {
      key: "id",
      header: t("pos.id"),
      render: (p: Product) => p.storeProductCode ?? p.id,
    },
    {
      key: "mxik",
      header: "MXIK",
      render: (product: Product) =>
        product.mxik ? (
          product.mxik
        ) : (
          <span
            style={{
              color: "#f44336",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
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
      key: "active",
      header: t("products.status"),
      render: (product: Product) => (
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            background: product.isActive ? "#4caf5020" : "#9e9e9e20",
            color: product.isActive ? "#2e7d32" : "#757575",
          }}
        >
          {product.isActive ? t("products.active") : t("products.inactive")}
        </span>
      ),
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
          <Button
            variant="secondary"
            size="small"
            tooltip={t("common.edit")}
            onClick={() => setEditProductId(String(product.id))}
          >
            <Edit size={18} />
          </Button>
          {product.isActive && (
            <Button
              variant="danger"
              size="small"
              tooltip={t("common.delete")}
              onClick={() => handleDelete(product)}
            >
              <Trash size={18} />
            </Button>
          )}
          <Button
            variant="primary"
            size="small"
            tooltip={t("products.viewDetails")}
            onClick={() => navigate(`/products/${product.id}`)}
          >
            <Eye size={18} />
          </Button>
        </div>
      ),
    });
  }

  return (
    <Container>
      <Header>
        <Title>{t("products.title")}</Title>
        <Button
          style={{
            padding: "5px 12px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          size="small"
          variant={missingMxikOnly ? "primary" : "secondary"}
          tooltip={t(
            "products.missingMxikHint",
            "Товары без MXIK не фискализируются",
          )}
          onClick={() => setMissingMxikOnly((prev) => !prev)}
        >
          <AlertTriangle size={16} /> {t("products.missingMxik", "Без MXIK")}
          {missingMxikCount > 0 ? ` (${missingMxikCount})` : ""}
        </Button>
      </Header>
      {isAdmin && (
        <FAB
          onClick={() => {
            if (isMobile) {
              setShowFabScanner(true);
            } else {
              setFabInitialData(null);
              setShowProductForm(true);
            }
          }}
        >
          {isMobile ? <ScanBarcode size={32} /> : <Plus size={38} />}
        </FAB>
      )}

      <Filters>
        <div style={{ position: "relative", flex: 1 }}>
          <Input
            type="text"
            placeholder={t("common.search")}
            style={{
              padding: "8px 40px 8px 16px",
              fontSize: "16px",
              width: "100%",
            }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery.length > 0 && (
            <ClearButton onClick={() => setSearchQuery("")}>
              <X size={16} />
            </ClearButton>
          )}
        </div>

        <Select
          selectSize="small"
          style={{ padding: "8px", flexShrink: 0, minWidth: 130 }}
          options={[
            { value: "active", label: t("products.active") },
            { value: "inactive", label: t("products.inactive") },
            { value: "all", label: t("filters.all") },
          ]}
          value={
            filters.active === true
              ? "active"
              : filters.active === false
                ? "inactive"
                : "all"
          }
          onChange={(e) => {
            const v = e.target.value;
            setFilters((prev) => ({
              ...prev,
              active: v === "active" ? true : v === "inactive" ? false : undefined,
            }));
          }}
        />

        <Button
          style={{ padding: "0px 12px", flexShrink: 0 }}
          size="small"
          onClick={() => setIsFilterOpen(!isFilterOpen)}
        >
          <ListFilter /> {isFilterOpen ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </Filters>

      <ProductFilters
        filters={filters}
        onChange={setFilters}
        categories={categories as any}
        suppliers={suppliers as any}
        isOpen={isFilterOpen}
      />

      <MobileCardList>
        {displayedProducts.slice(0, mobileCount).map((product) => (
          <MobileCard
            key={product.id}
            title={i18n.language === "uz" ? product.nameUz : product.nameRu}
            subtitle={product.barcode}
            fields={[
              {
                label: t("pos.id") + " (kod)",
                value: product.storeProductCode ?? product.id,
              },
              ...(product.internalCode
                ? [
                    {
                      label: t("products.internalCode") + " (PLU)",
                      value: product.internalCode,
                    },
                  ]
                : []),
              {
                label: t("products.price"),
                value: formatCurrency(product.price),
              },
              {
                label: t("products.stock"),
                value: (
                  <span
                    style={{
                      color:
                        product.stock <= product.minStock
                          ? "#f44336"
                          : "inherit",
                    }}
                  >
                    {product.stock} {product.unit}
                  </span>
                ),
              },
              {
                label: t("products.supplier"),
                value: product.supplier
                  ? i18n.language === "uz"
                    ? product.supplier.nameUz
                    : product.supplier.nameRu
                  : "-",
              },
              {
                label: t("products.category"),
                value: product.category
                  ? i18n.language === "uz"
                    ? product.category.nameUz
                    : product.category.nameRu
                  : "-",
              },
              {
                label: t("products.expiryDate"),
                value: product.expiryDate
                  ? formatDate(product.expiryDate)
                  : "-",
              },
              {
                label: t("products.status"),
                value: product.isActive
                  ? t("products.active")
                  : t("products.inactive"),
              },
            ]}
            actions={
              isAdmin ? (
                <>
                  <Button
                    variant="secondary"
                    size="small"
                    tooltip={t("common.edit")}
                    onClick={() => setEditProductId(String(product.id))}
                  >
                    <Edit size={16} />
                  </Button>
                  {product.isActive && (
                    <Button
                      variant="danger"
                      size="small"
                      tooltip={t("common.delete")}
                      onClick={() => handleDelete(product)}
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
                    <Eye size={16} />
                  </Button>
                </>
              ) : undefined
            }
          />
        ))}
      </MobileCardList>
      <MobileSentinel ref={sentinelRef} />

      <DesktopOnly>
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
      </DesktopOnly>

      {showFabScanner && (
        <BarcodeScannerModal
          onScan={handleFabScan}
          onClose={() => setShowFabScanner(false)}
          onManualEntry={() => {
            setFabInitialData(null);
            setShowProductForm(true);
          }}
        />
      )}

      {showProductForm && (
        <ProductForm
          initialData={fabInitialData ?? undefined}
          onClose={() => {
            setShowProductForm(false);
            setFabInitialData(null);
          }}
          onSuccess={() => {
            setShowProductForm(false);
            setFabInitialData(null);
            reloadWithFilters();
          }}
        />
      )}

      {editProductId && (
        <ProductForm
          productId={editProductId}
          onClose={() => setEditProductId(null)}
          onSuccess={() => {
            setEditProductId(null);
            reloadWithFilters();
          }}
        />
      )}

      {fabArrivalProductId && (
        <ProductForm
          productId={fabArrivalProductId}
          openArrival
          onClose={() => setFabArrivalProductId(null)}
          onSuccess={() => {
            setFabArrivalProductId(null);
            reloadWithFilters();
          }}
        />
      )}

    </Container>
  );
}
