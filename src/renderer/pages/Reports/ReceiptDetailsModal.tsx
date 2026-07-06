import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Modal } from "../../components/common/Modal";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { formatDateTime } from "../../utils/formatters";
import type { FiscalSalePreview } from "@shared/types/fiscal.types";
import { Copy, Check, ExternalLink } from "lucide-react";

// ─── Layout ──────────────────────────────────────────────────────────────────

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const FieldLabel = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.4px;
`;

const FieldValue = styled.span<{ $mono?: boolean }>`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  font-family: ${({ $mono }) => ($mono ? "monospace" : "inherit")};
  word-break: break-all;
`;

const StatusBadge = styled.span<{ $status: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  padding: 3px 12px;
  border-radius: 12px;
  background-color: ${({ theme, $status }) =>
    ($status === "FISCALIZED"
      ? theme.colors.success
      : $status === "FAILED"
        ? theme.colors.error
        : $status === "DISABLED"
          ? theme.colors.textSecondary
          : (theme.colors.warning ?? theme.colors.primary)) + "22"};
  color: ${({ theme, $status }) =>
    $status === "FISCALIZED"
      ? theme.colors.success
      : $status === "FAILED"
        ? theme.colors.error
        : $status === "DISABLED"
          ? theme.colors.textSecondary
          : (theme.colors.warning ?? theme.colors.primary)};
`;

const ErrorBox = styled.div`
  background-color: ${({ theme }) => theme.colors.error + "12"};
  border: 1px solid ${({ theme }) => theme.colors.error + "40"};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.error};
  word-break: break-word;
`;

const TableWrap = styled.div`
  overflow-x: auto;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
`;

const Th = styled.th`
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.4px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  white-space: nowrap;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Td = styled.td`
  padding: 8px 10px;
  color: ${({ theme }) => theme.colors.text};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  vertical-align: top;
  white-space: nowrap;
`;

const Tr = styled.tr`
  &:last-child td {
    border-bottom: none;
  }
`;

const Mono = styled.span`
  font-family: monospace;
`;

const MarkingCode = styled.code`
  display: block;
  font-family: monospace;
  font-size: 12px;
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: 6px 8px;
  word-break: break-all;
  color: ${({ theme }) => theme.colors.text};
`;

const MarkingRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Pre = styled.pre`
  margin: 0;
  max-height: 300px;
  overflow: auto;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.colors.text};
`;

const CopyBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;

  &:hover {
    background-color: ${({ theme }) => theme.colors.border};
    color: ${({ theme }) => theme.colors.text};
  }
`;

const QrLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: ${({ theme }) => theme.colors.primary};
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
`;

const Note = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Center = styled.div`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

interface Props {
  saleId: string;
  onClose: () => void;
}

export function ReceiptDetailsModal({ saleId, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<FiscalSalePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    window.electronAPI.fiscal
      .previewPayload(saleId)
      .then((res) => {
        if (!alive) return;
        if (!res) setError(t("reports.receiptDetails.notFound"));
        else setData(res);
      })
      .catch(
        (e) => alive && setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [saleId, t]);

  const fmtSum = (sum: number) =>
    formatCurrencyBase(sum, i18n.language as "ru" | "uz");
  const tiyinToSum = (tiyin: number) => fmtSum(tiyin / 100);
  const vatLabel = (tiyin: number) =>
    tiyin < 0 ? t("reports.receiptDetails.noVat") : tiyinToSum(tiyin);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const rd = (k: string) => t(`reports.receiptDetails.${k}`);

  return (
    <Modal title={rd("title")} onClose={onClose} width="820px">
      {loading ? (
        <Center>{t("common.loading")}</Center>
      ) : error ? (
        <Center>{error}</Center>
      ) : !data ? (
        <Center>{rd("notFound")}</Center>
      ) : (
        <Body>
          {/* ── Receipt info ── */}
          <Section>
            <SectionTitle>{rd("receiptInfo")}</SectionTitle>
            <Grid>
              <Field>
                <FieldLabel>{t("pos.receiptNumber")}</FieldLabel>
                <FieldValue $mono>#{data.receiptNumber}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>{t("reports.dateTime")}</FieldLabel>
                <FieldValue>{formatDateTime(data.createdAt)}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>{t("reports.cashier")}</FieldLabel>
                <FieldValue>{data.cashierName}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>{t("reports.terminal")}</FieldLabel>
                <FieldValue $mono>{data.terminalId}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>{t("reports.payment")}</FieldLabel>
                <FieldValue>
                  {data.paymentMethod === "cash" ? "💵 " : "💳 "}
                  {t(`pos.${data.paymentMethod}`)}
                </FieldValue>
              </Field>
              <Field>
                <FieldLabel>{rd("total")}</FieldLabel>
                <FieldValue>{fmtSum(data.totalAmount)}</FieldValue>
              </Field>
              {data.discountAmount > 0 && (
                <Field>
                  <FieldLabel>{rd("discount")}</FieldLabel>
                  <FieldValue>−{fmtSum(data.discountAmount)}</FieldValue>
                </Field>
              )}
              <Field>
                <FieldLabel>{rd("finalAmount")}</FieldLabel>
                <FieldValue style={{ fontWeight: 700 }}>
                  {fmtSum(data.finalAmount)}
                </FieldValue>
              </Field>
            </Grid>
          </Section>

          {/* ── Fiscal status ── */}
          <Section>
            <SectionTitle>{rd("fiscalStatus")}</SectionTitle>
            <div>
              <StatusBadge $status={data.fiscalStatus ?? "PENDING"}>
                {data.fiscalStatus ?? "PENDING"}
              </StatusBadge>
              {data.refunded && (
                <StatusBadge $status="DISABLED" style={{ marginLeft: 8 }}>
                  {rd("refunded")}
                </StatusBadge>
              )}
            </div>
            {data.fiscalError && <ErrorBox>{data.fiscalError}</ErrorBox>}
            <Grid>
              {data.regosReceiptNo && (
                <Field>
                  <FieldLabel>{rd("receiptNo")}</FieldLabel>
                  <FieldValue $mono>{data.regosReceiptNo}</FieldValue>
                </Field>
              )}
              {data.regosFiscalSign && (
                <Field>
                  <FieldLabel>{rd("fiscalSign")}</FieldLabel>
                  <FieldValue $mono>{data.regosFiscalSign}</FieldValue>
                </Field>
              )}
              {data.regosTerminalId && (
                <Field>
                  <FieldLabel>{rd("vcrTerminal")}</FieldLabel>
                  <FieldValue $mono>{data.regosTerminalId}</FieldValue>
                </Field>
              )}
              {data.regosFiscalAt && (
                <Field>
                  <FieldLabel>{rd("fiscalizedAt")}</FieldLabel>
                  <FieldValue>{formatDateTime(data.regosFiscalAt)}</FieldValue>
                </Field>
              )}
              {(data.fiscalAttempts ?? 0) > 0 && (
                <Field>
                  <FieldLabel>{rd("attempts")}</FieldLabel>
                  <FieldValue>{data.fiscalAttempts}</FieldValue>
                </Field>
              )}
            </Grid>
            {data.regosQrCodeUrl && (
              <Field>
                <FieldLabel>{rd("qrCode")}</FieldLabel>
                <QrLink
                  href={data.regosQrCodeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {data.regosQrCodeUrl}
                  <ExternalLink size={12} />
                </QrLink>
              </Field>
            )}
          </Section>

          {/* ── VCR config context ── */}
          <Section>
            <SectionTitle>{rd("vcrConfig")}</SectionTitle>
            <Grid>
              <Field>
                <FieldLabel>{rd("vcrEnabled")}</FieldLabel>
                <FieldValue>
                  {data.config.enabled ? t("common.yes") : t("common.no")}
                </FieldValue>
              </Field>
              <Field>
                <FieldLabel>URL</FieldLabel>
                <FieldValue $mono>{data.config.url}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>{rd("login")}</FieldLabel>
                <FieldValue $mono>{data.config.login}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>pos_id</FieldLabel>
                <FieldValue $mono>{data.config.posId}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>{rd("vatMode")}</FieldLabel>
                <FieldValue>
                  {data.config.nonVatPayer
                    ? rd("noVat")
                    : `${data.config.vatPercent}%`}
                </FieldValue>
              </Field>
            </Grid>
          </Section>

          {/* ── VCR payload — positions ── */}
          <Section>
            <SectionTitle>{rd("vcrPayload")}</SectionTitle>
            <Note>{rd("payloadNote")}</Note>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{rd("colName")}</Th>
                    <Th>{rd("colMxik")}</Th>
                    <Th>{rd("colPackage")}</Th>
                    <Th style={{ textAlign: "right" }}>{rd("colQty")}</Th>
                    <Th style={{ textAlign: "right" }}>{rd("colAmount")}</Th>
                    <Th style={{ textAlign: "right" }}>{rd("colVat")}</Th>
                    <Th style={{ textAlign: "right" }}>{rd("colDiscount")}</Th>
                    <Th>{rd("colMarking")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.request.positions.map((p, i) => (
                    <Tr key={i}>
                      <Td style={{ whiteSpace: "normal", minWidth: 140 }}>
                        {p.name}
                        <div style={{ opacity: 0.6 }}>
                          <Mono>{p.barcode}</Mono>
                        </div>
                      </Td>
                      <Td>
                        <Mono>{p.icps || "—"}</Mono>
                      </Td>
                      <Td>
                        <Mono>{p.package_code || "—"}</Mono>
                      </Td>
                      <Td style={{ textAlign: "right" }}>
                        {p.quantity / 1000}
                      </Td>
                      <Td style={{ textAlign: "right" }}>
                        {tiyinToSum(p.amount)}
                      </Td>
                      <Td style={{ textAlign: "right" }}>
                        {vatLabel(p.vat_value)}
                      </Td>
                      <Td style={{ textAlign: "right" }}>
                        {p.discount ? tiyinToSum(p.discount) : "—"}
                      </Td>
                      <Td style={{ whiteSpace: "normal", maxWidth: 180 }}>
                        {p.label ? (
                          <Mono style={{ wordBreak: "break-all" }}>
                            {p.label}
                          </Mono>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Grid>
              <Field>
                <FieldLabel>code</FieldLabel>
                <FieldValue $mono>{data.request.code}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>session_code</FieldLabel>
                <FieldValue $mono>
                  {data.request.session_code ?? "—"}
                </FieldValue>
              </Field>
              <Field>
                <FieldLabel>cashier_name</FieldLabel>
                <FieldValue>{data.request.cashier_name}</FieldValue>
              </Field>
              <Field>
                <FieldLabel>{rd("payments")}</FieldLabel>
                <FieldValue>
                  {data.request.payments
                    .map(
                      (pm) =>
                        `${pm.type === 1 ? t("pos.cash") : t("pos.card")}: ${tiyinToSum(pm.value)}`,
                    )
                    .join(", ")}
                </FieldValue>
              </Field>
            </Grid>
          </Section>

          {/* ── Marking codes ── */}
          <Section>
            <SectionTitle>{rd("markingCodes")}</SectionTitle>
            {data.labels.length === 0 ? (
              <Note>{rd("noMarking")}</Note>
            ) : (
              data.labels.map((l, i) => (
                <MarkingRow key={i}>
                  <FieldLabel>
                    <Mono>{l.barcode}</Mono>
                  </FieldLabel>
                  <MarkingCode onClick={() => copy(l.label, `label-${i}`)}>
                    {l.label}
                  </MarkingCode>
                </MarkingRow>
              ))
            )}
          </Section>

          {/* ── Raw JSON-RPC body ── */}
          <Section>
            <SectionHeader>
              <SectionTitle>{rd("rawBody")}</SectionTitle>
              <CopyBtn
                onClick={() =>
                  copy(JSON.stringify(data.request, null, 2), "raw")
                }
              >
                {copied === "raw" ? <Check size={13} /> : <Copy size={13} />}
                {copied === "raw" ? rd("copied") : rd("copy")}
              </CopyBtn>
            </SectionHeader>
            <Pre>{JSON.stringify(data.request, null, 2)}</Pre>
          </Section>
        </Body>
      )}
    </Modal>
  );
}
