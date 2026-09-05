import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { generateProductBarcode } from "@shared/utils/barcode-parser";
import { useProducts } from "../../hooks/useProducts";
import { useAuthStore } from "../../store/auth-store";
import { useToast } from "../../context/ToastContext";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { Modal } from "../../components/common/Modal";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import {
  Product,
  ProductType,
  ProductUnit,
  Supplier,
  SupplierPaymentMethod,
} from "@shared/types";
import {
  SUPPLIER_PAYMENT_METHODS,
  SUPPLIER_PAYMENT_METHOD_I18N_KEYS,
} from "@shared/constants/payment-methods";
import { convertUzbekText } from "@shared/utils/transliterator";
import { pickSingleUnitPackage, type MxikPackage } from "@shared/utils/mxik-packages";
import { isMxikExcluded, type CatalogEntry } from "@shared/types/mxik.types";
import {
  RefreshCw,
  Settings,
  Search,
  ChevronDown,
  ChevronRight,
  ImageIcon,
} from "lucide-react";
import { SupplierManagementModal } from "../Suppliers/SupplierManagementModal";
import { CategoryManagementModal } from "./CategoryManagementModal";
import { DateInput } from "../../components/common/DateInput";
import { Spinner } from "../../components/common/Spinner";

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  margin-top: ${({ theme }) => theme.spacing.lg};
`;

const Select = styled.select`
  width: 100%;
  padding: ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const PickerList = styled.div`
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow-y: auto;
  margin-top: ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const PickerItem = styled.div`
  padding: 10px 12px;
  cursor: pointer;
  &:not(:last-child) { border-bottom: 1px solid ${({ theme }) => theme.colors.border}; }
  &:hover { background: ${({ theme }) => theme.colors.background}; }
`;

const PickerItemName = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const PickerItemMeta = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const ProductInfo = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ProductInfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.xs} 0;

  &:not(:last-child) {
    border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  }
`;

const ProductInfoLabel = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ProductInfoValue = styled.span`
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const ArrivalForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const ModalActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  justify-content: flex-end;
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const ProfitBadge = styled.span<{ $negative?: boolean }>`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme, $negative }) =>
    $negative ? theme.colors.error : theme.colors.success};
`;

const Req = styled.span`
  color: ${({ theme }) => theme.colors.error};
  margin-left: 2px;
`;

const PriceChangeSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  background-color: ${({ theme }) => theme.colors.warning}10;
  border: 1px solid ${({ theme }) => theme.colors.warning}40;
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const PriceChangeTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const RadioOption = styled.label<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid
    ${({ theme, $active }) =>
      $active ? theme.colors.primary : theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  cursor: pointer;
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primary + "10" : "transparent"};
  transition: all 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const RadioText = styled.div`
  flex: 1;
`;

const RadioLabel = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const RadioDescription = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const TabRow = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 2px solid ${({ theme }) => theme.colors.border};
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid
    ${({ $active, theme }) => ($active ? theme.colors.primary : "transparent")};
  margin-bottom: -2px;
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary : theme.colors.textSecondary};
  cursor: pointer;
`;

/** Keeps the modal from resizing as the user moves between tabs. */
const TabPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  min-height: 300px;
`;

const FoldToggle = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: ${({ theme }) => theme.spacing.sm} 0;
  background: none;
  border: none;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const FoldBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const PhotoPlaceholder = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.lg};
  min-height: 280px;
  border: 2px dashed ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const PhotoTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const PhotoHint = styled.div`
  font-size: 13px;
  text-align: center;
  max-width: 340px;
`;

type FormTab = "general" | "tax" | "photo";

const UNIT_OPTIONS: ProductUnit[] = ["шт", "кг", "л", "м"];

interface ProductFormProps {
  productId?: string;
  initialData?: {
    nameRu?: string;
    nameUz?: string;
    mxik?: string;
    packageCode?: string;
    cost?: number;
    stock?: number;
    minStock?: number;
    unit?: ProductUnit;
    categoryId?: string;
    supplierId?: string;
    productionDate?: string;
    expiryDate?: string;
    discountPercent?: number;
    isOnPromotion?: boolean;
    active?: boolean;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export function ProductForm({
  productId,
  initialData,
  onClose,
  onSuccess,
}: ProductFormProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { user } = useAuthStore();
  const {
    getById,
    searchByBarcode,
    createProduct,
    updateProduct,
    categories,
    suppliers,
    loadCategories,
    loadSuppliers,
    isLoading,
    error,
  } = useProducts();

  const isEdit = Boolean(productId);
  const barcodeCheckTimeout = useRef<NodeJS.Timeout | null>(null);

  const [formData, setFormData] = useState({
    barcode: "",
    nameRu: initialData?.nameRu || "",
    nameUz: initialData?.nameUz || "",
    price: "",
    cost: initialData?.cost ? String(initialData.cost) : "",
    stock: initialData?.stock ? String(initialData.stock) : "0",
    minStock: "0",
    unit: "шт" as ProductUnit,
    categoryId: "",
    supplierId: "",
    productionDate: "",
    expiryDate: "",
    discountPercent: "",
    isOnPromotion: false,
    active: true,
    mxik: initialData?.mxik || "",
    packageCode: initialData?.packageCode || "",
    vatRate: "",
    productType: "REGULAR" as ProductType,
    internalCode: "",
  });

  const [tab, setTab] = useState<FormTab>("general");
  // Everything that is not required starts collapsed: the common case is scanning a barcode,
  // typing a name and a price, and saving.
  const [showMore, setShowMore] = useState(false);

  const [existingProduct, setExistingProduct] = useState<Product | null>(null);
  const [showArrivalModal, setShowArrivalModal] = useState(false);
  const [arrivalData, setArrivalData] = useState({
    quantity: "",
    cost: "",
    newPrice: "",
    priceMode: "none" as "none" | "immediate" | "deferred",
    notes: "",
    supplierId: "",
    paymentMethod: "CASH" as SupplierPaymentMethod,
    productionDate: "",
    expirationDate: "",
  });
  const [isSubmittingArrival, setIsSubmittingArrival] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [mxikPackages, setMxikPackages] = useState<MxikPackage[]>([]);

  // MXIK picker (search the catalog by name) — mirrors the web ProductForm.
  const [showMxikPicker, setShowMxikPicker] = useState(false);
  const [mxikPickerQuery, setMxikPickerQuery] = useState("");
  const [mxikPickerResults, setMxikPickerResults] = useState<CatalogEntry[]>([]);
  const [mxikPickerLoading, setMxikPickerLoading] = useState(false);
  const [mxikPickerPage, setMxikPickerPage] = useState(0);
  const [mxikPickerTotal, setMxikPickerTotal] = useState(0);
  const [mxikLoadingMore, setMxikLoadingMore] = useState(false);

  // When the MXIK is a full 17-digit code, fetch its package (unit) codes from tasnif.
  // Marked goods need a `package_code`; we default to the single-unit package.
  useEffect(() => {
    const mxik = formData.mxik.trim();
    if (!/^\d{17}$/.test(mxik)) {
      setMxikPackages([]);
      return;
    }
    let active = true;
    window.electronAPI.mxik.getPackages(mxik).then((pkgs) => {
      if (!active) return;
      const list = pkgs as MxikPackage[];
      setMxikPackages(list);
      if (list.length === 0) return;
      // Keep the selected package only when it belongs to THIS MXIK — changing the MXIK
      // must not leave the previous product's package_code behind.
      setFormData((prev) => {
        if (list.some((p) => p.code === prev.packageCode)) return prev;
        const def = pickSingleUnitPackage(list);
        return def ? { ...prev, packageCode: def.code } : prev;
      });
    }).catch(() => { if (active) setMxikPackages([]); });
    return () => { active = false; };
  }, [formData.mxik]);

  // Auto-pick the category whose mxikGroupCode covers this MXIK's 3-digit group.
  // mxikGroupCode may be comma-separated (e.g. "007,008") for multi-group categories.
  const autoSelectCategory = useCallback(
    (groupCode: string) => {
      const cat = categories.find((c) =>
        c.mxikGroupCode?.split(",").map((g) => g.trim()).includes(groupCode),
      );
      if (cat) {
        setFormData((prev) => ({ ...prev, categoryId: String(cat.id) }));
        toast.info(t("products.categoryAutoSelected"));
      }
    },
    [categories, t, toast],
  );

  const handlePickerSelect = (entry: CatalogEntry) => {
    if (isMxikExcluded(entry.mxikCode)) {
      toast.error(t("products.categoryNotAllowed", { category: entry.className }));
      return;
    }
    setFormData((prev) => ({ ...prev, mxik: entry.mxikCode }));
    autoSelectCategory(entry.mxikCode.slice(0, 3));
    setShowMxikPicker(false);
    setMxikPickerQuery("");
    setMxikPickerResults([]);
    setMxikPickerTotal(0);
    setMxikPickerPage(0);
  };

  const doMxikSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setMxikPickerResults([]);
      setMxikPickerTotal(0);
      setMxikPickerPage(0);
      return;
    }
    setMxikPickerLoading(true);
    const { results, total } = await window.electronAPI.mxik.catalogSearch(q.trim(), 0, 10);
    setMxikPickerResults(results);
    setMxikPickerTotal(total);
    setMxikPickerPage(0);
    setMxikPickerLoading(false);
  }, []);

  // Debounce the search as the query changes while the picker is open.
  useEffect(() => {
    if (!showMxikPicker) return;
    const id = setTimeout(() => doMxikSearch(mxikPickerQuery), 300);
    return () => clearTimeout(id);
  }, [mxikPickerQuery, showMxikPicker, doMxikSearch]);

  const handleMxikLoadMore = async () => {
    const nextPage = mxikPickerPage + 1;
    setMxikLoadingMore(true);
    const { results, total } = await window.electronAPI.mxik.catalogSearch(
      mxikPickerQuery.trim(),
      nextPage,
      10,
    );
    setMxikPickerResults((prev) => [...prev, ...results]);
    setMxikPickerTotal(total);
    setMxikPickerPage(nextPage);
    setMxikLoadingMore(false);
  };

  useEffect(() => {
    loadCategories();
    loadSuppliers();

    if (isEdit && productId) {
      loadProduct();
    }
  }, [productId, isEdit]);

  useEffect(() => {
    if (isEdit) return; // keep existing code when editing
    if (formData.productType === "REGULAR") {
      setFormData((prev) => ({ ...prev, internalCode: "" }));
      return;
    }
    window.electronAPI.products.getNextInternalCode().then((code) => {
      setFormData((prev) => ({ ...prev, internalCode: code }));
    });
  }, [formData.productType, isEdit]);

  const checkBarcode = useCallback(
    async (barcode: string) => {
      if (!barcode || barcode.length < 3 || isEdit) return;

      const product = await searchByBarcode(barcode);
      if (product) {
        setExistingProduct(product);
        setShowArrivalModal(true);
        setArrivalData((prev) => ({
          ...prev,
          cost: product.cost ? String(product.cost) : "",
          newPrice: String(product.price),
          priceMode: "none",
          supplierId: product.supplierId || "",
          productionDate: product.productionDate
            ? product.productionDate.split("T")[0]
            : "",
          expirationDate: product.expiryDate
            ? product.expiryDate.split("T")[0]
            : "",
        }));
        return;
      }

      // New product — auto-fill MXIK + name from tasnif (same as the web ProductForm).
      // The package effect then derives package_code from the filled MXIK.
      try {
        const info = await window.electronAPI.mxik.lookupByBarcode(barcode);
        if (info?.code) {
          if (isMxikExcluded(info.code)) {
            toast.error(t("products.categoryNotAllowed", { category: info.nameRu || info.name }));
            setFormData((prev) => ({ ...prev, barcode: "" }));
            return;
          }
          setFormData((prev) => ({
            ...prev,
            mxik: info.code,
            nameUz: prev.nameUz || info.name,
            nameRu: prev.nameRu || info.nameRu,
          }));
          autoSelectCategory(info.code.slice(0, 3));
        }
      } catch {
        // tasnif unreachable — manual entry, no toast needed
      }
    },
    [searchByBarcode, isEdit, t, toast, autoSelectCategory],
  );

  const handleGenerateBarcode = () => {
    const code = generateProductBarcode();
    setFormData((prev) => ({ ...prev, barcode: code }));
  };

  const handleBarcodeChange = (value: string) => {
    setFormData((prev) => ({ ...prev, barcode: value }));

    if (barcodeCheckTimeout.current) {
      clearTimeout(barcodeCheckTimeout.current);
    }

    if (value.length >= 8) {
      checkBarcode(value);
    } else if (value.length >= 3) {
      barcodeCheckTimeout.current = setTimeout(() => {
        checkBarcode(value);
      }, 800);
    }
  };

  const costChanged =
    existingProduct &&
    arrivalData.cost !== "" &&
    Number(arrivalData.cost) !== (existingProduct.cost ?? 0);

  const arrivalProfitMargin =
    arrivalData.cost && arrivalData.newPrice
      ? (
          ((Number(arrivalData.newPrice) - Number(arrivalData.cost)) /
            Number(arrivalData.cost)) *
          100
        ).toFixed(1)
      : null;

  const handleArrivalSubmit = async () => {
    if (!existingProduct || !arrivalData.quantity || !arrivalData.cost) return;

    setIsSubmittingArrival(true);
    try {
      await window.electronAPI.inventory.createArrival({
        productId: existingProduct.id,
        quantity: parseFloat(arrivalData.quantity),
        cost: parseFloat(arrivalData.cost),
        notes: arrivalData.notes || undefined,
        supplierId: arrivalData.supplierId || undefined,
        paymentMethod: arrivalData.supplierId
          ? arrivalData.paymentMethod
          : undefined,
        createdBy: user?.id,
        newPrice:
          arrivalData.priceMode !== "none"
            ? Number(arrivalData.newPrice)
            : undefined,
        priceMode:
          arrivalData.priceMode !== "none" ? arrivalData.priceMode : undefined,
        productionDate: arrivalData.productionDate || undefined,
        expiryDate: arrivalData.expirationDate || undefined,
      });

      toast.success(t("inventory.arrivalCreated") || t("common.saved"));
      setShowArrivalModal(false);
      setExistingProduct(null);
      setFormData((prev) => ({ ...prev, barcode: "" }));
      setArrivalData({
        quantity: "",
        cost: "",
        newPrice: "",
        priceMode: "none",
        notes: "",
        supplierId: "",
        paymentMethod: "INSTALLMENT",
        productionDate: "",
        expirationDate: "",
      });
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setIsSubmittingArrival(false);
    }
  };

  const handleCloseArrivalModal = () => {
    setShowArrivalModal(false);
    setExistingProduct(null);
    setFormData((prev) => ({ ...prev, barcode: "" }));
  };

  const getUnitLabel = (unit: ProductUnit) => {
    const labels: Record<ProductUnit, string> = {
      шт: t("units.piece"),
      кг: t("units.kg"),
      л: t("units.liter"),
      м: t("units.meter"),
    };
    return labels[unit];
  };

  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");

  const formProfitMargin =
    formData.price && formData.cost
      ? (
          ((Number(formData.price) - Number(formData.cost)) /
            Number(formData.cost)) *
          100
        ).toFixed(1)
      : null;

  const loadProduct = async () => {
    if (!productId) return;

    // Resolve by DB primary key — productId comes from a product row's `id`, which can
    // collide with another product's storeProductCode in the default lookup.
    const product = await getById(productId, { byDbId: true });
    if (product) {
      setFormData({
        barcode: product.barcode,
        nameRu: product.nameRu,
        nameUz: product.nameUz,
        price: String(product.price),
        cost: product.cost ? String(product.cost) : "",
        stock: String(product.stock),
        minStock: String(product.minStock),
        unit: product.unit,
        categoryId: String(product.categoryId),
        supplierId: product.supplierId || "",
        productionDate: product.productionDate
          ? product.productionDate.split("T")[0]
          : "",
        expiryDate: product.expiryDate ? product.expiryDate.split("T")[0] : "",
        discountPercent:
          product.discountPercent != null
            ? String(product.discountPercent)
            : "",
        isOnPromotion: product.isOnPromotion ?? false,
        active: product.isActive,
        mxik: product.mxik || "",
        packageCode: product.packageCode || "",
        vatRate: product.vatRate != null ? String(product.vatRate) : "",
        productType: product.productType || "REGULAR",
        internalCode: product.internalCode || "",
      });
    }
  };

  /**
   * The tab holding the first missing required field, or null when the form is complete.
   *
   * Only the active tab is mounted, so the browser can only validate the fields currently on
   * screen — a missing MXIK on the Tax tab would let a submit through unnoticed. Checked here
   * so the form can jump to the tab that needs attention instead of failing silently.
   */
  const firstInvalidTab = (): FormTab | null => {
    if (
      !formData.barcode.trim() ||
      !formData.nameUz.trim() ||
      !formData.nameRu.trim() ||
      !String(formData.price).trim() ||
      !formData.categoryId
    ) {
      return "general";
    }
    if (!formData.mxik.trim()) return "tax";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const invalidTab = firstInvalidTab();
    if (invalidTab) {
      setTab(invalidTab);
      toast.error(t("products.fillRequired", "Заполните обязательные поля"));
      return;
    }

    const data = {
      barcode: formData.barcode,
      nameRu: formData.nameRu,
      nameUz: formData.nameUz,
      price: parseFloat(formData.price),
      cost: formData.cost ? parseFloat(formData.cost) : undefined,
      // When editing, omit stock — managed by inventory arrivals/sales only.
      // Including it would overwrite concurrent changes (arrivals, sales).
      ...(isEdit ? {} : { stock: parseInt(formData.stock) || 0 }),
      minStock: parseInt(formData.minStock) || 0,
      unit: formData.unit,
      categoryId: Number(formData.categoryId),
      supplierId: formData.supplierId || undefined,
      productionDate: formData.productionDate || undefined,
      expiryDate: formData.expiryDate || undefined,
      discountPercent: formData.discountPercent
        ? parseFloat(formData.discountPercent)
        : 0,
      isOnPromotion: formData.isOnPromotion,
      active: formData.active,
      mxik: formData.mxik,
      packageCode: formData.packageCode || undefined,
      productType: formData.productType,
      internalCode: formData.internalCode || undefined,
      // Empty = "use store default" (null); otherwise the chosen per-product rate (0/6/12).
      vatRate: formData.vatRate === "" ? null : parseFloat(formData.vatRate),
    };

    let success = false;
    if (isEdit && productId) {
      success = await updateProduct(productId, data);
      if (success) toast.success(t("common.saved"));
    } else {
      success = await createProduct(data);
      if (success) toast.success(t("common.saved"));
    }

    if (success) {
      onSuccess();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleNameUzChange = (value: string) => {
    setFormData((prev) => {
      const converted = convertUzbekText(value);
      return {
        ...prev,
        nameUz: value,
        nameRu:
          prev.nameRu === "" || prev.nameRu === convertUzbekText(prev.nameUz)
            ? converted
            : prev.nameRu,
      };
    });
  };

  const handleNameRuChange = (value: string) => {
    setFormData((prev) => {
      const converted = convertUzbekText(value);
      return {
        ...prev,
        nameRu: value,
        nameUz:
          prev.nameUz === "" || prev.nameUz === convertUzbekText(prev.nameRu)
            ? converted
            : prev.nameUz,
      };
    });
  };

  const title = isEdit ? t("products.edit") : t("products.add");

  return (
    <>
      <Modal title={title} onClose={onClose} width="750px">
        <Form onSubmit={handleSubmit}>
          <TabRow>
            <Tab
              type="button"
              $active={tab === "general"}
              onClick={() => setTab("general")}
            >
              {t("products.tabGeneral", "Основное")}
            </Tab>
            <Tab
              type="button"
              $active={tab === "tax"}
              onClick={() => setTab("tax")}
            >
              {t("products.tabTax", "Налоги")}
            </Tab>
            <Tab
              type="button"
              $active={tab === "photo"}
              onClick={() => setTab("photo")}
            >
              {t("products.tabPhoto", "Фото")}
            </Tab>
          </TabRow>

          {tab === "general" && (
            <TabPanel>
              <Row>
                <FormGroup>
                  <Label>
                    {t("products.barcode")} <Req>*</Req>
                  </Label>
                  <div
                    style={{ display: "flex", flexDirection: "row", gap: "8px" }}
                  >
                    <Input
                      value={formData.barcode}
                      autoFocus
                      onChange={(e) => handleBarcodeChange(e.target.value)}
                      disabled={isEdit}
                      required
                      style={{ flex: 1 }}
                    />
                    {!isEdit && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="small"
                        onClick={handleGenerateBarcode}
                        title={t("products.generateBarcode")}
                        style={{ flexShrink: 0 }}
                      >
                        <RefreshCw size={16} />
                      </Button>
                    )}
                  </div>
                </FormGroup>
                <FormGroup>
                  <Label>
                    {t("products.category")} <Req>*</Req>
                  </Label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <Select
                      value={formData.categoryId}
                      onChange={(e) => handleChange("categoryId", e.target.value)}
                      required
                      style={{ flex: 1 }}
                    >
                      <option value="">{t("products.selectCategory")}</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {i18n.language === "uz" ? cat.nameUz : cat.nameRu}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="secondary"
                      size="small"
                      onClick={() => setShowCategoryModal(true)}
                      style={{ flexShrink: 0 }}
                    >
                      <Settings size={16} />
                    </Button>
                  </div>
                </FormGroup>
              </Row>

              <Row>
                <Input
                  label={
                    <>
                      {t("products.nameUz")} <Req>*</Req>
                    </>
                  }
                  value={formData.nameUz}
                  onChange={(e) => handleNameUzChange(e.target.value)}
                  required
                />
                <Input
                  label={
                    <>
                      {t("products.nameRu")} <Req>*</Req>
                    </>
                  }
                  value={formData.nameRu}
                  onChange={(e) => handleNameRuChange(e.target.value)}
                  required
                />
              </Row>

              <Row>
                <Input
                  label={
                    <>
                      {t("products.price")}
                      {formProfitMargin !== null
                        ? ` (${formProfitMargin}%)`
                        : ""}{" "}
                      <Req>*</Req>
                    </>
                  }
                  type="number"
                  value={formData.price}
                  onChange={(e) => handleChange("price", e.target.value)}
                  required
                />
                <div />
              </Row>

              <FoldToggle type="button" onClick={() => setShowMore((v) => !v)}>
                {showMore ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
                {t("products.moreFields", "Дополнительные поля")}
              </FoldToggle>

              {showMore && (
                <FoldBody>
                  <Row>
                    <Input
                      label={t("products.cost")}
                      type="number"
                      value={formData.cost}
                      onChange={(e) => handleChange("cost", e.target.value)}
                    />
                    <Input
                      label={t("products.stock")}
                      type="number"
                      value={formData.stock}
                      onChange={(e) => handleChange("stock", e.target.value)}
                    />
                  </Row>

                  <Row>
                    <Input
                      label={t("products.minStock")}
                      type="number"
                      value={formData.minStock}
                      onChange={(e) => handleChange("minStock", e.target.value)}
                    />
                    <FormGroup>
                      <Label>{t("products.unit")}</Label>
                      <Select
                        value={formData.unit}
                        onChange={(e) => handleChange("unit", e.target.value)}
                      >
                        {UNIT_OPTIONS.map((unit) => (
                          <option key={unit} value={unit}>
                            {getUnitLabel(unit)}
                          </option>
                        ))}
                      </Select>
                    </FormGroup>
                  </Row>

                  <Row>
                    <FormGroup>
                      <Label>{t("products.productType")}</Label>
                      <Select
                        value={formData.productType}
                        onChange={(e) =>
                          handleChange("productType", e.target.value as ProductType)
                        }
                      >
                        <option value="REGULAR">
                          {t("products.productTypeRegular")}
                        </option>
                        <option value="BULK_WEIGHTED">
                          {t("products.productTypeBulkWeighted")}
                        </option>
                        <option value="PREPACKAGED">
                          {t("products.productTypePrepackaged")}
                        </option>
                      </Select>
                    </FormGroup>
                    <FormGroup>
                      <Label>{t("filters.supplier")}</Label>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <Select
                          value={formData.supplierId}
                          onChange={(e) =>
                            handleChange("supplierId", e.target.value)
                          }
                          style={{ flex: 1 }}
                        >
                          <option value="">{t("products.noSupplier")}</option>
                          {suppliers.map((sup) => (
                            <option key={sup.id} value={sup.id}>
                              {i18n.language === "uz" ? sup.nameUz : sup.nameRu}
                            </option>
                          ))}
                        </Select>
                        <Button
                          type="button"
                          variant="secondary"
                          size="small"
                          onClick={() => setShowSupplierModal(true)}
                          style={{ flexShrink: 0 }}
                        >
                          <Settings size={16} />
                        </Button>
                      </div>
                    </FormGroup>
                  </Row>

                  {formData.productType !== "REGULAR" && (
                    <Row>
                      <Input
                        label={t("products.internalCode")}
                        value={formData.internalCode}
                        readOnly
                        style={{
                          background: "var(--color-surface, #f5f5f5)",
                          cursor: "default",
                        }}
                        onChange={() => {}}
                      />
                      <div />
                    </Row>
                  )}

                  <Row>
                    <DateInput
                      label={t("products.productionDate")}
                      value={formData.productionDate}
                      onChange={(val) => handleChange("productionDate", val)}
                    />
                    <DateInput
                      label={t("products.expiryDate")}
                      value={formData.expiryDate}
                      onChange={(val) => handleChange("expiryDate", val)}
                    />
                  </Row>

                  <Row>
                    <Input
                      label={t("filters.discount")}
                      type="number"
                      min="0"
                      max="100"
                      value={formData.discountPercent}
                      onChange={(e) =>
                        handleChange("discountPercent", e.target.value)
                      }
                    />
                    <FormGroup>
                      <Label>{t("filters.isOnPromotion")}</Label>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginTop: "4px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={formData.isOnPromotion}
                          onChange={(e) =>
                            handleChange("isOnPromotion", e.target.checked)
                          }
                        />
                        {t("filters.onPromotion")}
                      </label>
                    </FormGroup>
                  </Row>
                </FoldBody>
              )}
            </TabPanel>
          )}

          {tab === "tax" && (
            <TabPanel>
              <Row>
                <FormGroup>
                  <Label>
                    {t("products.mxik")} <Req>*</Req>
                  </Label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <Input
                      value={formData.mxik}
                      placeholder="00000000000000000"
                      onChange={(e) => handleChange("mxik", e.target.value)}
                      required
                      style={{ flex: 1 }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="small"
                      onClick={() => setShowMxikPicker(true)}
                      title={t("products.searchMxik")}
                      style={{ flexShrink: 0 }}
                    >
                      <Search size={16} />
                    </Button>
                  </div>
                </FormGroup>
                <FormGroup>
                  <Label>{t("products.vatRate", "Ставка НДС, %")}</Label>
                  <Select
                    value={formData.vatRate}
                    onChange={(e) => handleChange("vatRate", e.target.value)}
                    title={t(
                      "products.vatRateHint",
                      "Пусто — использовать ставку по умолчанию",
                    )}
                  >
                    <option value="">
                      {t("products.vatRateHint", "По умолчанию")}
                    </option>
                    <option value="0">0.00%</option>
                    <option value="6">6.00%</option>
                    <option value="12">12.00%</option>
                  </Select>
                </FormGroup>
              </Row>

              {mxikPackages.length > 0 && (
                <Row>
                  <FormGroup>
                    <Label>
                      {t("products.packageCode", "Код упаковки (МХИК)")}
                    </Label>
                    <Select
                      value={formData.packageCode}
                      onChange={(e) => handleChange("packageCode", e.target.value)}
                    >
                      {mxikPackages.map((pkg) => (
                        <option key={pkg.code} value={pkg.code}>
                          {pkg.name}
                        </option>
                      ))}
                    </Select>
                  </FormGroup>
                  <div />
                </Row>
              )}
            </TabPanel>
          )}

          {tab === "photo" && (
            <TabPanel>
              <PhotoPlaceholder>
                <ImageIcon size={56} strokeWidth={1.25} />
                <PhotoTitle>{t("products.photoComingSoon", "Скоро")}</PhotoTitle>
                <PhotoHint>
                  {t(
                    "products.photoComingSoonHint",
                    "Загрузка фотографий товара появится в одном из следующих обновлений.",
                  )}
                </PhotoHint>
              </PhotoPlaceholder>
            </TabPanel>
          )}

          <Actions>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t("common.saving") : t("common.save")}
            </Button>
          </Actions>
        </Form>
      </Modal>

      {showArrivalModal && existingProduct && (
        <Modal
          title={t("inventory.productExists") || "Product Exists"}
          onClose={handleCloseArrivalModal}
        >
          <ProductInfo>
            <ProductInfoRow>
              <ProductInfoLabel>{t("products.name")}</ProductInfoLabel>
              <ProductInfoValue>
                {i18n.language === "uz"
                  ? existingProduct.nameUz
                  : existingProduct.nameRu}
              </ProductInfoValue>
            </ProductInfoRow>
            <ProductInfoRow>
              <ProductInfoLabel>{t("products.barcode")}</ProductInfoLabel>
              <ProductInfoValue>{existingProduct.barcode}</ProductInfoValue>
            </ProductInfoRow>
            <ProductInfoRow>
              <ProductInfoLabel>{t("products.currentStock")}</ProductInfoLabel>
              <ProductInfoValue>
                {existingProduct.stock} {existingProduct.unit}
              </ProductInfoValue>
            </ProductInfoRow>
            <ProductInfoRow>
              <ProductInfoLabel>{t("products.price")}</ProductInfoLabel>
              <ProductInfoValue>
                {formatCurrency(existingProduct.price)}
              </ProductInfoValue>
            </ProductInfoRow>
            <ProductInfoRow>
              <ProductInfoLabel>{t("products.cost")}</ProductInfoLabel>
              <ProductInfoValue>
                {existingProduct.cost
                  ? formatCurrency(existingProduct.cost)
                  : "—"}
              </ProductInfoValue>
            </ProductInfoRow>
            <ProductInfoRow>
              <ProductInfoLabel>{t("products.profitMargin")}</ProductInfoLabel>
              <ProductInfoValue>
                {existingProduct.cost ? (
                  <ProfitBadge
                    $negative={
                      ((existingProduct.price - existingProduct.cost) /
                        existingProduct.cost) *
                        100 <
                      0
                    }
                  >
                    {(
                      ((existingProduct.price - existingProduct.cost) /
                        existingProduct.cost) *
                      100
                    ).toFixed(1)}
                    %
                  </ProfitBadge>
                ) : (
                  "—"
                )}
              </ProductInfoValue>
            </ProductInfoRow>
          </ProductInfo>

          {existingProduct.pendingPrice != null && (
            <ProductInfo>
              <ProductInfoRow>
                <ProductInfoLabel>
                  {t("inventory.pendingPriceLabel")}
                </ProductInfoLabel>
                <ProductInfoValue>
                  {formatCurrency(existingProduct.pendingPrice)}{" "}
                  <span style={{ fontSize: 12, fontWeight: 400 }}>
                    (
                    {t("inventory.afterStockDrops", {
                      threshold: `${existingProduct.pendingPriceThreshold} ${existingProduct.unit}`,
                    })}
                    )
                  </span>
                </ProductInfoValue>
              </ProductInfoRow>
            </ProductInfo>
          )}

          <ArrivalForm>
            <Input
              label={
                <>
                  {t("inventory.quantity")} <Req>*</Req>
                </>
              }
              type="number"
              autoFocus
              min="0"
              step="0.01"
              value={arrivalData.quantity}
              onChange={(e) =>
                setArrivalData((prev) => ({
                  ...prev,
                  quantity: e.target.value,
                }))
              }
              required
            />

            <div style={{ display: "flex", gap: "16px" }}>
              <div style={{ flex: 1 }}>
                <Input
                  label={
                    <>
                      {t("inventory.costPerUnit")} <Req>*</Req>
                    </>
                  }
                  type="number"
                  min="0"
                  step="0.01"
                  value={arrivalData.cost}
                  onChange={(e) =>
                    setArrivalData((prev) => ({
                      ...prev,
                      cost: e.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div style={{ flex: 1 }}>
                <Input
                  label={`${t("products.price")}${arrivalProfitMargin !== null ? ` (${arrivalProfitMargin}%)` : ""}`}
                  type="number"
                  value={arrivalData.newPrice}
                  onChange={(e) =>
                    setArrivalData((prev) => ({
                      ...prev,
                      newPrice: e.target.value,
                    }))
                  }
                  disabled={arrivalData.priceMode === "none"}
                />
              </div>
            </div>

            {costChanged && (
              <PriceChangeSection>
                <PriceChangeTitle>
                  {t("inventory.priceChanged")}
                </PriceChangeTitle>

                <RadioOption $active={arrivalData.priceMode === "none"}>
                  <input
                    type="radio"
                    name="priceMode"
                    checked={arrivalData.priceMode === "none"}
                    onChange={() =>
                      setArrivalData((prev) => ({
                        ...prev,
                        priceMode: "none",
                        newPrice: String(existingProduct!.price),
                      }))
                    }
                  />
                  <RadioText>
                    <RadioLabel>{t("inventory.keepCurrentPrice")}</RadioLabel>
                    <RadioDescription>
                      {formatCurrency(existingProduct!.price)}
                    </RadioDescription>
                  </RadioText>
                </RadioOption>

                <RadioOption $active={arrivalData.priceMode === "immediate"}>
                  <input
                    type="radio"
                    name="priceMode"
                    checked={arrivalData.priceMode === "immediate"}
                    onChange={() =>
                      setArrivalData((prev) => ({
                        ...prev,
                        priceMode: "immediate",
                      }))
                    }
                  />
                  <RadioText>
                    <RadioLabel>
                      {t("inventory.changePriceImmediately")}
                    </RadioLabel>
                    <RadioDescription>
                      {t("inventory.changePriceImmediatelyDesc")}
                    </RadioDescription>
                  </RadioText>
                </RadioOption>

                <RadioOption $active={arrivalData.priceMode === "deferred"}>
                  <input
                    type="radio"
                    name="priceMode"
                    checked={arrivalData.priceMode === "deferred"}
                    onChange={() =>
                      setArrivalData((prev) => ({
                        ...prev,
                        priceMode: "deferred",
                      }))
                    }
                  />
                  <RadioText>
                    <RadioLabel>
                      {t("inventory.changePriceAfterOldStock")}
                    </RadioLabel>
                    <RadioDescription>
                      {t("inventory.changePriceAfterOldStockDesc", {
                        stock: `${existingProduct!.stock} ${existingProduct!.unit}`,
                      })}
                    </RadioDescription>
                  </RadioText>
                </RadioOption>
              </PriceChangeSection>
            )}

            <FormGroup>
              <Label>{t("products.supplier")}</Label>
              <div style={{ display: "flex", gap: "8px" }}>
                <Select
                  value={arrivalData.supplierId}
                  onChange={(e) =>
                    setArrivalData((prev) => ({
                      ...prev,
                      supplierId: e.target.value,
                    }))
                  }
                  style={{ flex: 1 }}
                >
                  <option value="">{t("products.noSupplier")}</option>
                  {suppliers.map((supplier: Supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {i18n.language === "uz"
                        ? supplier.nameUz
                        : supplier.nameRu}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={() => setShowSupplierModal(true)}
                  style={{ flexShrink: 0 }}
                >
                  <Settings size={16} />
                </Button>
              </div>
            </FormGroup>

            {arrivalData.supplierId && (
              <FormGroup>
                <Label>{t("suppliers.paymentMethod")}</Label>
                <Select
                  value={arrivalData.paymentMethod}
                  onChange={(e) =>
                    setArrivalData((prev) => ({
                      ...prev,
                      paymentMethod: e.target.value as SupplierPaymentMethod,
                    }))
                  }
                >
                  {SUPPLIER_PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {t(SUPPLIER_PAYMENT_METHOD_I18N_KEYS[method])}
                    </option>
                  ))}
                </Select>
              </FormGroup>
            )}

            <div style={{ display: "flex", gap: "16px" }}>
              <div style={{ flex: 1 }}>
                <DateInput
                  label={t("products.productionDate")}
                  value={arrivalData.productionDate}
                  onChange={(val) =>
                    setArrivalData((prev) => ({
                      ...prev,
                      productionDate: val,
                    }))
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <DateInput
                  label={t("products.expiryDate")}
                  value={arrivalData.expirationDate}
                  onChange={(val) =>
                    setArrivalData((prev) => ({
                      ...prev,
                      expirationDate: val,
                    }))
                  }
                />
              </div>
            </div>

            <Input
              label={t("inventory.notes")}
              value={arrivalData.notes}
              onChange={(e) =>
                setArrivalData((prev) => ({ ...prev, notes: e.target.value }))
              }
            />

            <ModalActions>
              <Button
                type="button"
                variant="secondary"
                onClick={handleCloseArrivalModal}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleArrivalSubmit}
                disabled={
                  isSubmittingArrival ||
                  !arrivalData.quantity ||
                  !arrivalData.cost
                }
              >
                {isSubmittingArrival
                  ? t("common.saving")
                  : t("inventory.addArrival")}
              </Button>
            </ModalActions>
          </ArrivalForm>
        </Modal>
      )}

      {showSupplierModal && (
        <SupplierManagementModal
          onClose={() => setShowSupplierModal(false)}
          onSupplierChanged={loadSuppliers}
        />
      )}

      {showCategoryModal && (
        <CategoryManagementModal
          onClose={() => setShowCategoryModal(false)}
          onCategoryChanged={loadCategories}
        />
      )}

      {showMxikPicker && (
        <Modal
          title={t("products.searchMxik")}
          onClose={() => {
            setShowMxikPicker(false);
            setMxikPickerQuery("");
            setMxikPickerResults([]);
            setMxikPickerTotal(0);
            setMxikPickerPage(0);
          }}
          width="560px"
        >
          <Input
            autoFocus
            value={mxikPickerQuery}
            placeholder={t("products.mxikPickerPlaceholder")}
            onChange={(e) => setMxikPickerQuery(e.target.value)}
          />
          {mxikPickerLoading && <Spinner centered size={24} />}
          {!mxikPickerLoading &&
            mxikPickerQuery.trim().length >= 2 &&
            mxikPickerResults.length === 0 && (
              <div style={{ padding: "12px", textAlign: "center", opacity: 0.6, fontSize: 13 }}>
                {t("products.noMxikResults")}
              </div>
            )}
          {mxikPickerResults.length > 0 && (
            <>
              <PickerList>
                {mxikPickerResults.map((entry, i) => (
                  <PickerItem
                    key={`${entry.mxikCode}-${i}`}
                    onClick={() => handlePickerSelect(entry)}
                  >
                    <PickerItemName>{entry.mxikName}</PickerItemName>
                    <PickerItemMeta>
                      {entry.className} · {entry.mxikCode}
                      {entry.internationalCode ? ` · ${entry.internationalCode}` : ""}
                    </PickerItemMeta>
                  </PickerItem>
                ))}
              </PickerList>
              {mxikPickerResults.length < mxikPickerTotal && (
                <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    onClick={handleMxikLoadMore}
                    disabled={mxikLoadingMore}
                  >
                    {mxikLoadingMore
                      ? <Spinner size={14} />
                      : `${t("common.load")} ${Math.min(10, mxikPickerTotal - mxikPickerResults.length)}`}
                  </Button>
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
