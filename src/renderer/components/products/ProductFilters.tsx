import React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Select } from "../common/Select";
import { Button } from "../common/Button";
import { ProductFilterParams, Category, Supplier } from "@shared/types";
import { Eraser } from "lucide-react";

interface ProductFiltersProps {
  filters: ProductFilterParams;
  onChange: (filters: ProductFilterParams) => void;
  categories: Category[];
  suppliers: Supplier[];
  compact?: boolean;
  isOpen?: boolean;
}

const FiltersBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: flex-end;
`;

const FilterItem = styled.div`
  min-width: 140px;
`;

export function ProductFilters({
  filters,
  onChange,
  categories,
  suppliers,
  compact = false,
  isOpen = false,
}: ProductFiltersProps) {
  const { t, i18n } = useTranslation();

  const update = (patch: Partial<ProductFilterParams>) => {
    onChange({ ...filters, ...patch });
  };

  const clearFilters = () => {
    onChange({});
  };

  const hasActiveFilters =
    filters.categoryId ||
    filters.supplierId ||
    filters.priceMin !== undefined ||
    filters.priceMax !== undefined ||
    (filters.availability && filters.availability !== "all") ||
    (filters.expiryStatus && filters.expiryStatus !== "all") ||
    (filters.unit && filters.unit !== "all") ||
    (filters.promotionStatus && filters.promotionStatus !== "all");

  const categoryOptions = categories.map((c) => ({
    value: String(c.id),
    label: i18n.language === "uz" ? c.nameUz : c.nameRu,
  }));

  const supplierOptions = suppliers.map((s) => ({
    value: s.id,
    label: i18n.language === "uz" ? s.nameUz : s.nameRu,
  }));

  const availabilityOptions = [
    { value: "all", label: t("filters.all") },
    { value: "in_stock", label: t("filters.inStock") },
    { value: "low_stock", label: t("filters.lowStock") },
    { value: "out_of_stock", label: t("filters.outOfStock") },
  ];

  const expiryOptions = [
    { value: "all", label: t("filters.all") },
    { value: "fresh", label: t("filters.fresh") },
    { value: "expiring_soon", label: t("filters.expiringSoon") },
    { value: "expired", label: t("filters.expired") },
  ];

  const unitOptions = [
    { value: "all", label: t("filters.all") },
    { value: "шт", label: "шт" },
    { value: "кг", label: "кг" },
    { value: "л", label: "л" },
    { value: "м", label: "м" },
  ];

  const promotionOptions = [
    { value: "all", label: t("filters.all") },
    { value: "on_promotion", label: t("filters.onPromotion") },
    { value: "no_promotion", label: t("filters.noPromotion") },
  ];

  if (!isOpen) return null;

  return (
    <FiltersBar>
      <FilterItem>
        <Select
          selectSize="small"
          label={t("filters.category")}
          placeholder={t("filters.all")}
          options={categoryOptions}
          style={{ padding: "8px" }}
          value={filters.categoryId ? String(filters.categoryId) : ""}
          onChange={(e) =>
            update({
              categoryId: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
      </FilterItem>

      {!compact && (
        <FilterItem>
          <Select
            style={{ padding: "8px" }}
            selectSize="small"
            label={t("filters.supplier")}
            placeholder={t("filters.all")}
            options={supplierOptions}
            value={filters.supplierId || ""}
            onChange={(e) =>
              update({ supplierId: e.target.value || undefined })
            }
          />
        </FilterItem>
      )}

      <FilterItem>
        <Select
          style={{ padding: "8px" }}
          selectSize="small"
          label={t("filters.availability")}
          options={availabilityOptions}
          value={filters.availability || "all"}
          onChange={(e) =>
            update({
              availability: e.target
                .value as ProductFilterParams["availability"],
            })
          }
        />
      </FilterItem>

      {!compact && (
        <FilterItem>
          <Select
            style={{ padding: "8px" }}
            selectSize="small"
            label={t("filters.expiryStatus")}
            options={expiryOptions}
            value={filters.expiryStatus || "all"}
            onChange={(e) =>
              update({
                expiryStatus: e.target
                  .value as ProductFilterParams["expiryStatus"],
              })
            }
          />
        </FilterItem>
      )}

      <FilterItem>
        <Select
          style={{ padding: "8px" }}
          selectSize="small"
          label={t("filters.unitType")}
          options={unitOptions}
          value={filters.unit || "all"}
          onChange={(e) =>
            update({ unit: e.target.value as ProductFilterParams["unit"] })
          }
        />
      </FilterItem>

      <FilterItem>
        <Select
          style={{ padding: "8px" }}
          selectSize="small"
          label={t("filters.promotion")}
          options={promotionOptions}
          value={filters.promotionStatus || "all"}
          onChange={(e) =>
            update({
              promotionStatus: e.target
                .value as ProductFilterParams["promotionStatus"],
            })
          }
        />
      </FilterItem>

      {hasActiveFilters && (
        <Button variant="secondary" size="medium" onClick={clearFilters}>
          <Eraser size={18}/> {t("filters.clearFilters")}
        </Button>
      )}
    </FiltersBar>
  );
}
