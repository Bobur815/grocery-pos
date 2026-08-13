// Staff-facing marking-code check. Scan (or paste) a DataMatrix and see what the asl-belgisi
// registry says about it, before it fails at fiscalization.
//
// Deliberately NOT backed by REGOS Ofd/CheckLabel: that endpoint was probed and answers
// isValid=true for tampered serials, garbage labels and bogus ICPS, so a green light there means
// nothing. asl-belgisi genuinely reports NOT_FOUND and out-of-circulation statuses.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, KeyRound } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { markingCheck } from '../../api/ipc-client';
import { useAuth } from '../../hooks/useAuth';

type Verdict = 'IN' | 'OUT' | 'UNKNOWN';

interface CheckResult {
  reachable: boolean;
  lookupCode?: string;
  error?: string;
  verdict: Verdict;
  gtin?: string;
  details?: {
    isValid: boolean;
    status?: string;
    extendedStatus?: string;
    gtin?: string;
    productId?: string;
    productionDate?: string;
    expirationDate?: string;
    productSeries?: string;
    packageType?: string;
    issuerName?: string;
  };
  product?: {
    id: string;
    nameUz: string;
    nameRu: string;
    barcode: string | null;
    mxik: string | null;
  };
  alreadySold?: { soldAt?: string; terminalId?: string };
}

interface ApiKeyStatus {
  configured: boolean;
  source: 'store' | 'env' | 'none';
  maskedKey?: string;
  updatedAt?: string;
  expiresAt?: string;
}

interface ApiKeyResult {
  ok: boolean;
  status?: ApiKeyStatus;
  error?: string;
}

/**
 * Error codes the main process can hand back (circulation-check.ts normalizes every failure into
 * this vocabulary). Anything outside the set falls back to a generic message — a raw HTTP status
 * is still shown underneath for support, but the cashier reads a sentence, not `HTTP_401`.
 */
const KNOWN_ERRORS = new Set([
  'NO_TOKEN',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'OFFLINE',
  'TIMEOUT',
  'REGISTRY_KEY_MISSING',
  'REGISTRY_KEY_REJECTED',
  'REGISTRY_UNREACHABLE',
  'REGISTRY_BAD_RESPONSE',
  'EMPTY_CODE',
  'EMPTY_KEY',
]);

/** A dead or missing registry key is the one failure an admin can fix right here. */
const KEY_ERRORS = new Set(['REGISTRY_KEY_MISSING', 'REGISTRY_KEY_REJECTED']);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Warn this far ahead of expiry — enough lead time to request a new 3-month key. */
const EXPIRY_WARN_DAYS = 14;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
  padding-left: 25px;
  max-width: 1100px;
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Subtitle = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

const Columns = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.lg};
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const CardTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.text};
`;

const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;

const CodeInput = styled.textarea`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-family: monospace;
  font-size: 14px;
  min-height: 96px;
  resize: vertical;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  justify-content: flex-end;
`;

const Placeholder = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  padding: ${({ theme }) => theme.spacing.md};
`;

const Badge = styled.div<{ $tone: 'ok' | 'bad' | 'muted' }>`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  align-self: flex-start;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.borderRadius};
  font-weight: 600;
  font-size: 14px;
  background: ${({ theme, $tone }) =>
    $tone === 'ok'
      ? `${theme.colors.success}22`
      : $tone === 'bad'
        ? `${theme.colors.error}22`
        : theme.colors.background};
  color: ${({ theme, $tone }) =>
    $tone === 'ok'
      ? theme.colors.success
      : $tone === 'bad'
        ? theme.colors.error
        : theme.colors.textSecondary};
`;

const Warning = styled.div`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => `${theme.colors.error}18`};
  color: ${({ theme }) => theme.colors.error};
  font-size: 13px;
`;

const Notice = styled.div<{ $tone: 'ok' | 'bad' | 'muted' }>`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.borderRadius};
  font-size: 13px;
  background: ${({ theme, $tone }) =>
    $tone === 'ok'
      ? `${theme.colors.success}18`
      : $tone === 'bad'
        ? `${theme.colors.error}18`
        : theme.colors.background};
  color: ${({ theme, $tone }) =>
    $tone === 'ok'
      ? theme.colors.success
      : $tone === 'bad'
        ? theme.colors.error
        : theme.colors.textSecondary};
`;

const Reason = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  padding: 0 ${({ theme }) => theme.spacing.md};
`;

const Hint = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 0 ${({ theme }) => theme.spacing.md};
`;

const KeyInput = styled.input`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-family: monospace;
  font-size: 14px;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  padding-top: ${({ theme }) => theme.spacing.sm};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const Cell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const CellLabel = styled.span`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const CellValue = styled.span`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  word-break: break-word;
`;

const Mono = styled(CellValue)`
  font-family: monospace;
  font-size: 12px;
`;

/** Registry dates arrive as ISO strings; show them in the terminal's locale, fall back to raw. */
function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

/** Days left before an expiry timestamp; negative once it has passed. */
function daysUntil(iso?: string): number | undefined {
  if (!iso) return undefined;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return undefined;
  return Math.ceil((ts - Date.now()) / DAY_MS);
}

export const MarkingCheckPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { isAdmin } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [keyStatusError, setKeyStatusError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  /** Turn an error code into a sentence; unknown codes degrade to the generic message. */
  const errorText = (errCode?: string): string =>
    errCode && KNOWN_ERRORS.has(errCode)
      ? t(`markingCheck.errors.${errCode}`)
      : t('markingCheck.errors.generic');

  // The common case is a cashier walking up with a scanner in hand.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const loadKeyStatus = useCallback(async () => {
    const res = (await markingCheck.apiKeyStatus()) as ApiKeyResult | undefined;
    if (res?.ok && res.status) {
      setKeyStatus(res.status);
      setKeyStatusError(null);
    } else {
      setKeyStatus(null);
      setKeyStatusError(res?.error ?? 'REQUEST_FAILED');
    }
  }, []);

  // Only admins can rotate the key, so only they need its state.
  useEffect(() => {
    if (isAdmin) void loadKeyStatus();
  }, [isAdmin, loadKeyStatus]);

  const runCheck = async () => {
    const raw = code.trim();
    if (!raw || loading) return;
    setLoading(true);
    try {
      const res = (await markingCheck.verify(raw)) as CheckResult | undefined;
      setResult(res ?? null);
    } catch {
      setResult({ reachable: false, verdict: 'UNKNOWN', error: 'REQUEST_FAILED' });
    } finally {
      setLoading(false);
    }
  };

  const saveKey = async () => {
    const value = newKey.trim();
    if (!value || savingKey) return;
    setSavingKey(true);
    setKeyError(null);
    setKeySaved(false);
    try {
      const res = (await markingCheck.setApiKey(value)) as ApiKeyResult | undefined;
      if (res?.ok) {
        setKeySaved(true);
        setNewKey('');
        if (res.status) setKeyStatus(res.status);
        // The key that just failed a check is now live — re-run so the screen isn't stale.
        if (code.trim()) void runCheck();
      } else {
        setKeyError(res?.error ?? 'REQUEST_FAILED');
      }
    } catch {
      setKeyError('REQUEST_FAILED');
    } finally {
      setSavingKey(false);
    }
  };

  // A hardware scanner ends its payload with Enter — treat that as "check", but keep
  // Shift+Enter available for pasting a multi-line code by hand.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void runCheck();
    }
  };

  const reset = () => {
    setCode('');
    setResult(null);
    inputRef.current?.focus();
  };

  const renderVerdict = (r: CheckResult) => {
    if (!r.reachable) {
      const isKeyProblem = !!r.error && KEY_ERRORS.has(r.error);
      return (
        <>
          <Badge $tone="muted">
            <ShieldQuestion size={17} />
            {t('markingCheck.unreachable')}
          </Badge>
          <Reason>{errorText(r.error)}</Reason>
          <Hint>
            {isKeyProblem
              ? isAdmin
                ? t('markingCheck.errorHintAdmin')
                : t('markingCheck.errorHintCashier')
              : t('markingCheck.unreachableHint')}
          </Hint>
        </>
      );
    }
    if (r.verdict === 'OUT') {
      return (
        <Badge $tone="bad">
          <ShieldAlert size={17} />
          {r.details?.isValid === false
            ? t('markingCheck.notFound')
            : t('markingCheck.outOfCirculation')}
        </Badge>
      );
    }
    if (r.verdict === 'UNKNOWN') {
      return (
        <Badge $tone="muted">
          <ShieldQuestion size={17} />
          {t('markingCheck.statusUnknown')}
        </Badge>
      );
    }
    return (
      <Badge $tone="ok">
        <ShieldCheck size={17} />
        {t('markingCheck.valid')}
      </Badge>
    );
  };

  /** Current key, where it came from, and how close it is to its 3-month expiry. */
  const renderKeyStatus = (s: ApiKeyStatus) => {
    if (!s.configured) return <Notice $tone="bad">{t('markingCheck.key.notConfigured')}</Notice>;

    const left = daysUntil(s.expiresAt);
    const tone = left === undefined ? 'muted' : left <= 0 ? 'bad' : left <= EXPIRY_WARN_DAYS ? 'bad' : 'ok';
    const source =
      s.source === 'store' ? t('markingCheck.key.sourceStore') : t('markingCheck.key.sourceEnv');

    return (
      <>
        <Notice $tone={tone}>
          {t('markingCheck.key.current')}: <strong>{s.maskedKey}</strong> ({source})
          {s.expiresAt
            ? ` · ${t('markingCheck.key.expires')} ${formatDate(s.expiresAt)}`
            : ` · ${t('markingCheck.key.unknownExpiry')}`}
        </Notice>
        {left !== undefined && left <= 0 && <Warning>{t('markingCheck.key.expired')}</Warning>}
        {left !== undefined && left > 0 && left <= EXPIRY_WARN_DAYS && (
          <Warning>{t('markingCheck.key.expiringSoon', { days: left })}</Warning>
        )}
      </>
    );
  };

  const cells: Array<{ label: string; value?: string; mono?: boolean }> = result?.details
    ? [
        { label: t('markingCheck.status'), value: result.details.status },
        { label: t('markingCheck.extendedStatus'), value: result.details.extendedStatus },
        { label: t('markingCheck.gtin'), value: result.details.gtin ?? result.gtin },
        { label: t('markingCheck.packageType'), value: result.details.packageType },
        { label: t('markingCheck.productionDate'), value: formatDate(result.details.productionDate) },
        { label: t('markingCheck.expiryDate'), value: formatDate(result.details.expirationDate) },
        { label: t('markingCheck.series'), value: result.details.productSeries },
        { label: t('markingCheck.issuer'), value: result.details.issuerName },
      ]
    : [];

  return (
    <Container>
      <div>
        <Title>{t('markingCheck.title')}</Title>
        <Subtitle>{t('markingCheck.subtitle')}</Subtitle>
      </div>

      <Columns>
        <Card>
          <CardTitle>{t('markingCheck.dataTitle')}</CardTitle>
          <Label>{t('markingCheck.codeLabel')}</Label>
          <CodeInput
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('markingCheck.codePlaceholder')}
            spellCheck={false}
            autoComplete="off"
          />
          <ButtonRow>
            <Button variant="secondary" onClick={reset} disabled={loading && !code}>
              {t('common.clear')}
            </Button>
            <Button onClick={runCheck} disabled={!code.trim() || loading}>
              {loading ? <Loader2 size={16} /> : <ShieldCheck size={16} />}
              {loading ? t('markingCheck.checking') : t('markingCheck.check')}
            </Button>
          </ButtonRow>
        </Card>

        <Card>
          <CardTitle>{t('markingCheck.resultTitle')}</CardTitle>
          {!result ? (
            <Placeholder>{t('markingCheck.resultPlaceholder')}</Placeholder>
          ) : (
            <>
              {renderVerdict(result)}

              {result.alreadySold && (
                <Warning>
                  {t('markingCheck.alreadySold', {
                    date: formatDate(result.alreadySold.soldAt) ?? '—',
                    terminal: result.alreadySold.terminalId ?? '—',
                  })}
                </Warning>
              )}

              {result.product && (
                <Cell>
                  <CellLabel>{t('markingCheck.localProduct')}</CellLabel>
                  <CellValue>
                    {i18n.language === 'uz'
                      ? result.product.nameUz || result.product.nameRu
                      : result.product.nameRu || result.product.nameUz}
                  </CellValue>
                </Cell>
              )}

              {cells.some((c) => c.value) && (
                <Grid>
                  {cells
                    .filter((c) => c.value)
                    .map((c) => (
                      <Cell key={c.label}>
                        <CellLabel>{c.label}</CellLabel>
                        <CellValue>{c.value}</CellValue>
                      </Cell>
                    ))}
                </Grid>
              )}

              {result.lookupCode && (
                <Cell>
                  <CellLabel>{t('markingCheck.lookupCode')}</CellLabel>
                  <Mono>{result.lookupCode}</Mono>
                </Cell>
              )}

              {!result.reachable && result.error && (
                <Cell>
                  <CellLabel>{t('markingCheck.errorLabel')}</CellLabel>
                  <Mono>{result.error}</Mono>
                </Cell>
              )}
            </>
          )}
        </Card>
      </Columns>

      {isAdmin && (
        <Card>
          <CardTitle>
            <KeyRound size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            {t('markingCheck.key.title')}
          </CardTitle>

          {keyStatusError ? (
            <Notice $tone="muted">{t('markingCheck.key.statusError')}: {errorText(keyStatusError)}</Notice>
          ) : (
            keyStatus && renderKeyStatus(keyStatus)
          )}

          <Subtitle>{t('markingCheck.key.hint')}</Subtitle>
          <Label>{t('markingCheck.key.label')}</Label>
          <KeyInput
            type="text"
            value={newKey}
            onChange={(e) => {
              setNewKey(e.target.value);
              setKeySaved(false);
              setKeyError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveKey();
              }
            }}
            placeholder={t('markingCheck.key.placeholder')}
            spellCheck={false}
            autoComplete="off"
          />

          {keySaved && <Notice $tone="ok">{t('markingCheck.key.saved')}</Notice>}
          {keyError && <Notice $tone="bad">{errorText(keyError)}</Notice>}

          <ButtonRow>
            <Button onClick={saveKey} disabled={!newKey.trim() || savingKey}>
              {savingKey ? <Loader2 size={16} /> : <KeyRound size={16} />}
              {savingKey ? t('markingCheck.key.saving') : t('markingCheck.key.save')}
            </Button>
          </ButtonRow>
        </Card>
      )}
    </Container>
  );
};

export default MarkingCheckPage;
