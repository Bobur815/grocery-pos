import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { AlertTriangle, Bug, RefreshCw, Scale } from "lucide-react";
import { Table } from "@components/common/Table";
import { Button } from "@components/common/Button";
import { DateInput } from "@components/common/DateInput";
import { EmptyPlaceholder } from "@components/common/EmptyPlaceholder";
import { Spinner } from "@renderer/components/common/Spinner";
import { useToast } from "@context/ToastContext";
import { formatCurrency } from "@shared/utils";
import { formatDateTime } from "../../utils/formatters";
import {
  reconciliation,
  type GoodsReconciliation,
  type MoneyReconciliation,
} from "../../api/client";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Toolbar = styled.div`
  display: flex;
  align-items: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-wrap: wrap;
`;

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.md};
`;

const CardLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 4px;
`;

const CardValue = styled.div<{ $tone?: "bad" | "good" | "plain" }>`
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: ${({ theme, $tone }) =>
    $tone === "bad"
      ? theme.colors.error
      : $tone === "good"
        ? theme.colors.success
        : theme.colors.text};
`;

const Section = styled.h2`
  margin: ${({ theme }) => theme.spacing.md} 0 0;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
`;

/** Deliberately styled unlike the variance table — this is a bug report, not a shrinkage report. */
const BugBanner = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.error}10;
  border: 1px solid ${({ theme }) => theme.colors.error}50;
  color: ${({ theme }) => theme.colors.text};
  font-size: 13px;
`;

const InfoBanner = styled(BugBanner)`
  background: ${({ theme }) => theme.colors.warning}10;
  border-color: ${({ theme }) => theme.colors.warning}50;
`;

const Num = styled.span<{ $tone?: "bad" | "good" }>`
  font-variant-numeric: tabular-nums;
  color: ${({ theme, $tone }) =>
    $tone === "bad"
      ? theme.colors.error
      : $tone === "good"
        ? theme.colors.success
        : "inherit"};
`;

const Subtitle = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Centered = styled.div`
  display: flex;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.lg};
`;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function ReconciliationPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [goods, setGoods] = useState<GoodsReconciliation | null>(null);
  const [money, setMoney] = useState<MoneyReconciliation | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, m] = await Promise.all([
        reconciliation.goods({ from, to }),
        reconciliation.money({ from, to }),
      ]);
      setGoods(g);
      setMoney(m);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [from, to, t, toast]);

  useEffect(() => {
    void load();
    // Deliberately on mount only — the date inputs drive an explicit refresh, so changing a
    // date does not fire a full-catalog recompute on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const varianceLines = (goods?.lines ?? []).filter((l) => l.varianceQty !== null);

  return (
    <Container>
      <Title>
        <Scale size={22} />
        {t("reconciliation.title", "Сверка")}
      </Title>

      {/* Which counted truth the book figures are measured from. Without this the numbers
          look absolute when they are in fact relative to the last stocktake. */}
      {goods?.periodStart && (
        <Subtitle>
          {t("reconciliation.anchoredAt", "Отсчёт от инвентаризации")}:{" "}
          {formatDateTime(goods.periodStart)}
        </Subtitle>
      )}

      <Toolbar>
        <DateInput
          label={t("reconciliation.from", "С")}
          value={from}
          onChange={setFrom}
        />
        <DateInput label={t("reconciliation.to", "По")} value={to} onChange={setTo} />
        <Button type="button" onClick={load} disabled={loading}>
          <RefreshCw size={16} />
          {t("reconciliation.refresh", "Обновить")}
        </Button>
      </Toolbar>

      {loading && (
        <Centered>
          <Spinner />
        </Centered>
      )}

      {!loading && goods && !goods.ledgerEnabled && (
        <InfoBanner>
          <AlertTriangle size={18} />
          <span>
            {t(
              "reconciliation.ledgerDisabled",
              "Журнал движений выключен (RECONCILIATION_LEDGER_ENABLED). Новые движения не записываются, поэтому расчёт будет неполным.",
            )}
          </span>
        </InfoBanner>
      )}

      {!loading && goods && !goods.crossCheck.clean && (
        <BugBanner>
          <Bug size={18} />
          <div>
            <strong>
              {t("reconciliation.crossCheckFailed", "Расхождение книги и журнала")}
            </strong>
            <div>
              {t(
                "reconciliation.crossCheckHint",
                "Это ошибка приложения или синхронизации, а НЕ недостача. Не ищите виновных по этим строкам.",
              )}
            </div>
          </div>
        </BugBanner>
      )}

      {!loading && goods && (
        <>
          <Cards>
            <Card>
              <CardLabel>{t("reconciliation.shortages", "Недостачи (позиций)")}</CardLabel>
              <CardValue $tone={goods.totals.shortageQtyLines > 0 ? "bad" : "good"}>
                {goods.totals.shortageQtyLines}
              </CardValue>
            </Card>
            <Card>
              <CardLabel>{t("reconciliation.surpluses", "Излишки (позиций)")}</CardLabel>
              <CardValue>{goods.totals.surplusQtyLines}</CardValue>
            </Card>
            <Card>
              <CardLabel>{t("reconciliation.varianceCost", "Расхождение по себестоимости")}</CardLabel>
              <CardValue $tone={Number(goods.totals.varianceCost) > 0 ? "bad" : "plain"}>
                {formatCurrency(Number(goods.totals.varianceCost))}
              </CardValue>
            </Card>
            <Card>
              <CardLabel>{t("reconciliation.varianceRetail", "Расхождение в розничных ценах")}</CardLabel>
              <CardValue>{formatCurrency(Number(goods.totals.varianceRetail))}</CardValue>
            </Card>
          </Cards>

          <Section>{t("reconciliation.goodsTitle", "Товары — по позициям")}</Section>
          {goods.countId === null ? (
            <InfoBanner>
              <AlertTriangle size={18} />
              <span>
                {t(
                  "reconciliation.noCount",
                  "Нет завершённой инвентаризации за период — сравнивать книгу не с чем. Показан только книжный остаток.",
                )}
              </span>
            </InfoBanner>
          ) : varianceLines.length === 0 ? (
            <EmptyPlaceholder
              icon={<Scale size={40} />}
              title={t("reconciliation.allClear", "Всё сходится")}
              description={t(
                "reconciliation.allClearHint",
                "Книжный остаток совпал с фактическим по всем посчитанным позициям.",
              )}
            />
          ) : (
            <Table
              data={varianceLines}
              columns={[
                { key: "productName", header: t("products.name", "Товар") },
                { key: "barcode", header: t("products.barcode", "Штрих-код") },
                {
                  key: "bookQty",
                  header: t("reconciliation.book", "Книга"),
                  render: (l) => <Num>{l.bookQty}</Num>,
                },
                {
                  key: "countedQty",
                  header: t("reconciliation.counted", "Факт"),
                  render: (l) => <Num>{l.countedQty}</Num>,
                },
                {
                  key: "varianceQty",
                  header: t("reconciliation.variance", "Расхождение"),
                  // Positive = shortage. Signed on purpose so a surplus never reads as a loss
                  // at a glance.
                  render: (l) => {
                    const v = Number(l.varianceQty);
                    return (
                      <Num $tone={v > 0 ? "bad" : v < 0 ? "good" : undefined}>
                        {v > 0 ? `+${l.varianceQty}` : l.varianceQty}
                      </Num>
                    );
                  },
                },
                {
                  key: "varianceCost",
                  header: t("reconciliation.atCost", "По себест."),
                  render: (l) =>
                    l.varianceCost === null
                      ? "—"
                      : formatCurrency(Number(l.varianceCost)),
                },
              ]}
            />
          )}

          {!goods.crossCheck.clean && (
            <>
              <Section>
                <Bug size={16} />
                {t("reconciliation.crossCheckTitle", "Техническое расхождение (не недостача)")}
              </Section>
              <Table
                data={goods.crossCheck.rows}
                columns={[
                  { key: "productName", header: t("products.name", "Товар") },
                  { key: "perpetual", header: t("reconciliation.perpetual", "Product.stock") },
                  { key: "recomputed", header: t("reconciliation.recomputed", "По журналу") },
                  {
                    key: "drift",
                    header: t("reconciliation.drift", "Дрейф"),
                    render: (r) => <Num $tone="bad">{r.drift}</Num>,
                  },
                ]}
              />
            </>
          )}
        </>
      )}

      {!loading && money && (
        <>
          <Section>{t("reconciliation.moneyTitle", "Деньги — по способам оплаты")}</Section>
          {money.limitation === "NO_SHIFT_DATA_ON_SERVER" && (
            <InfoBanner>
              <AlertTriangle size={18} />
              <span>
                {t(
                  "reconciliation.noShiftData",
                  "Данные смен (наличные в кассе) пока не синхронизируются на сервер, поэтому расхождение по кассе не рассчитывается. Показана только выручка по способам оплаты.",
                )}
              </span>
            </InfoBanner>
          )}
          <Table
            data={money.byTender}
            columns={[
              { key: "tender", header: t("reconciliation.tender", "Способ оплаты") },
              { key: "saleCount", header: t("reconciliation.saleCount", "Чеков") },
              {
                key: "amount",
                header: t("reconciliation.amount", "Сумма"),
                render: (r) => formatCurrency(Number(r.amount)),
              },
            ]}
            tfoot={
              <>
                <tr>
                  <td>
                    <strong>{t("reconciliation.netSales", "Итого продаж")}</strong>
                  </td>
                  <td />
                  <td>
                    <strong>{formatCurrency(Number(money.netSales))}</strong>
                  </td>
                </tr>
                <tr>
                  <td>{t("reconciliation.discounts", "Скидки (справочно)")}</td>
                  <td />
                  <td>{formatCurrency(Number(money.discounts))}</td>
                </tr>
              </>
            }
          />
        </>
      )}
    </Container>
  );
}

export default ReconciliationPage;
