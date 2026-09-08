import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import styled, { type DefaultTheme } from 'styled-components';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { useSales } from '../../hooks/useSales';
import type { Sale } from '@shared/types/sale.types';
import { formatCurrency as formatCurrencyBase } from '@shared/utils';
import { UZQR_BRAND_COLOR, SALE_TENDER_I18N_KEYS, type SaleTender } from '@shared/constants';
import { ChevronDown, ChevronRight, Pencil, Printer, Trash2, ShieldCheck, ShieldAlert, RotateCcw, Copy } from 'lucide-react';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useToast } from '../../context/ToastContext';
import { useSuperAdminGate } from '../../components/gate/SuperAdminGate';

// Date-range options for the history filter. Lets the cashier reach older receipts so they can
// be (re-)fiscalized from here — e.g. after enabling the non-VAT-payer mode or fixing an MXIK.
type DateRange = 'today' | 'week' | 'month' | 'year';

/** Local midnight at the start of the selected range (week starts Monday, per ru/uz locale). */
function startOfRange(range: DateRange): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  switch (range) {
    case 'week': {
      const day = d.getDay(); // 0=Sun … 6=Sat
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // back to Monday
      return d;
    }
    case 'month':
      d.setDate(1);
      return d;
    case 'year':
      d.setMonth(0, 1);
      return d;
    case 'today':
    default:
      return d;
  }
}

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const ToolbarLabel = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const RangeSelect = styled.select`
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 13px;
  cursor: pointer;
  &:focus { outline: none; border-color: ${({ theme }) => theme.colors.primary}; }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const SaleRow = styled.div<{ $expanded?: boolean }>`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  overflow: hidden;
  ${({ $expanded, theme }) => $expanded && `border-color: ${theme.colors.primary};`}
`;

const SaleHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  cursor: pointer;
  gap: ${({ theme }) => theme.spacing.sm};

  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
  }
`;

const SaleInfo = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  flex: 1;
  min-width: 0;
`;

const ReceiptNum = styled.span`
  font-weight: 600;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
`;

const Time = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
`;

/** Green = money in the till, house blue = bank card, navy = the UzQR brand. */
function tenderColor(theme: DefaultTheme, method?: string) {
  if (method === 'uzqr') return UZQR_BRAND_COLOR;
  return method === 'card' ? theme.colors.primary : theme.colors.success;
}

const Badge = styled.span<{ $method?: string }>`
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
  background-color: ${({ theme, $method }) => tenderColor(theme, $method) + '15'};
  color: ${({ theme, $method }) => tenderColor(theme, $method)};
`;

const FiscalBadge = styled.span<{ $ok?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
  background-color: ${({ theme, $ok }) => ($ok ? theme.colors.success : theme.colors.error) + '18'};
  color: ${({ theme, $ok }) => ($ok ? theme.colors.success : theme.colors.error)};
`;

const RefundedBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
  background-color: ${({ theme }) => theme.colors.textSecondary + '20'};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Amount = styled.span`
  font-weight: 700;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.primary};
  white-space: nowrap;
`;

const ItemsPanel = styled.div`
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.background};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
`;

const ItemLine = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};

  &:not(:last-child) {
    border-bottom: 1px solid ${({ theme }) => theme.colors.border}50;
  }
`;

const ItemName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ItemQty = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0 ${({ theme }) => theme.spacing.sm};
  white-space: nowrap;
`;

const LoadingText = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.lg};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const EmptyText = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xl};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

const IconButton = styled.button`
  background: none;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  cursor: pointer;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  white-space: nowrap;
`;

const EditButton = styled(IconButton)`
  color: ${({ theme }) => theme.colors.primary};
  &:hover {
    background-color: ${({ theme }) => theme.colors.primary}10;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const PrintButton = styled(IconButton)`
  color: ${({ theme }) => theme.colors.textSecondary};
  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
    border-color: ${({ theme }) => theme.colors.textSecondary};
    color: ${({ theme }) => theme.colors.text};
  }
`;

const DeleteButton = styled(IconButton)`
  color: ${({ theme }) => theme.colors.error};
  &:hover {
    background-color: ${({ theme }) => theme.colors.error}10;
    border-color: ${({ theme }) => theme.colors.error};
  }
`;

const FiscalizeButton = styled(IconButton)`
  color: ${({ theme }) => theme.colors.error};
  font-weight: 600;
  &:hover {
    background-color: ${({ theme }) => theme.colors.error}10;
    border-color: ${({ theme }) => theme.colors.error};
  }
`;

const RefundButton = styled(IconButton)`
  color: ${({ theme }) => theme.colors.error};
  &:hover {
    background-color: ${({ theme }) => theme.colors.error}10;
    border-color: ${({ theme }) => theme.colors.error};
  }
`;

const DuplicateButton = styled(IconButton)`
  color: ${({ theme }) => theme.colors.textSecondary};
  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
    border-color: ${({ theme }) => theme.colors.textSecondary};
    color: ${({ theme }) => theme.colors.text};
  }
`;

// ─── Main Component ───────────────────────────────────────────────────────────

interface SalesHistoryModalProps {
  onClose: () => void;
  onEditSale: (sale: Sale) => void;
}

export function SalesHistoryModal({ onClose, onEditSale }: SalesHistoryModalProps) {
  const { t, i18n } = useTranslation();
  const { sales, isLoading, loadSales, deleteSale } = useSales();
  const toast = useToast();
  const [range, setRange] = useState<DateRange>('today');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [fiscalizingId, setFiscalizingId] = useState<string | null>(null);
  const [refundConfirmId, setRefundConfirmId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const gate = useSuperAdminGate();

  const formatCurrency = (amount: number) => formatCurrencyBase(amount, i18n.language as 'ru' | 'uz');

  // Deleting a receipt removes it from the record and puts its goods back on the shelf, so it is
  // gated on the manager-override password when the store has one. `require` runs the action
  // straight through for a store that has not configured one.
  const handleDelete = () => gate.require(performDelete);

  const performDelete = async () => {
    if (!deleteConfirmId) return;
    const sale = sales.find((s) => s.id === deleteConfirmId);
    // A fiscalized receipt must be reversed on the OFD before the local record is dropped,
    // otherwise the fiscal record stays open. Refund first (unless already refunded);
    // abort the delete if that fails.
    if (sale?.fiscalStatus === 'FISCALIZED' && !sale.refunded) {
      const res = await window.electronAPI.fiscal.refund(sale.id);
      if (!res.ok) {
        toast.error(res.error || t('common.error'));
        setDeleteConfirmId(null);
        return;
      }
    }
    const success = await deleteSale(deleteConfirmId);
    if (success) {
      // Free this sale's group-022 marking codes so the items can be sold again.
      await window.electronAPI.markingCodes.removeForSale(deleteConfirmId).catch(() => {});
      window.dispatchEvent(new Event('stock-updated'));
      toast.success(t('pos.saleDeleted'));
    } else {
      toast.error(t('common.error'));
    }
    setDeleteConfirmId(null);
  };

  const handlePrint = useCallback(async (sale: Sale, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electronAPI.printer.printReceipt(sale.id);
      toast.success(t('pos.receiptPrinted'));
    } catch {
      toast.error(t('common.error'));
    }
  }, [t, toast]);

  const reload = useCallback(async () => {
    await loadSales({ startDate: startOfRange(range).toISOString() });
  }, [loadSales, range]);

  // Re-fiscalize a receipt that failed or is pending (e.g. after fixing the product's MXIK).
  const handleFiscalize = useCallback(async (sale: Sale, e: React.MouseEvent) => {
    e.stopPropagation();
    setFiscalizingId(sale.id);
    try {
      const res = await window.electronAPI.fiscal.retrySale(sale.id);
      await reload();
      if (res.ok) toast.success(t('fiscalSettings.fiscalized', 'Фискализировано'));
      else toast.error(res.error || t('common.error'));
    } finally {
      setFiscalizingId(null);
    }
  }, [reload, t, toast]);

  // Full fiscal refund (Receipt.FullRefund) — reverses the receipt on the OFD.
  const handleRefund = useCallback(async () => {
    if (!refundConfirmId) return;
    const id = refundConfirmId;
    setRefundConfirmId(null);
    setRefundingId(id);
    try {
      const res = await window.electronAPI.fiscal.refund(id);
      if (res.ok) {
        // Free this sale's group-022 marking codes so the items can be sold again.
        await window.electronAPI.markingCodes.removeForSale(id).catch(() => {});
        toast.success(t('pos.refunded', 'Возврат оформлен'));
        window.dispatchEvent(new Event('stock-updated'));
      } else {
        toast.error(res.error || t('common.error'));
      }
      await reload();
    } finally {
      setRefundingId(null);
    }
  }, [refundConfirmId, reload, t, toast]);

  // Reprint a fiscal duplicate (Receipt.Duplicate).
  const handleDuplicate = useCallback(async (sale: Sale, e: React.MouseEvent) => {
    e.stopPropagation();
    setDuplicatingId(sale.id);
    try {
      const res = await window.electronAPI.fiscal.printDuplicate(sale.id);
      if (res.ok) toast.success(t('pos.duplicatePrinted', 'Дубликат напечатан'));
      else toast.error(res.error || t('common.error'));
    } finally {
      setDuplicatingId(null);
    }
  }, [t, toast]);

  // Load on mount and whenever the selected range changes (reload depends on `range`).
  useEffect(() => {
    reload();
  }, [reload]);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString(i18n.language === 'uz' ? 'uz-UZ' : 'ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      <Modal
        title={t('pos.salesHistory')}
        onClose={onClose}
        width="900px"
      >
        <Toolbar>
          <ToolbarLabel>{t('pos.period', 'Период')}</ToolbarLabel>
          <RangeSelect value={range} onChange={(e) => setRange(e.target.value as DateRange)}>
            <option value="today">{t('pos.today', 'Сегодня')}</option>
            <option value="week">{t('pos.rangeWeek', 'С начала недели')}</option>
            <option value="month">{t('pos.rangeMonth', 'С начала месяца')}</option>
            <option value="year">{t('pos.rangeYear', 'С начала года')}</option>
          </RangeSelect>
        </Toolbar>
        {isLoading ? (
          <LoadingText>{t('common.loading')}</LoadingText>
        ) : sales.length === 0 ? (
          <EmptyText>{t('pos.noSales')}</EmptyText>
        ) : (
          <List>
            {sales.map((sale) => {
              const expanded = expandedId === sale.id;
              return (
                <SaleRow key={sale.id} $expanded={expanded}>
                  <SaleHeader onClick={() => setExpandedId(expanded ? null : sale.id)}>
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <SaleInfo>
                      <ReceiptNum>#{sale.receiptNumber}</ReceiptNum>
                      <Time>{formatTime(sale.createdAt)}</Time>
                      <Badge $method={sale.paymentMethod}>
                        {t(SALE_TENDER_I18N_KEYS[sale.paymentMethod as SaleTender] ?? 'pos.cash')}
                      </Badge>
                      {sale.fiscalStatus === 'FISCALIZED' && (
                        sale.refunded ? (
                          <RefundedBadge>
                            <RotateCcw size={12} /> {t('pos.refunded', 'Возврат оформлен')}
                          </RefundedBadge>
                        ) : (
                          <FiscalBadge $ok>
                            <ShieldCheck size={12} /> {t('fiscalSettings.fiscalized', 'Фискализирован')}
                          </FiscalBadge>
                        )
                      )}
                      {(sale.fiscalStatus === 'FAILED' || sale.fiscalStatus === 'PENDING') && (
                        <FiscalBadge>
                          <ShieldAlert size={12} /> {t('pos.notFiscalized', 'Не фискализирован')}
                        </FiscalBadge>
                      )}
                    </SaleInfo>
                    <Amount>{formatCurrency(sale.finalAmount)}</Amount>
                    {(sale.fiscalStatus === 'FAILED' || sale.fiscalStatus === 'PENDING') && (
                      <FiscalizeButton
                        onClick={(e) => handleFiscalize(sale, e)}
                        disabled={fiscalizingId === sale.id}
                        title={t('pos.fiscalize', 'Фискализировать')}
                      >
                        <ShieldAlert size={16} />
                        {fiscalizingId === sale.id ? t('common.processing') : t('pos.fiscalize', 'Фискализировать')}
                      </FiscalizeButton>
                    )}
                    {sale.fiscalStatus === 'FISCALIZED' && (
                      <>
                        {!sale.refunded && (
                          <RefundButton
                            onClick={(e) => { e.stopPropagation(); setRefundConfirmId(sale.id); }}
                            disabled={refundingId === sale.id}
                            title={t('pos.refund', 'Возврат')}
                          >
                            <RotateCcw size={16} />
                            {refundingId === sale.id ? t('common.processing') : t('pos.refund', 'Возврат')}
                          </RefundButton>
                        )}
                        <DuplicateButton
                          onClick={(e) => handleDuplicate(sale, e)}
                          disabled={duplicatingId === sale.id}
                          title={t('pos.duplicate', 'Дубликат')}
                        >
                          <Copy size={16} />
                        </DuplicateButton>
                      </>
                    )}
                    <PrintButton
                      onClick={(e) => handlePrint(sale, e)}
                      title={t('pos.printReceipt')}
                    >
                      <Printer size={16} />
                    </PrintButton>
                    <EditButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditSale(sale);
                      }}
                      title={t('common.edit')}
                    >
                      <Pencil size={16} />
                    </EditButton>
                    <DeleteButton
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(sale.id);
                      }}
                      title={t('common.delete')}
                    >
                      <Trash2 size={16} />
                    </DeleteButton>
                  </SaleHeader>
                  {expanded && sale.items && (
                    <ItemsPanel>
                      {sale.items.map((item) => (
                        <ItemLine key={item.productId}>
                          <ItemName>{item.productName}</ItemName>
                          <ItemQty>{item.quantity} x {formatCurrency(item.unitPrice)}</ItemQty>
                          <span>{formatCurrency(item.subtotal)}</span>
                        </ItemLine>
                      ))}
                    </ItemsPanel>
                  )}
                </SaleRow>
              );
            })}
          </List>
        )}
        {deleteConfirmId && (
          <ConfirmDialog
            title={t('common.delete')}
            message={(() => {
              const s = sales.find((x) => x.id === deleteConfirmId);
              return s?.fiscalStatus === 'FISCALIZED' && !s.refunded
                ? t('pos.deleteFiscalizedConfirm', 'Чек фискализирован — при удалении будет оформлен фискальный возврат. Продолжить?')
                : t('pos.deleteSaleConfirm');
            })()}
            confirmLabel={t('common.delete')}
            cancelLabel={t('common.cancel')}
            variant="danger"
            onConfirm={handleDelete}
            onCancel={() => setDeleteConfirmId(null)}
          />
        )}
        {refundConfirmId && (
          <ConfirmDialog
            title={t('pos.refund', 'Возврат')}
            message={t('pos.refundConfirm', 'Оформить полный фискальный возврат по этому чеку?')}
            confirmLabel={t('pos.refund', 'Возврат')}
            cancelLabel={t('common.cancel')}
            variant="danger"
            onConfirm={handleRefund}
            onCancel={() => setRefundConfirmId(null)}
          />
        )}
      </Modal>
    </>
  );
}
