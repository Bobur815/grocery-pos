import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useProducts } from "../../hooks/useProducts";
import { useAuthStore } from "../../store/auth-store";
import { useModeStore } from "../../store/mode-store";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { Product } from "@shared/types";
import { products as productsApi } from "../../api/ipc-client";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { ProductForm } from "./ProductForm";
import {
  Edit,
  Trash,
  ArrowLeft,
  TrendingUp,
  Package,
  DollarSign,
  Calendar,
  RefreshCcw,
} from "lucide-react";
import { getExpireInDays, getExpiryDays } from "@renderer/utils/helpers";
import { formatDate as formatDateUtil } from "../../utils/formatters";
import { DateInput } from "../../components/common/DateInput";

const Container = styled.div`
  min-width: 0;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  padding-left: 25px;
`;

const BackButton = styled(Button)`
  margin-right: ${({ theme }) => theme.spacing.md};
`;

const HeaderLeft = styled.div`
  align-items: center;
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.lg};

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const CardTitle = styled.h2`
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text};
  font-size: 18px;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.sm} 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const InfoLabel = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 16px;
`;

const InfoValue = styled.span`
  color: ${({ theme }) => theme.colors.text};
  font-weight: 500;
  font-size: 16px;
`;

const ProfitBadge = styled.span<{ $positive?: boolean }>`
  background-color: ${({ theme, $positive }) =>
    $positive ? theme.colors.success + "20" : theme.colors.error + "20"};
  color: ${({ theme, $positive }) =>
    $positive ? theme.colors.success : theme.colors.error};
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
`;

const AnalyticsSection = styled.div`
  grid-column: 1 / -1;
`;

const DateRangeRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: flex-end;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: ${({ theme }) => theme.spacing.md};

  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

const StatCard = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.md};
  text-align: center;
`;

const StatValue = styled.div`
  font-size: 18px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.primary};
`;

const StatLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const LoadingState = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xl};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

interface ProductAnalytics {
  productId: number;
  period: {
    startDate: string;
    endDate: string;
    days: number;
  };
  sales: {
    totalUnitsSold: number;
    totalRevenue: number;
    totalCost: number;
    profit: number;
    profitMargin: number;
    avgDailySales: number;
    transactionCount: number;
  };
  inventory: {
    currentStock: number;
    cost: number;
    inventoryValue: number;
  };
}

export function ProductDetails() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useAuthStore();
  const { getById, deleteProduct, isLoading } = useProducts();

  const [product, setProduct] = useState<Product | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [analytics, setAnalytics] = useState<ProductAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );

  const isAdmin = user?.role === "ADMIN";
  // Cost and analytics stay visible to an admin; only mutation moves to the web dashboard.
  const posAdminLocked = useModeStore((s) => s.posAdminLocked);
  const canManageProducts = isAdmin && !posAdminLocked;
  console.log(product);
  
  useEffect(() => {
    if (id) {
      loadProduct();
    }
  }, [id]);
  
  useEffect(() => {
    if (id && isAdmin) {
      loadAnalytics();
    }
  }, [id, isAdmin, startDate, endDate]);

  const loadProduct = async () => {
    if (!id) return;
    // Route param is a product's DB `id` (from the "view details" action) — resolve by
    // primary key to avoid a storeProductCode collision returning the wrong product.
    const p = await getById(id, { byDbId: true });
    setProduct(p);
  };

  const loadAnalytics = async () => {
    if (!id || !isAdmin) return;
    setAnalyticsLoading(true);
    try {
      const data = await productsApi.getAnalytics(
        Number(id),
        startDate,
        endDate,
      );
      setAnalytics(data as ProductAnalytics);
    } catch (error) {
      console.error("Failed to load analytics:", error);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !window.confirm(t("common.confirmDelete"))) return;
    const success = await deleteProduct(id);
    if (success) {
      navigate("/products");
    }
  };

  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    return formatDateUtil(dateString);
  };

  const getProductName = () => {
    if (!product) return "";
    return i18n.language === "uz" ? product.nameUz : product.nameRu;
  };

  const getSupplierName = () => {
    if (!product?.supplier) return "-";
    return i18n.language === "uz"
      ? product.supplier.nameUz
      : product.supplier.nameRu;
  };

  const getCategoryName = () => {
    if (!product?.category) return "-";
    return i18n.language === "uz"
      ? product.category.nameUz
      : product.category.nameRu;
  };

  const getProfitMarginFromPrice = () => {
    if (!product || !product.cost || product.cost === 0) return null;
    const margin =
      ((product.price - product.cost) / product.cost) * 100;
    return Math.round(margin * 100) / 100;
  };

  if (isLoading || !product) {
    return <LoadingState>{t("common.loading")}</LoadingState>;
  }

  const profitMargin = getProfitMarginFromPrice();
  const expiryDays = getExpiryDays(
    t,
    product?.productionDate,
    product?.expiryDate,
  );
  return (
    <Container>
      <Header>
        <HeaderLeft>
          <BackButton
            variant="secondary"
            size="small"
            onClick={() => navigate("/products")}
          >
            <ArrowLeft size={20} />
          </BackButton>
          <Title>{`${getProductName()} (№ ${product.storeProductCode ?? product.id})`}</Title>
        </HeaderLeft>
        {canManageProducts && (
          <Actions>
            <Button
              style={{ fontSize: "22px" }}
              variant="secondary"
              onClick={() => setShowEditModal(true)}
            >
              <Edit size={22} /> {t("common.edit")}
            </Button>
            <Button
              style={{ fontSize: "22px" }}
              variant="danger"
              onClick={handleDelete}
            >
              <Trash size={22} /> {t("common.delete")}
            </Button>
          </Actions>
        )}
      </Header>

      <Grid>
        {/* Basic Info */}
        <Card>
          <CardTitle>
            <Package size={24} /> {t("products.product")}
          </CardTitle>
          <InfoRow>
            <InfoLabel>{t("products.barcode")}</InfoLabel>
            <InfoValue>{product.barcode}</InfoValue>
          </InfoRow>
          {product.mxik && (
            <InfoRow>
              <InfoLabel>MXIK</InfoLabel>
              <InfoValue>{product.mxik}</InfoValue>
            </InfoRow>
          )}
          {product.internalCode && (
            <InfoRow>
              <InfoLabel>{t("products.internalCode")}</InfoLabel>
              <InfoValue>{product.internalCode}</InfoValue>
            </InfoRow>
          )}
          <InfoRow>
            <InfoLabel>{t("products.nameRu")}</InfoLabel>
            <InfoValue>{product.nameRu}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("products.nameUz")}</InfoLabel>
            <InfoValue>{product.nameUz}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("products.category")}</InfoLabel>
            <InfoValue>{getCategoryName()}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("products.unit")}</InfoLabel>
            <InfoValue>{product.unit}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("products.stock")}</InfoLabel>
            <InfoValue
              style={{
                color:
                  product.stock <= product.minStock ? "#f44336" : "inherit",
              }}
            >
              {product.stock} {product.unit}
            </InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("products.minStock")}</InfoLabel>
            <InfoValue>
              {product.minStock} {product.unit}
            </InfoValue>
          </InfoRow>
        </Card>

        {/* Pricing (Admin only shows cost) */}
        <Card>
          <CardTitle>
            <DollarSign size={24} /> {t("products.price")}
          </CardTitle>
          <InfoRow>
            <InfoLabel>{t("products.price")}</InfoLabel>
            <InfoValue>{formatCurrency(product.price)}</InfoValue>
          </InfoRow>
          {isAdmin && (
            <>
              <InfoRow>
                <InfoLabel>{t("products.cost")}</InfoLabel>
                <InfoValue>
                  {product.cost ? formatCurrency(product.cost) : "-"}
                </InfoValue>
              </InfoRow>
              {profitMargin !== null && (
                <InfoRow>
                  <InfoLabel>{t("products.profitMargin")}</InfoLabel>
                  <InfoValue>
                    <ProfitBadge $positive={profitMargin > 0}>
                      {profitMargin > 0 ? "+" : ""}
                      {profitMargin}%
                    </ProfitBadge>
                  </InfoValue>
                </InfoRow>
              )}
              <InfoRow>
                <InfoLabel>{t("products.inventoryValue")}</InfoLabel>
                <InfoValue>
                  {product.cost
                    ? formatCurrency(product.stock * product.cost)
                    : "-"}
                </InfoValue>
              </InfoRow>
            </>
          )}
          <InfoRow>
            <InfoLabel>{t("products.discountPercent")}</InfoLabel>
            <InfoValue>{product.discountPercent ?? 0}%</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("products.isOnPromotion")}</InfoLabel>
            <InfoValue>
              {product.isOnPromotion ? t("common.yes") : t("common.no")}
            </InfoValue>
          </InfoRow>
        </Card>

        {/* Expiration Dates */}
        <Card>
          <CardTitle>
            <Calendar size={24} /> {t("products.expiryDate")}
          </CardTitle>
          <InfoRow>
            <InfoLabel>{t("products.productionDate")}</InfoLabel>
            <InfoValue>{formatDate(product.productionDate)}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("products.expiryDate")}</InfoLabel>
            <InfoValue>{formatDate(product.expiryDate)}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("products.expiryDays")}</InfoLabel>
            <InfoValue>{expiryDays}</InfoValue>
          </InfoRow>

          <InfoRow>
            <InfoLabel>{t("products.expireInDays")}</InfoLabel>
            <InfoValue>
              {getExpireInDays(t, expiryDays, product?.expiryDate)}
            </InfoValue>
          </InfoRow>

          <InfoRow>
            <InfoLabel>{t("common.createdAt")}</InfoLabel>
            <InfoValue>{formatDate(product.createdAt)}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>{t("common.updatedAt")}</InfoLabel>
            <InfoValue>{formatDate(product.updatedAt)}</InfoValue>
          </InfoRow>
        </Card>

        {/* Supplier Info */}
        <Card>
          <CardTitle>
            <Package size={24} /> {t("products.supplier")}
          </CardTitle>
          {product.supplier ? (
            <>
              <InfoRow>
                <InfoLabel>{t("products.name")}</InfoLabel>
                <InfoValue>{getSupplierName()}</InfoValue>
              </InfoRow>
              <InfoRow>
                <InfoLabel>{t("users.phone")}</InfoLabel>
                <InfoValue>{product.supplier.phone || "-"}</InfoValue>
              </InfoRow>
              <InfoRow>
                <InfoLabel>{t("users.address")}</InfoLabel>
                <InfoValue>{product.supplier.address || "-"}</InfoValue>
              </InfoRow>
            </>
          ) : (
            <InfoRow>
              <InfoValue>{t("products.noSupplier")}</InfoValue>
            </InfoRow>
          )}
        </Card>

        {/* Analytics (Admin only) */}
        {isAdmin && (
          <AnalyticsSection>
            <Card>
              <CardTitle>
                <TrendingUp size={24} /> {t("products.salesAnalytics")}
              </CardTitle>

              <DateRangeRow>
                <DateInput
                  style={{ padding: "11px 12px", fontSize: "22px" }}
                  label={t("reports.startDate")}
                  value={startDate}
                  onChange={(val) => setStartDate(val)}
                />
                <DateInput
                  style={{ padding: "11px 12px", fontSize: "22px" }}
                  label={t("reports.endDate")}
                  value={endDate}
                  onChange={(val) => setEndDate(val)}
                />
                <Button onClick={loadAnalytics} disabled={analyticsLoading}>
                  <RefreshCcw size={24} /> {t("common.refresh")}
                </Button>
              </DateRangeRow>

              {analyticsLoading ? (
                <LoadingState>{t("common.loading")}</LoadingState>
              ) : analytics ? (
                <StatsGrid>
                  <StatCard>
                    <StatValue>{analytics.sales.totalUnitsSold}</StatValue>
                    <StatLabel>{t("products.unitsSold")}</StatLabel>
                  </StatCard>
                  <StatCard>
                    <StatValue>
                      {formatCurrency(analytics.sales.totalRevenue)}
                    </StatValue>
                    <StatLabel>{t("products.totalRevenue")}</StatLabel>
                  </StatCard>
                  <StatCard>
                    <StatValue>
                      {formatCurrency(analytics.sales.profit)}
                    </StatValue>
                    <StatLabel>{t("products.profit")}</StatLabel>
                  </StatCard>
                  <StatCard>
                    <StatValue>
                      <ProfitBadge $positive={analytics.sales.profitMargin > 0}>
                        {analytics.sales.profitMargin}%
                      </ProfitBadge>
                    </StatValue>
                    <StatLabel>{t("products.profitMargin")}</StatLabel>
                  </StatCard>
                  <StatCard>
                    <StatValue>{analytics.sales.avgDailySales}</StatValue>
                    <StatLabel>{t("products.avgDailySales")}</StatLabel>
                  </StatCard>
                  <StatCard>
                    <StatValue>{analytics.sales.transactionCount}</StatValue>
                    <StatLabel>{t("products.transactions")}</StatLabel>
                  </StatCard>
                  <StatCard>
                    <StatValue>{analytics.period.days}</StatValue>
                    <StatLabel>{t("products.daysInPeriod")}</StatLabel>
                  </StatCard>
                  <StatCard>
                    <StatValue>
                      {formatCurrency(analytics.inventory.inventoryValue)}
                    </StatValue>
                    <StatLabel>{t("products.inventoryValue")}</StatLabel>
                  </StatCard>
                </StatsGrid>
              ) : (
                <LoadingState>{t("products.noAnalyticsData")}</LoadingState>
              )}
            </Card>
          </AnalyticsSection>
        )}
      </Grid>

      {showEditModal && id && (
        <ProductForm
          productId={id}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            loadProduct();
          }}
        />
      )}
    </Container>
  );
}
