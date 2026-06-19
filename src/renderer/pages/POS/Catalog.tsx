import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Modal } from "../../components/common/Modal";
import { ProductSearch } from "./ProductSearch";
import { Product } from "@shared/types";

// Give the (flex:1 + internally-scrolling) ProductSearch a bounded height inside the
// auto-height Modal content so its product grid scrolls instead of growing the modal.
const CatalogBody = styled.div`
  height: 70vh;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

interface CatalogProps {
  onSelect: (product: Product) => void;
  onClose: () => void;
}

// Memoized + mounted only while open (POSScreen renders it behind `showCatalog`), so it does
// no work — and stays out of POSScreen's render path — until the cashier opens it. With stable
// onSelect/onClose props it won't re-render when POSScreen re-renders (e.g. during a scan burst).
function CatalogComponent({ onSelect, onClose }: CatalogProps) {
  const { t } = useTranslation();
  // Close the modal as soon as a product is picked (single-select flow).
  const handleSelect = useCallback(
    (product: Product) => {
      onSelect(product);
      onClose();
    },
    [onSelect, onClose],
  );
  return (
    <Modal title={t("pos.catalog", "Каталог")} onClose={onClose} width="900px">
      <CatalogBody>
        {/* Keyboard z-index above the Modal overlay (1000) so it isn't hidden behind it. */}
        <ProductSearch onSelect={handleSelect} keyboardZIndex={1100} />
      </CatalogBody>
    </Modal>
  );
}

export const Catalog = React.memo(CatalogComponent);
