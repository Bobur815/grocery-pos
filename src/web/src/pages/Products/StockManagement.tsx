import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useProducts } from "../../hooks/useProducts";
import { useAuthStore } from "../../store/auth-store";
import { Table } from "@components/common/Table";
import { Pagination } from "@components/common/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { Button } from "@components/common/Button";
import { Input } from "@components/common/Input";
import { ProductFilters } from "@components/products/ProductFilters";
import { Product, ProductFilterParams } from "@shared/types";
import { useToast } from "@context/ToastContext";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  ListFilter,
  ScanLine,
  SendHorizontal,
  X,
} from "lucide-react";
import { SupplierManagementModal } from "../Suppliers/SupplierManagementModal";
import { NewArrivalModal } from "./NewArrivalModal";
import { ReceiptScanModal } from "./ReceiptScanModal";
import { debounce } from "../../utils/helpers";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import {
  MobileCard,
  MobileCardList,
  DesktopOnly,
} from "../../components/common/MobileCard";
import { BarcodeScannerModal } from "../../components/common/BarcodeScannerModal";
import { SubNav, useStockSubNav } from "../../components/layout/SubNav";

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
  gap: ${({ theme }) => theme.spacing.md};

  @media (max-width: 768px) {
    gap: ${({ theme }) => theme.spacing.sm};
  }
`;

const SearchRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: flex-end;
  flex-wrap: wrap;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const SearchField = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  flex: 1;
  min-width: 120px;
`;

const SearchLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  font-weight: 500;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  font-size: 16px;
  font-weight: bold;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  transition: border-color 0.2s;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const SubmitButton = styled.button`
  height: 40px;
  width: 46px;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: none;
  background-color: ${({ theme }) => theme.colors.success};
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 46px;
  transition:
    background-color 0.2s,
    transform 0.1s;
  &:hover {
    opacity: 0.9;
  }

  &:active {
    transform: scale(0.95);
  }

  @media (max-width: 768px) {
    width: auto;
    flex: 1;
  }
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.75rem;
  flex: 1;
  color: ${({ theme }) => theme.colors.text};

  @media (max-width: 768px) {
    font-size: 1.5rem;
  }
`;

const LowStockBadge = styled.span`
  background-color: ${({ theme }) => theme.colors.warning};
  color: white;
  padding: 6px 8px;
  border-radius: 12px;
  font-size: 12px;
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

const OutOfStockBadge = styled.span`
  background-color: ${({ theme }) => theme.colors.error};
  color: white;
  padding: 6px 8px;
  border-radius: 12px;
  font-size: 12px;
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

const SearchWrapper = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: flex-end;
  position: relative;
  flex: 1;
  min-width: 200px;
`;

const ClearBtn = styled.button`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;
  padding: 4px;
`;

const PluField = styled(SearchField)`
  @media (min-width: 769px) {
    max-width: 320px;
  }
`;

const StockCell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MobileSentinel = styled.div`
  height: 1px;
  @media (min-width: 769px) {
    display: none;
  }
`;

const MOBILE_PAGE_SIZE = 20;

export function StockManagement() {
  const { t, i18n } = useTranslation();
  const {
    products,
    categories,
    suppliers,
    loadProducts,
    loadCategories,
    loadSuppliers,
    searchByBarcode,
    getById,
    findByInternalCode,
    isLoading,
  } = useProducts();
  const { user } = useAuthStore();
  const toast = useToast();

  const [showArrival, setShowArrival] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<ProductFilterParams>({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [idInput, setIdInput] = useState("");
  const [pluInput, setPluInput] = useState("");
  const reloadWithFilters = useCallback(() => {
    const params: ProductFilterParams = { ...filters };
    if (searchQuery.trim()) params.query = searchQuery;
    loadProducts(params);
  }, [loadProducts, filters, searchQuery]);

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showReceiptScan, setShowReceiptScan] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  const [mobileCount, setMobileCount] = useState(MOBILE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset mobile count when the product list changes (new search/filter result)
  useEffect(() => {
    setMobileCount(MOBILE_PAGE_SIZE);
  }, [products]);

  // Infinite scroll: load next batch when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && mobileCount < products.length) {
          setMobileCount((c) =>
            Math.min(c + MOBILE_PAGE_SIZE, products.length),
          );
        }
      },
      { rootMargin: "150px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mobileCount, products.length]);

  useEffect(() => {
    loadProducts();
    loadCategories();
    loadSuppliers();
  }, [loadProducts, loadCategories, loadSuppliers]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const debouncedSearch = useMemo(
    () =>
      debounce((query: string, f: ProductFilterParams) => {
        const params: ProductFilterParams = { ...f };
        if (query.trim()) {
          params.query = query;
        }
        loadProducts(params);
      }, 300),
    [loadProducts],
  );

  useEffect(() => {
    debouncedSearch(searchQuery, filters);
  }, [filters, searchQuery, debouncedSearch]);

  const handleAddArrival = (product: Product) => {
    setSelectedProduct(product);
    setShowArrival(true);
  };

  const handleBarcodeSubmit = useCallback(async () => {
    if (!barcodeInput.trim()) return;
    const product = (await searchByBarcode(
      barcodeInput.trim(),
    )) as Product | null;
    if (product) {
      handleAddArrival(product);
      setBarcodeInput("");
    } else {
      toast.error(t("products.noResults"));
      setBarcodeInput("");
    }
  }, [barcodeInput, searchByBarcode, t]);

  const handleIdSubmit = useCallback(async () => {
    const raw = idInput.trim();
    if (!raw) return;
    const product = (await getById(raw)) as Product | null;
    if (product) {
      handleAddArrival(product);
      setIdInput("");
    } else {
      toast.error(t("products.noResults"));
      setIdInput("");
    }
  }, [idInput, getById, t]);

  const handlePluSubmit = useCallback(async () => {
    const raw = pluInput.trim();
    if (!raw) return;
    const code = /^\d+$/.test(raw) ? raw.padStart(6, "0") : raw;
    const product = (await findByInternalCode(code)) as Product | null;
    if (product) {
      handleAddArrival(product);
      setPluInput("");
    } else {
      toast.error(t("products.noResults"));
      setPluInput("");
    }
  }, [pluInput, findByInternalCode, t]);

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
  } = usePagination(products);

  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");

  const columns = [
    {
      key: "#",
      header: "#",
      render: (_: Product, index: number) => pageOffset + index + 1,
    },
    { key: "id", header: t("pos.id"), render: (p: Product) => p.storeProductCode ?? p.id },
    { key: "barcode", header: t("products.barcode") },
    {
      key: "name",
      header: t("products.name"),
      render: (product: Product) =>
        i18n.language === "uz" ? product.nameUz : product.nameRu,
    },
    {
      key: "cost",
      header: t("products.cost"),
      render: (product: Product) =>
        product.cost ? formatCurrency(product.cost) : "—",
    },
    {
      key: "price",
      header: t("products.price"),
      render: (product: Product) => formatCurrency(product.price),
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
          {product.stock <= 0 ? (
            <OutOfStockBadge>{t("products.outOfStock")}</OutOfStockBadge>
          ) : product.stock <= product.minStock ? (
            <LowStockBadge>{t("products.lowStock")}</LowStockBadge>
          ) : null}
        </span>
      ),
    },
    {
      key: "minStock",
      header: t("products.minStock"),
      render: (product: Product) => `${product.minStock} ${product.unit}`,
    },
    {
      key: "actions",
      header: "",
      render: (product: Product) => (
        <Button size="medium" onClick={() => handleAddArrival(product)}>
          {t("inventory.addArrival")}
        </Button>
      ),
    },
  ];

  const subNav = useStockSubNav();

  return (
    <Container>
      {/* Section tabs — the mobile bar carries sections only, so a section's sibling
          pages live here. See components/layout/SubNav.tsx. */}
      <SubNav items={subNav} />
      <Header>
        <Title>{t("inventory.stockManagement")}</Title>
        {user?.role === "ADMIN" && (
          <Button size="medium" onClick={() => setShowReceiptScan(true)}>
            <ScanLine size={24} />
            {t("receiptScan.scanReceipt")}
          </Button>
        )}
      </Header>

      <SearchRow>
        <SearchWrapper>
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("common.search")}
            style={{ paddingRight: "32px", fontSize: 18, fontWeight: "bold" }}
          />
          {searchQuery.length > 0 && (
            <ClearBtn onClick={() => setSearchQuery("")} tabIndex={-1}>
              <X size={16} />
            </ClearBtn>
          )}

          <Button
            size="medium"
            style={{ padding: "9px 12px" }}
            onClick={() => setIsFilterOpen(!isFilterOpen)}
          >
            <ListFilter />{" "}
            {isFilterOpen ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </SearchWrapper>

        <SearchField>
          <SearchLabel>{t("pos.barcode")}</SearchLabel>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <SearchInput
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleBarcodeSubmit();
                }
              }}
              placeholder={t("pos.enterBarcode")}
            />
            {isMobile && (
              <Button
                type="button"
                variant="secondary"
                size="medium"
                style={{ padding: "9px 13px", flexShrink: 0 }}
                onClick={() => setShowScanner(true)}
                title={t("scanner.title") || "Scan barcode"}
              >
                <Camera size={18} />
              </Button>
            )}
          </div>
        </SearchField>

        <PluField>
          <SearchLabel>KOD / PLU</SearchLabel>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <SearchInput
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleIdSubmit();
                }
              }}
              placeholder={t("pos.id")}
            />
            <SearchInput
              value={pluInput}
              onChange={(e) => setPluInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handlePluSubmit();
                }
              }}
              placeholder="PLU"
            />
            <SubmitButton
              onClick={() => {
                if (barcodeInput.trim()) handleBarcodeSubmit();
                else if (idInput.trim()) handleIdSubmit();
                else if (pluInput.trim()) handlePluSubmit();
              }}
            >
              <SendHorizontal size={22} />
            </SubmitButton>
          </div>
        </PluField>
      </SearchRow>

      <ProductFilters
        filters={filters}
        onChange={setFilters}
        categories={categories as any}
        suppliers={suppliers}
        isOpen={isFilterOpen}
      />

      <MobileCardList>
        {products.slice(0, mobileCount).map((product) => (
          <MobileCard
            key={product.id}
            title={i18n.language === "uz" ? product.nameUz : product.nameRu}
            subtitle={product.barcode}
            fields={[
              {
                label: t("products.stock"),
                value: (
                  <StockCell>
                    <span
                      style={{
                        color:
                          product.stock <= product.minStock
                            ? "#f44336"
                            : "inherit",
                        fontWeight: 600,
                      }}
                    >
                      {product.stock} {product.unit}
                    </span>
                    {product.stock <= 0 ? (
                      <OutOfStockBadge style={{ marginLeft: 0 }}>
                        {t("products.outOfStock")}
                      </OutOfStockBadge>
                    ) : product.stock <= product.minStock ? (
                      <LowStockBadge style={{ marginLeft: 0 }}>
                        {t("products.lowStock")}
                      </LowStockBadge>
                    ) : null}
                  </StockCell>
                ),
              },
              {
                label: t("products.minStock"),
                value: `${product.minStock} ${product.unit}`,
              },
              {
                label: t("products.price"),
                value: formatCurrency(product.price),
              },
              {
                label: t("products.cost"),
                value: product.cost ? formatCurrency(product.cost) : "—",
              },
            ]}
            actions={
              <Button size="medium" onClick={() => handleAddArrival(product)}>
                {t("inventory.addArrival")}
              </Button>
            }
          />
        ))}
      </MobileCardList>
      <MobileSentinel ref={sentinelRef} />

      <DesktopOnly>
        <Table
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

      {showArrival && selectedProduct && (
        <NewArrivalModal
          product={selectedProduct}
          suppliers={suppliers}
          userId={user?.id}
          onClose={() => setShowArrival(false)}
          onSuccess={() => {
            setShowArrival(false);
            reloadWithFilters();
            toast.success(t("inventory.arrivalCreated"));
          }}
          onOpenSupplierModal={() => setShowSupplierModal(true)}
        />
      )}
      {showSupplierModal && (
        <SupplierManagementModal
          onClose={() => setShowSupplierModal(false)}
          onSupplierChanged={loadSuppliers}
        />
      )}
      {showScanner && (
        <BarcodeScannerModal
          onScan={(barcode) => {
            setShowScanner(false);
            setBarcodeInput(barcode);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
      {showReceiptScan && (
        <ReceiptScanModal
          suppliers={suppliers}
          products={products}
          userId={user?.id}
          onClose={() => setShowReceiptScan(false)}
          onSuccess={() => {
            setShowReceiptScan(false);
            reloadWithFilters();
            toast.success(t("inventory.arrivalCreated"));
          }}
        />
      )}
    </Container>
  );
}
