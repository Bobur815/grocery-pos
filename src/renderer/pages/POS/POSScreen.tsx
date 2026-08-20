import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Cart } from "./Cart";
import { Catalog } from "./Catalog";
import { BulkWeighModal } from "../../components/BulkWeighModal";
import { Checkout } from "./Checkout";
import { PosTabBar } from "./PosTabBar";
import { useCartStore } from "../../store/cart-store";
import { APP_BAR_HEIGHT } from "../../components/layout/AppBar";
import { useProducts } from "../../hooks/useProducts";
import { useSales } from "../../hooks/useSales";
import { useToast } from "../../context/ToastContext";
import {
  Banknote,
  Barcode,
  CreditCard,
  Delete,
  LayoutGrid,
  QrCode,
  SendHorizontal,
  Trash,
} from "lucide-react";
import { Button } from "../../components/common/Button";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { Product } from "@shared/types";
import { parseBarcode } from "../../../shared/utils/barcode-parser";
import { parseWeightBarcode } from "../../../shared/utils/weightBarcode";
import { physicalKeyToChar } from "../../../shared/utils/keyboard-layout";
import { productRequiresMarking } from "../../../shared/utils/marking";
import { Modal } from "@renderer/components/common/Modal";
import { useSidebar } from "@renderer/context/SidebarContext";

function parseSaleError(
  err: unknown,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const message = err instanceof Error ? err.message : String(err);
  // Electron wraps IPC errors: "Error invoking remote method '...': Error: {json}"
  const jsonStart = message.indexOf("{");
  const jsonStr = jsonStart !== -1 ? message.slice(jsonStart) : "";
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.code === "PRODUCT_NOT_FOUND") {
      return t("errors.productNotFound", { id: parsed.productId });
    }
    if (parsed.code === "PRODUCT_INACTIVE") {
      return t("errors.productInactive", { name: parsed.name });
    }
    if (parsed.code === "INSUFFICIENT_STOCK") {
      return t("errors.insufficientStock", {
        name: parsed.name,
        available: parsed.available,
        requested: parsed.requested,
      });
    }
    if (parsed.code === "NO_SMENA_OPEN") {
      return t("smena.noOpenSmena");
    }
  } catch {
    // not JSON, fall through
  }
  return message || t("common.error");
}

const PageWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  height: calc(100vh - ${APP_BAR_HEIGHT}px - 20px);
`;

const Container = styled.div`
  display: grid;
  /* Product browsing moved to the Catalog modal — the input/numpad column keeps a compact
     share and the freed space goes to the Cart. */
  grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
  grid-template-rows: 1fr;
  gap: ${({ theme }) => theme.spacing.xs};
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const InputSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const InputPanel = styled.div`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.md};
  padding: ${({ theme }) => theme.spacing.sm};
`;

const InputLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  text-transform: uppercase;
`;

const InputDisplay = styled.div<{ $active?: boolean }>`
  font-size: 18px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.text};
  padding: ${({ theme }) => theme.spacing.sm};
  background-color: ${({ theme }) => theme.colors.background};
  border: 2px solid
    ${({ theme, $active }) =>
      $active ? theme.colors.primary : theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  min-height: 40px;
  display: flex;
  align-items: center;
  cursor: pointer;
  transition: border-color 0.2s;
`;

const NumberPadSection = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.md};
  padding: ${({ theme }) => theme.spacing.sm};
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const NumberPad = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(4, 1fr);
  gap: ${({ theme }) => theme.spacing.xs};
  flex: 1;
`;

const NumButton = styled.button<{ $variant?: "action" | "clear" | "enter" }>`
  min-height: 0;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 18px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: ${({ theme }) => theme.colors.primary}15;
    border-color: ${({ theme }) => theme.colors.primary};
  }

  &:active {
    transform: scale(0.95);
    background-color: ${({ theme }) => theme.colors.primary}30;
  }

  ${({ $variant, theme }) =>
    $variant === "action" &&
    `
    background-color: ${theme.colors.primary}10;
    border-color: ${theme.colors.primary}50;
    color: ${theme.colors.primary};
    font-size: 14px;
    &:hover {
      background-color: ${theme.colors.primary}20;
    }
  `}

  ${({ $variant, theme }) =>
    $variant === "clear" &&
    `
    background-color: ${theme.colors.error}10;
    border-color: ${theme.colors.error}50;
    color: ${theme.colors.error};
    font-size: 14px;
    &:hover {
      background-color: ${theme.colors.error}20;
    }
  `}

  ${({ $variant, theme }) =>
    $variant === "enter" &&
    `
    background-color: ${theme.colors.success};
    border-color: ${theme.colors.success};
    color: white;
    font-size: 16px;
    &:hover {
      opacity: 0.9;
    }
  `}
`;

const CatalogButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  background-color: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.md};
  color: ${({ theme }) => theme.colors.primary};
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background-color: ${({ theme }) => theme.colors.primary}10;
    border-color: ${({ theme }) => theme.colors.primary};
  }

  &:active {
    transform: scale(0.98);
  }
`;

const CartSection = styled.div`
  display: flex;
  flex-direction: column;
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.md};
  overflow: hidden;
  min-height: 0;
`;

const ErrorMessage = styled.div`
  background-color: ${({ theme }) => theme.colors.error}15;
  color: ${({ theme }) => theme.colors.error};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius};
  font-size: 14px;
  text-align: center;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const InputColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  min-height: 0;
  height: 100%;
`;

const InputRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  flex: 1;
`;

const QuickPayRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const QuickPayButton = styled.button<{ $variant: "cash" | "card" }>`
  height: 44px;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid
    ${({ theme, $variant }) =>
      $variant === "cash" ? theme.colors.success : theme.colors.primary};
  background-color: ${({ theme, $variant }) =>
    $variant === "cash" ? theme.colors.success : theme.colors.primary};
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};

  &:hover {
    opacity: 0.9;
  }

  &:active {
    transform: scale(0.97);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }
`;

const ShortcutHint = styled.span`
  font-size: 14px;
  opacity: 0.7;
  font-weight: 500;
`;

const SmenaBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.lg};
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
`;

const SmenaBlockText = styled.p`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0;
`;

type InputMode = "barcode" | "quantity" | "id";

export function POSScreen() {
  const { t, i18n } = useTranslation();
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [id, setId] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("barcode");
  const [showCheckout, setShowCheckout] = useState(false);
  const [error, setError] = useState("");
  const { openSmenaModal } = useSidebar();

  const [showSmenaModal, setShowSmenaModal] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const closeCatalog = useCallback(() => setShowCatalog(false), []);

  // ── Scan input buffering ────────────────────────────────────────────────────
  // A barcode/QR scanner is an HID keyboard: a long DataMatrix marking code (~30–90
  // chars) arrives as a rapid keystroke burst. Accumulating each char into React state
  // re-rendered this whole screen per character. Instead, `barcodeRef` is the source of
  // truth (always current, no stale closure), and visible `barcode` state is synced once
  // per animation frame during a burst — collapsing dozens of re-renders into a few.
  const barcodeRef = useRef("");
  const flushRafRef = useRef<number | null>(null);

  const flushBarcode = useCallback(() => {
    flushRafRef.current = null;
    setBarcode(barcodeRef.current);
  }, []);

  // Update the barcode buffer. Coalesced by default (scanner bursts); pass immediate=true
  // for human-speed edits (backspace, on-screen keypad, resets) so they show instantly.
  const writeBarcode = useCallback(
    (value: string, immediate = false) => {
      barcodeRef.current = value;
      if (immediate) {
        if (flushRafRef.current != null) {
          cancelAnimationFrame(flushRafRef.current);
          flushRafRef.current = null;
        }
        setBarcode(value);
      } else if (flushRafRef.current == null) {
        flushRafRef.current = requestAnimationFrame(flushBarcode);
      }
    },
    [flushBarcode],
  );

  useEffect(() => {
    return () => {
      if (flushRafRef.current != null) cancelAnimationFrame(flushRafRef.current);
    };
  }, []);

  const checkSmena = useCallback(async (): Promise<boolean> => {
    try {
      const s = await window.electronAPI.smena.getCurrent();
      return s != null;
    } catch {
      return false;
    }
  }, []);

  const {
    addItem,
    removeByMarkingCode,
    items,
    discount,
    total,
    clearCart,
    activeTabId,
    editingSaleId,
  } = useCartStore();
  // addItem is also used directly for pre-weighed items in handleBarcodeSubmit
  const formatCurrency = useCallback(
    (amount: number) =>
      formatCurrencyBase(amount, i18n.language as "ru" | "uz"),
    [i18n.language],
  );

  const { searchByBarcode, getById } = useProducts();
  const { createSale, updateSale, isLoading: isPayingLoading } = useSales();
  const toast = useToast();
  const payingRef = useRef(false);

  // Bulk-weighed products take their quantity from the connected Rongta scale via
  // BulkWeighModal instead of the Quantity field. Opt-in per terminal in Scale settings
  // (a store without a scale must not get a blocking modal at checkout). Held in a ref so
  // the lookup handlers can read it without joining their dependency arrays.
  const bulkWeighEnabledRef = useRef(false);
  useEffect(() => {
    window.electronAPI.settings
      .getAll()
      .then((cfg) => {
        bulkWeighEnabledRef.current = cfg.bulk_weigh_enabled === "true";
      })
      .catch(() => {});
  }, []);

  const [bulkWeighProduct, setBulkWeighProduct] = useState<Product | null>(null);

  /** True when this product should be weighed on the scale rather than typed. */
  const needsScaleWeighing = useCallback(
    (product: Product) =>
      bulkWeighEnabledRef.current && product.productType === "BULK_WEIGHTED",
    [],
  );

  const addProductToCart = useCallback(
    (product: Product, qty: number) => {
      if (!product.isActive) {
        const productName =
          i18n.language === "uz" ? product.nameUz : product.nameRu;
        setError(t("errors.productInactive", { name: productName }));
        return;
      }

      const productName =
        i18n.language === "uz" ? product.nameUz : product.nameRu;

      const hasPending =
        product.pendingPrice != null &&
        product.pendingPriceThreshold != null &&
        product.pendingPrice !== product.price;

      if (hasPending) {
        const oldPrice = Number(product.price);
        const newPrice = Number(product.pendingPrice!);
        const threshold = product.pendingPriceThreshold!;
        // Old stock = total stock - threshold (portion at old price)
        const totalOldStock = product.stock - threshold;

        // Check how much of old-price stock is already in cart
        const alreadyInCartOld = items
          .filter((i) => i.productId === product.id && i.unitPrice === oldPrice)
          .reduce((sum, i) => sum + i.quantity, 0);

        const remainingOldStock = Math.max(0, totalOldStock - alreadyInCartOld);

        if (remainingOldStock <= 0) {
          // All old stock used up, add at new price
          addItem({
            productId: product.id,
            productName,
            barcode: product.barcode,
            unitPrice: newPrice,
            quantity: qty,
            stock: threshold,
            unit: product.unit,
          });
        } else if (qty <= remainingOldStock) {
          // Fits entirely in old stock
          addItem({
            productId: product.id,
            productName,
            barcode: product.barcode,
            unitPrice: oldPrice,
            quantity: qty,
            stock: totalOldStock,
            unit: product.unit,
          });
        } else {
          // Split: fill old stock, rest at new price
          addItem({
            productId: product.id,
            productName,
            barcode: product.barcode,
            unitPrice: oldPrice,
            quantity: remainingOldStock,
            stock: totalOldStock,
            unit: product.unit,
          });
          addItem({
            productId: product.id,
            productName,
            barcode: product.barcode,
            unitPrice: newPrice,
            quantity: qty - remainingOldStock,
            stock: threshold,
            unit: product.unit,
          });
        }
        return;
      }

      // Normal add (no pending price)
      addItem({
        productId: product.id,
        productName,
        barcode: product.barcode,
        unitPrice: Number(product.price),
        quantity: qty,
        stock: product.stock,
        unit: product.unit,
      });
    },
    [addItem, items, i18n.language],
  );

  // Reset local input state when switching tabs
  useEffect(() => {
    writeBarcode("", true);
    setQuantity("1");
    setId("");
    setInputMode("barcode");
    setError("");
  }, [activeTabId, writeBarcode]);

  const handleIdSubmit = useCallback(async () => {
    if (!id.trim()) return;

    try {
      const product = (await getById(id.trim())) as Product | null;
      if (product) {
        // Marked goods are QR-only — decided from the product's authoritative isMarked flag
        // (tasnif `label`), falling back to the MXIK group heuristic while isMarked is null.
        if (productRequiresMarking(product)) {
          setId("");
          setError(t("pos.qrOnlyProduct"));
          return;
        }

        // Weighed on the scale, not typed. Checked BEFORE the stock guard: the Quantity
        // field is irrelevant here, and its default of 1 would spuriously fail the guard
        // for a product with under 1 unit left.
        if (needsScaleWeighing(product)) {
          setId("");
          writeBarcode("", true);
          setQuantity("1");
          setInputMode("barcode");
          setError("");
          setBulkWeighProduct(product);
          return;
        }

        const qty = parseFloat(quantity) || 1;
        if (qty > product.stock) {
          setError(
            t("errors.insufficientStock", {
              name: i18n.language === "uz" ? product.nameUz : product.nameRu,
              available: product.stock,
              requested: qty,
            }),
          );
          setId("");
          return;
        }

        setId("");
        writeBarcode("", true);
        setQuantity("1");
        setInputMode("barcode");
        setError("");
        addProductToCart(product, qty);
      } else {
        writeBarcode("", true);
        setId("");
        setQuantity("1");
        setError(t("products.noResults"));
      }
    } catch (err) {
      console.error("Error looking up product by ID:", err);
      writeBarcode("", true);
      setId("");
      setQuantity("1");
      setError(t("products.noResults"));
    }
  }, [
    id,
    quantity,
    getById,
    addProductToCart,
    needsScaleWeighing,
    t,
    i18n.language,
    writeBarcode,
  ]);

  const handleBarcodeSubmit = useCallback(async () => {
    if (inputMode === "id") {
      return handleIdSubmit();
    }

    // Read from the buffer (source of truth) — the visible `barcode` state may still be a
    // frame behind at the end of a scan burst. Cancel any pending coalesced flush.
    if (flushRafRef.current != null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }
    const rawValue = barcodeRef.current.trim();

    if (!rawValue) {
      setError(t("pos.enterBarcode"));
      return;
    }

    // QR/DataMatrix marking codes are always printable ASCII. A plain EAN barcode is purely
    // numeric (8/12/13 digits); anything else is treated as a QR payload. If such a payload
    // carries Cyrillic or any other non-ASCII characters, the scanner read it under the wrong
    // keyboard layout (e.g. RU) and the data is corrupt — reject it locally instead of doing a
    // doomed lookup. GS1 group-separator bytes (\x1d) are expected control chars, so ignore them.
    const isPlainBarcodeRaw = /^\d{8}$|^\d{12}$|^\d{13}$/.test(rawValue);
    if (!isPlainBarcodeRaw && /[^\x20-\x7E]/.test(rawValue.replace(/\x1d/g, ""))) {
      setError(t("pos.qrInvalidCharacters"));
      writeBarcode("", true);
      return;
    }
    // Normalize DataMatrix: strip ZXing symbology prefix and leading FNC1 byte
    const normalizedRaw = rawValue
      .replace(/^]d2|^]C1|^]e0/, "")
      .replace(/^\x1d/, "");
    // Detect GS1 DataMatrix with serial number (AI 01 = GTIN, AI 21 = serial).
    // Strip all internal GS1 group-separator bytes before matching — asl-belgisi codes
    // often embed \x1d between AIs (e.g. 01{GTIN}\x1d21{serial}).
    const normalizedNoGS = normalizedRaw.replace(/\x1d/g, "");
    const hasSerial =
      /^01\d{14}21/.test(normalizedNoGS) ||
      /^\(01\)\d{14}\(21\)/.test(normalizedNoGS);
    // Extract EAN-13 from GS1 DataMatrix QR payload (e.g. 01GTIN-14 21serial 93check)
    const gs1 =
      rawValue.match(/\(01\)(\d{14})/) ?? rawValue.match(/^01(\d{14})/);
    const barcodeValue = gs1
      ? gs1[1].startsWith("0")
        ? gs1[1].slice(1)
        : gs1[1]
      : rawValue;

    const resetInputs = () => {
      writeBarcode("", true);
      setQuantity("1");
      setInputMode("barcode");
      setError("");
    };

    try {
      const parsed = parseBarcode(barcodeValue);

      if (parsed.isWeighted && parsed.productCode && parsed.weightKg !== null) {
        // --- Weighted barcode flow ---
        // Check if a pre-weighed item exists with this barcode
        const weighedItem =
          (await window.electronAPI.weighedItems.findByBarcode(
            barcodeValue,
          )) as {
            id: string;
            productId: number;
            weight: number;
            pricePerKg: number;
            totalPrice: number;
            barcode: string;
            product?: { nameRu: string; nameUz: string; barcode: string };
          } | null;

        if (weighedItem) {
          // Found a pre-weighed item — add to cart
          const productNameForCart =
            i18n.language === "uz"
              ? weighedItem.product?.nameUz || weighedItem.product?.nameRu || ""
              : weighedItem.product?.nameRu || "";

          addItem({
            productId: weighedItem.productId,
            productName: productNameForCart,
            barcode: weighedItem.barcode,
            unitPrice: weighedItem.pricePerKg,
            quantity: weighedItem.weight,
            stock: 99999, // pre-weighed items don't have stock limit
            unit: "кг",
            preWeighedItemId: weighedItem.id,
          });

          resetInputs();
          toast.success(
            `${productNameForCart} — ${weighedItem.weight.toFixed(3)} кг — ${Math.round(weighedItem.totalPrice).toLocaleString("ru-RU")} сум`,
          );
        } else {
          // No pre-weighed item — parse as Rongta RLS label scan
          // D2–D7 = SQLite product ID, D8–D11 = weight (kg × 1000)
          const rongtaParsed = parseWeightBarcode(barcodeValue);
          if (!rongtaParsed) {
            writeBarcode("", true);
            setId("");
            setQuantity("1");
            setError(t("products.noResults"));
            return;
          }

          if (rongtaParsed.weight <= 0) {
            writeBarcode("", true);
            setId("");
            setQuantity("1");
            setError(t("pos.zeroWeight"));
            return;
          }

          const product = (await window.electronAPI.products.getById(
            String(rongtaParsed.productIdNum),
          )) as Product | null;

          if (product) {
            if (!product.isActive) {
              writeBarcode("", true);
              setId("");
              setQuantity("1");
              setError(
                t("errors.productInactive", {
                  name:
                    i18n.language === "uz" ? product.nameUz : product.nameRu,
                }),
              );
              return;
            }
            if (rongtaParsed.weight > product.stock) {
              writeBarcode("", true);
              setId("");
              setQuantity("1");
              setError(
                t("errors.insufficientStock", {
                  name:
                    i18n.language === "uz" ? product.nameUz : product.nameRu,
                  available: product.stock,
                  requested: rongtaParsed.weight,
                }),
              );
              return;
            }
            const productNameForCart =
              i18n.language === "uz" ? product.nameUz : product.nameRu;
            addItem({
              productId: product.id,
              productName: productNameForCart,
              barcode: product.barcode,
              unitPrice: Number(product.price),
              quantity: rongtaParsed.weight,
              stock: product.stock,
              unit: "кг",
            });
            resetInputs();
            toast.success(
              `${productNameForCart} — ${rongtaParsed.weightDisplay} — ${Math.round(Number(product.price) * rongtaParsed.weight).toLocaleString("ru-RU")} сум`,
            );
          } else {
            writeBarcode("", true);
            setId("");
            setQuantity("1");
            setError(t("pos.pluNotFound", { plu: rongtaParsed.productId }));
          }
        }
        return;
      }

      // --- Regular barcode flow ---
      const product = (await searchByBarcode(barcodeValue)) as Product | null;
      if (product) {
        {
          const qty = parseFloat(quantity) || 1;
          // Scale-weighed products are exempt: their quantity comes from the scale, so the
          // Quantity field's default of 1 would spuriously fail this for a product with
          // under 1 unit left. The marking checks below still apply, and the weight is
          // validated in BulkWeighModal.
          if (qty > product.stock && !needsScaleWeighing(product)) {
            setError(
              t("errors.insufficientStock", {
                name: i18n.language === "uz" ? product.nameUz : product.nameRu,
                available: product.stock,
                requested: qty,
              }),
            );
            return;
          }

          // Marked goods must be sold via their unique DataMatrix QR, never a plain EAN. Decided
          // per-product from the authoritative isMarked flag (tasnif `label`), falling back to the
          // MXIK group heuristic while isMarked is null.
          const requiresMarking = productRequiresMarking(product);
          if (hasSerial && requiresMarking) {
            // Check for duplicate in current cart
            const alreadyInCart = items.some(
              (i) => i.markingCode === normalizedNoGS,
            );
            if (alreadyInCart) {
              writeBarcode("", true);
              setError(t("pos.markingCodeInCart"));
              toast.error(t("pos.markingCodeInCart"));
              return;
            }

            // Add the item immediately (optimistic) so scanning stays instant. The resale
            // check (local SQLite + server) used to block every scan on a network round-trip
            // of up to several seconds; run it in the background instead and revert the line
            // if the code turns out to be already sold. The authoritative block still happens
            // at fiscalization (REGOS validates the label), so an async warning is enough here.
            const productName =
              i18n.language === "uz" ? product.nameUz : product.nameRu;
            const added = addItem({
              productId: product.id,
              productName,
              barcode: product.barcode,
              unitPrice: Number(product.price),
              quantity: 1,
              stock: product.stock,
              unit: product.unit,
              markingCode: normalizedNoGS,
            });
            // The store guard caught a duplicate the stale-closure pre-check above missed (2D
            // scanner double-fire). Surface the same "already in cart" message and skip the
            // redundant background checks since nothing was added.
            if (!added) {
              writeBarcode("", true);
              setError(t("pos.markingCodeInCart"));
              toast.error(t("pos.markingCodeInCart"));
              return;
            }
            resetInputs();

            // Background resale check — skippable via Fiscal settings toggle. Has this exact label
            // already been sold (local/cross-terminal)? If so, revert the optimistic add and warn.
            // (Circulation / out-of-circulation is intentionally NOT checked here — such labels are
            // allowed into the cart; REGOS:VCR remains the authoritative gate at fiscalization.)
            if (markingCheckRef.current) {
              window.electronAPI.markingCodes
                .check(normalizedNoGS)
                .then((checkResult) => {
                  const r = checkResult as {
                    alreadySold: boolean;
                    soldAt?: string;
                    terminalId?: string;
                  };
                  if (!r.alreadySold) return;
                  // Revert the optimistic add and warn the cashier.
                  removeByMarkingCode(normalizedNoGS);
                  const when = r.soldAt
                    ? new Date(r.soldAt).toLocaleString("ru-RU")
                    : "";
                  const msg = t("pos.markingCodeAlreadySold", {
                    when,
                    terminal: r.terminalId ?? "",
                  });
                  setError(msg);
                  toast.error(msg);
                })
                .catch(() => {
                  // IPC/network error — allow the sale (offline-first); line stays in cart.
                });
            }
            return;
          }

          // Block plain EAN barcode entry for marked products.
          // DataMatrix QR inputs are longer and non-numeric — those pass through.
          const isPlainBarcode = /^\d{8}$|^\d{12}$|^\d{13}$/.test(rawValue);
          if (isPlainBarcode && requiresMarking) {
            writeBarcode("", true);
            setError(t("pos.qrOnlyProduct"));
            return;
          }

          // Weighed on the scale, not typed — the modal supplies the quantity.
          if (needsScaleWeighing(product)) {
            resetInputs();
            setBulkWeighProduct(product);
            return;
          }
          addProductToCart(product, qty);
          resetInputs();
        }
      } else {
        writeBarcode("", true);
        setId("");
        setQuantity("1");
        setError(t("products.noResults"));
      }
    } catch (err) {
      const msg =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error("Error searching product:", err);
      window.electronAPI.logger.error(`handleBarcodeSubmit: ${msg}`);
      setError(t("common.error"));
    }
  }, [
    inputMode,
    quantity,
    searchByBarcode,
    addProductToCart,
    needsScaleWeighing,
    addItem,
    removeByMarkingCode,
    items,
    t,
    handleIdSubmit,
    i18n.language,
    toast,
    writeBarcode,
  ]);

  const handleQuickPay = useCallback(
    async (method: "cash" | "card") => {
      if (items.length === 0 || payingRef.current) return;
      if (!(await checkSmena())) {
        setShowSmenaModal(true);
        return;
      }

      payingRef.current = true;

      try {
        const saleData = {
          items: items.map((item) => ({
            productId: String(item.productId),
            productName: item.productName,
            barcode: item.barcode,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            preWeighedItemId: item.preWeighedItemId,
          })),
          paymentMethod: method,
          discountAmount: discount,
          markingCodes: items
            .filter((i) => i.markingCode)
            .map((i) => ({ barcode: i.barcode, label: i.markingCode! })),
        };

        const sale = editingSaleId
          ? await updateSale(editingSaleId, saleData)
          : await createSale(saleData);

        if (sale) {
          // Record marking codes (group 022) for sold items — fire and forget
          const markingEntries = items
            .filter((i) => i.markingCode)
            .map((i) => ({ code: i.markingCode!, productBarcode: i.barcode }));
          if (markingEntries.length > 0) {
            window.electronAPI.markingCodes
              .record(markingEntries)
              .catch(() => {});
          }

          clearCart();
          window.dispatchEvent(new Event("stock-updated"));
          toast.success(
            editingSaleId
              ? t("pos.saleUpdated")
              : `${t("pos.paymentComplete")} — ${t("pos.receiptNumber")}: ${sale.receiptNumber}`,
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error ? (err.stack ?? err.message) : String(err);
        console.error("Quick pay failed:", err);
        window.electronAPI.logger.error(`handleQuickPay(${method}): ${msg}`);
        toast.error(parseSaleError(err, t));
        clearCart();
      } finally {
        payingRef.current = false;
      }
    },
    [
      checkSmena,
      items,
      discount,
      editingSaleId,
      createSale,
      updateSale,
      clearCart,
      removeByMarkingCode,
      toast,
      t,
    ],
  );

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if checkout or smena modal is open
      if (showCheckout || showSmenaModal) return;

      // Let native inputs handle their own keyboard events
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Barcode mode: capture printable input from the PHYSICAL key (KeyboardEvent.code) so the
      // scanner is immune to the OS input language. Under a Cyrillic (Russian) layout, `e.key`
      // would render the scanner's keystrokes as Cyrillic and mangle alphanumeric DataMatrix
      // marking codes (e.g. 01…21'RO+jTyXP); the physical key always yields the intended ASCII.
      // Shift is honoured for case; Ctrl/Alt/Cmd combos stay app shortcuts. ALT-numeric / IME
      // input has no mapped physical key but arrives as a correct printable `e.key`, so fall
      // back to that. Letters/symbols/digits all flow through here in barcode mode.
      if (inputMode === "barcode" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const physical = physicalKeyToChar(e.code, e.shiftKey);
        const ch =
          physical ??
          (e.key.length === 1 && /^[\x20-\x7E]$/.test(e.key) ? e.key : null);
        if (ch !== null) {
          e.preventDefault();
          writeBarcode(barcodeRef.current + ch);
          setError("");
          return;
        }
      }

      // Number keys (ID / quantity modes — barcode digits are handled above)
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (inputMode === "id") {
          setId((prev) => prev + e.key);
        } else {
          setQuantity((prev) => (prev === "0" ? e.key : prev + e.key));
        }
        setError("");
      }
      // Backspace
      else if (e.key === "Backspace") {
        e.preventDefault();
        if (inputMode === "barcode") {
          writeBarcode(barcodeRef.current.slice(0, -1), true);
        } else if (inputMode === "id") {
          setId((prev) => prev.slice(0, -1));
        } else {
          setQuantity((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
        }
      }
      // Enter - submit barcode
      else if (e.key === "Enter") {
        e.preventDefault();
        handleBarcodeSubmit();
      }
      // Tab - switch input mode
      else if (e.key === "Tab") {
        e.preventDefault();
        setInputMode((prev) => (prev === "barcode" ? "quantity" : "barcode"));
      }
      // Escape - clear
      else if (e.key === "Escape") {
        e.preventDefault();
        handleClear();
      }
      // . - add decimal point in quantity mode
      else if (e.key === "." && inputMode === "quantity") {
        e.preventDefault();
        if (!quantity.includes(".")) {
          setQuantity((prev) => prev + ".");
        }
      }
      // * - switch to quantity
      else if (e.key === "*") {
        e.preventDefault();
        setInputMode("quantity");
      }
      // F10 - open checkout
      else if (e.key === "F10") {
        e.preventDefault();
        if (items.length > 0) {
          handleCheckoutClick();
        }
      }
      // F11 - quick pay cash
      else if (e.key === "F11") {
        e.preventDefault();
        handleQuickPay("cash");
      }
      // F12 - quick pay card
      else if (e.key === "F12") {
        e.preventDefault();
        handleQuickPay("card");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // `barcode` is intentionally NOT a dependency — the handler appends via the barcodeRef
    // buffer (writeBarcode), so it never needs the latest `barcode` value. This keeps the
    // listener mounted across a scan burst instead of re-subscribing on every keystroke.
  }, [
    inputMode,
    quantity,
    showCheckout,
    showSmenaModal,
    handleBarcodeSubmit,
    handleQuickPay,
    writeBarcode,
  ]);

  const handleBulkWeighAddNow = useCallback(
    (weight: number) => {
      if (!bulkWeighProduct) return;
      addProductToCart(bulkWeighProduct, weight);
      setBulkWeighProduct(null);
    },
    [bulkWeighProduct, addProductToCart],
  );

  const handleBulkWeighPrintAndScan = useCallback(
    (_weighedItemId: string, _barcode: string) => {
      // The label is printed; the cart line is created when it is scanned back in.
      setBulkWeighProduct(null);
      toast.info(t("bulkWeigh.scanLabel"));
    },
    [toast, t],
  );

  // Group 022 resale check (SoldMarkingCode lookup) — toggleable in Fiscal settings.
  // (The unfiscalized-receipts badge lives in the Cart header.)
  const markingCheckRef = useRef(true);
  useEffect(() => {
    window.electronAPI.fiscal
      .getConfig()
      .then((c) => {
        markingCheckRef.current = c.markingCodeCheck;
      })
      .catch(() => {});
  }, []);

  const handleNumberClick = (num: string) => {
    if (inputMode === "barcode") {
      writeBarcode(barcodeRef.current + num, true);
    } else if (inputMode === "id") {
      setId((prev) => prev + num);
    } else {
      setQuantity((prev) => (prev === "0" ? num : prev + num));
    }
    setError("");
  };

  const handleBackspace = () => {
    if (inputMode === "barcode") {
      writeBarcode(barcodeRef.current.slice(0, -1), true);
    } else if (inputMode === "id") {
      setId((prev) => prev.slice(0, -1));
    } else {
      setQuantity((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
    }
  };

  const handleClear = () => {
    if (inputMode === "barcode") {
      writeBarcode("", true);
    } else if (inputMode === "id") {
      setId("");
    } else {
      setQuantity("1");
    }
    setError("");
  };

  // useCallback so the memoized Catalog modal keeps stable props and doesn't re-render when
  // POSScreen re-renders (e.g. during a scan burst).
  const handleProductSelect = useCallback(
    (product: Product) => {
      // Marked goods can't be added from the catalog — they require a QR scan.
      if (productRequiresMarking(product)) {
        setError(t("pos.qrOnlyProduct"));
        return;
      }
      // Weighed on the scale, not typed. Checked BEFORE the stock guard: the Quantity
      // field is irrelevant here, and its default of 1 would spuriously fail the guard
      // for a product with under 1 unit left.
      if (needsScaleWeighing(product)) {
        setQuantity("1");
        setError("");
        setBulkWeighProduct(product);
        return;
      }
      const qty = parseFloat(quantity) || 1;
      if (qty > product.stock) {
        setError(
          t("errors.insufficientStock", {
            name: i18n.language === "uz" ? product.nameUz : product.nameRu,
            available: product.stock,
            requested: qty,
          }),
        );
        return;
      }
      addProductToCart(product, qty);
      setQuantity("1");
      setError("");
    },
    [quantity, t, i18n.language, addProductToCart, needsScaleWeighing],
  );

  const handleCheckoutComplete = () => {
    setShowCheckout(false);
  };

  // Detect whether the current barcode field value looks like an EAN barcode or a QR code.
  const barcodeType: "barcode" | "qr" | null = barcode
    ? /^\d{8}$|^\d{12}$|^\d{13}$/.test(barcode)
      ? "barcode"
      : "qr"
    : null;

  const handleCheckoutClick = async () => {
    if (!(await checkSmena())) {
      setShowSmenaModal(true);
      return;
    }
    setShowCheckout(true);
  };

  return (
    <PageWrapper>
      <PosTabBar />
      <Container>
        <InputColumn>
          <CatalogButton type="button" onClick={() => setShowCatalog(true)}>
            <LayoutGrid size={18} />
            {t("pos.catalog", "Каталог")}
          </CatalogButton>
          <InputSection>
              <InputPanel>
                <InputLabel
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  {barcodeType === "qr" ? (
                    <QrCode size={12} />
                  ) : (
                    <Barcode size={12} />
                  )}
                  {barcodeType === "qr" ? t("pos.qrCode") : t("pos.barcode")}
                </InputLabel>
                <InputDisplay
                  $active={inputMode === "barcode"}
                  onClick={() => setInputMode("barcode")}
                >
                  {barcode || "—"}
                </InputDisplay>
              </InputPanel>

              <InputRow>
                <InputPanel>
                  <InputLabel>{t("pos.id")}</InputLabel>
                  <InputDisplay
                    $active={inputMode === "id"}
                    onClick={() => setInputMode("id")}
                  >
                    {id || "—"}
                  </InputDisplay>
                </InputPanel>

                <InputPanel>
                  <InputLabel>{t("pos.quantity")}</InputLabel>
                  <InputDisplay
                    $active={inputMode === "quantity"}
                    onClick={() => setInputMode("quantity")}
                  >
                    {quantity}
                  </InputDisplay>
                </InputPanel>
              </InputRow>
            </InputSection>

            <NumberPadSection>
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <NumberPad>
                {["7", "8", "9"].map((num) => (
                  <NumButton key={num} onClick={() => handleNumberClick(num)}>
                    {num}
                  </NumButton>
                ))}
                <NumButton $variant="clear" onClick={handleClear}>
                  <Trash size={20} />
                </NumButton>

                {["4", "5", "6"].map((num) => (
                  <NumButton key={num} onClick={() => handleNumberClick(num)}>
                    {num}
                  </NumButton>
                ))}
                <NumButton $variant="action" onClick={handleBackspace}>
                  <Delete size={20} />
                </NumButton>

                {["1", "2", "3"].map((num) => (
                  <NumButton key={num} onClick={() => handleNumberClick(num)}>
                    {num}
                  </NumButton>
                ))}
                <NumButton
                  $variant="action"
                  onClick={() =>
                    setInputMode(
                      inputMode === "barcode" ? "quantity" : "barcode",
                    )
                  }
                >
                  {inputMode === "barcode" ? "QTY" : "BAR"}
                </NumButton>

                <NumButton onClick={() => handleNumberClick("00")}>
                  00
                </NumButton>
                <NumButton onClick={() => handleNumberClick("0")}>0</NumButton>
                <NumButton onClick={() => handleNumberClick(".")}>.</NumButton>
                <NumButton $variant="enter" onClick={handleBarcodeSubmit}>
                  <SendHorizontal size={20} />
                </NumButton>
              </NumberPad>
            </NumberPadSection>
            <Button
              fullWidth
              onClick={handleCheckoutClick}
              disabled={items.length === 0}
            >
              {editingSaleId
                ? t("pos.save")
                : t("pos.pay") + " - " + formatCurrency(total)}{" "}
              <ShortcutHint>(F10)</ShortcutHint>
            </Button>
            <QuickPayRow>
              <QuickPayButton
                $variant="cash"
                onClick={() => handleQuickPay("cash")}
                disabled={items.length === 0 || isPayingLoading}
              >
                <Banknote size={18} />
                {t("pos.cash")}
                <ShortcutHint>(F11)</ShortcutHint>
              </QuickPayButton>
              <QuickPayButton
                $variant="card"
                onClick={() => handleQuickPay("card")}
                disabled={items.length === 0 || isPayingLoading}
              >
                <CreditCard size={18} />
                {t("pos.card")}
                <ShortcutHint>(F12)</ShortcutHint>
              </QuickPayButton>
            </QuickPayRow>
        </InputColumn>

        <CartSection>
          <Cart />
        </CartSection>

        {showCheckout && (
          <Checkout
            onComplete={handleCheckoutComplete}
            onCancel={() => setShowCheckout(false)}
          />
        )}

        {showSmenaModal && (
          <Modal
            title={t("smena.title")}
            onClose={() => setShowSmenaModal(false)}
            width="400px"
          >
            <SmenaBlock>
              <SmenaBlockText>{t("smena.noOpenSmena")}</SmenaBlockText>
              <Button
                onClick={() => {
                  setShowSmenaModal(false);
                  openSmenaModal();
                }}
              >
                {t("smena.goToSmena")} →
              </Button>
            </SmenaBlock>
          </Modal>
        )}

        {showCatalog && (
          <Catalog onSelect={handleProductSelect} onClose={closeCatalog} />
        )}

        {bulkWeighProduct && (
          <BulkWeighModal
            product={bulkWeighProduct}
            onAddToCart={handleBulkWeighAddNow}
            onPrintAndScan={handleBulkWeighPrintAndScan}
            onCancel={() => setBulkWeighProduct(null)}
          />
        )}
      </Container>
    </PageWrapper>
  );
}
