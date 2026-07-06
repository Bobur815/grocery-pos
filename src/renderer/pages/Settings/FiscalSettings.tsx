import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Keyboard, ChevronDown, ChevronUp, Ban, Loader2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { KbToggle } from '../../components/common/SearchControls';
import { VirtualKeyboard } from '../../components/common/VirtualKeyboard';
import { useToast } from '../../context/ToastContext';
import type { FiscalConnectionResult, FiscalQueueStatus, FiscalBulkProgress } from '@shared/types';
import { translateMarkingStatus } from '../POS/markingCirculation';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
  max-width: 600px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding-left: 25px;
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
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

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Input = styled.input`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
  &:focus { outline: none; border-color: ${({ theme }) => theme.colors.primary}; }
`;

const Select = styled.select`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
`;

const Row = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const StatusLine = styled.div<{ $ok?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  font-size: 14px;
  color: ${({ theme, $ok }) => ($ok ? theme.colors.success ?? theme.colors.primary : theme.colors.error)};
`;

const Muted = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ProgressHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Spin = styled(Loader2)`
  animation: fiscal-spin 1s linear infinite;
  @keyframes fiscal-spin {
    to { transform: rotate(360deg); }
  }
`;

const BarOuter = styled.div`
  width: 100%;
  height: 8px;
  background: ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  overflow: hidden;
`;

const BarInner = styled.div<{ $pct: number; $done?: boolean }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: ${({ theme, $done }) => ($done ? theme.colors.success ?? theme.colors.primary : theme.colors.primary)};
  transition: width 0.25s ease;
`;

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const Chip = styled.div<{ $tone: 'ok' | 'error' | 'muted' | 'warn' }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  background: ${({ theme, $tone }) =>
    ($tone === 'ok' ? theme.colors.success ?? theme.colors.primary
      : $tone === 'error' || $tone === 'warn' ? theme.colors.error
      : theme.colors.textSecondary) + '18'};
  color: ${({ theme, $tone }) =>
    $tone === 'ok' ? theme.colors.success ?? theme.colors.primary
      : $tone === 'error' || $tone === 'warn' ? theme.colors.error
      : theme.colors.textSecondary};
`;

const OutList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 140px;
  overflow-y: auto;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
`;

const OutItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text};
`;

export function FiscalSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('http://127.0.0.1:22298');
  const [login, setLogin] = useState('kassa');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [vatPercent, setVatPercent] = useState('12');
  const [nonVatPayer, setNonVatPayer] = useState(false);
  const [posId, setPosId] = useState('');
  const [vcrPrintsReceipt, setVcrPrintsReceipt] = useState(false);
  const [markingCodeCheck, setMarkingCodeCheck] = useState(true);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<FiscalConnectionResult | null>(null);
  const [queue, setQueue] = useState<FiscalQueueStatus | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [progress, setProgress] = useState<FiscalBulkProgress | null>(null);
  const [outList, setOutList] = useState<{ receipt: string; status: string }[]>([]);

  // Config load state. The form must NOT show its editable defaults until the real config has
  // loaded — otherwise a transient load failure would display defaults that, if saved, would
  // clobber the stored url/login/password. Render a loading/error gate instead.
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // VirtualKeyboard — writes to whichever text field is focused.
  type TextField = 'url' | 'login' | 'password' | 'posId';
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [activeField, setActiveField] = useState<TextField | null>(null);

  const fieldSetters: Record<TextField, React.Dispatch<React.SetStateAction<string>>> = {
    url: setUrl,
    login: setLogin,
    password: setPassword,
    posId: setPosId,
  };

  const handleVirtualKey = (key: string) => {
    if (!activeField) return;
    if (key === 'ENTER') return;
    const setter = fieldSetters[activeField];
    if (key === 'BACKSPACE') {
      setter((prev) => prev.slice(0, -1));
      return;
    }
    setter((prev) => prev + key);
  };

  const loadConfig = useCallback(async () => {
    setLoadError(false);
    try {
      const cfg = await window.electronAPI.fiscal.getConfig();
      setEnabled(cfg.enabled);
      setUrl(cfg.url);
      setLogin(cfg.login);
      setHasPassword(cfg.hasPassword);
      setVatPercent(String(cfg.vatPercent));
      setNonVatPayer(cfg.nonVatPayer);
      setPosId(cfg.posId);
      setVcrPrintsReceipt(cfg.vcrPrintsReceipt);
      setMarkingCodeCheck(cfg.markingCodeCheck);
      setLoaded(true);
    } catch {
      // Don't fall back to editable defaults — surface the error and let the user retry, so a
      // transient failure can't be silently re-saved over the stored config.
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    window.electronAPI.fiscal.getStatus().then(setQueue).catch(() => {});
  }, [loadConfig]);

  // Live progress from the bulk "fiscalize old receipts" run (streamed over fiscal:bulkProgress).
  useEffect(() => {
    const off = window.electronAPI.fiscal.onBulkProgress((p) => {
      setProgress(p);
      if (p.lastDisabled) setOutList((prev) => [...prev, p.lastDisabled!]);
    });
    return off;
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const cfg = await window.electronAPI.fiscal.setConfig({
        enabled,
        url,
        login,
        vatPercent: Number(vatPercent),
        nonVatPayer,
        posId,
        vcrPrintsReceipt,
        markingCodeCheck,
        ...(password ? { password } : {}),
      });
      setHasPassword(cfg.hasPassword);
      setPassword('');
      toast.success(t('common.saved', 'Сохранено'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const refreshQueue = useCallback(() => {
    window.electronAPI.fiscal.getStatus().then(setQueue).catch(() => {});
  }, []);

  const handleFiscalizeOld = async () => {
    setProgress(null);
    setOutList([]);
    setBulkRunning(true);
    try {
      const r = await window.electronAPI.fiscal.fiscalizeOld();
      if (!r.enabled) {
        toast.error(t('fiscalSettings.disabledFirst', 'Сначала включите фискализацию'));
        return;
      }
      const summary = t('fiscalSettings.bulkDone', {
        defaultValue:
          'Готово: фискализировано {{fiscalized}}, ошибок {{failed}}, исправлено меток {{repaired}}, отключено {{disabled}}, вне оборота {{outOfCirculation}}',
        fiscalized: r.fiscalized,
        failed: r.failed,
        repaired: r.repaired,
        disabled: r.disabled,
        outOfCirculation: r.outOfCirculation,
      });
      if (r.unreachable) {
        toast.error(
          t('fiscalSettings.bulkUnreachable', 'Виртуальная касса недоступна — обработка остановлена') +
            '. ' +
            summary,
        );
      } else if (r.failed > 0) {
        toast.error(summary);
      } else {
        toast.success(summary);
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBulkRunning(false);
      refreshQueue();
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.electronAPI.fiscal.testConnection();
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, error: t('common.error') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Container>
      <Header>
        <Button variant="secondary" size="small" onClick={() => navigate('/settings')}>
          <ArrowLeft size={20} />
        </Button>
        <Title>{t('fiscalSettings.title', 'Фискализация (REGOS:VCR)')}</Title>
        {loaded && (
          <KbToggle
            type="button"
            tabIndex={-1}
            $active={keyboardOpen}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setKeyboardOpen((prev) => !prev)}
            style={{ marginLeft: 'auto' }}
          >
            <Keyboard size={18} />
            {keyboardOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </KbToggle>
        )}
      </Header>

      {!loaded ? (
        <Card>
          {loadError ? (
            <>
              <StatusLine>
                <XCircle size={16} />
                {t('fiscalSettings.loadError', 'Не удалось загрузить настройки фискализации')}
              </StatusLine>
              <ButtonRow>
                <Button variant="secondary" onClick={loadConfig}>
                  {t('common.retry', 'Повторить')}
                </Button>
              </ButtonRow>
            </>
          ) : (
            <Muted>{t('common.loading', 'Загрузка...')}</Muted>
          )}
        </Card>
      ) : (
      <Card>
        <Row>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('fiscalSettings.enabled', 'Включить фискализацию через REGOS:VCR')}
        </Row>

        <Field>
          <Label>{t('fiscalSettings.url', 'Адрес виртуальной кассы')}</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} onFocus={() => setActiveField('url')} placeholder="http://127.0.0.1:22298" />
        </Field>

        <Field>
          <Label>{t('fiscalSettings.login', 'Логин кассира')}</Label>
          <Input value={login} onChange={(e) => setLogin(e.target.value)} onFocus={() => setActiveField('login')} placeholder="cassir" />
        </Field>

        <Field>
          <Label>{t('fiscalSettings.password', 'Пароль кассира')}</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setActiveField('password')}
            placeholder={hasPassword ? '•••••••• (сохранён)' : ''}
          />
        </Field>

        <Row>
          <input
            type="checkbox"
            checked={nonVatPayer}
            onChange={(e) => setNonVatPayer(e.target.checked)}
          />
          {t('fiscalSettings.nonVatPayer', 'Организация не является плательщиком НДС (отправлять «Без НДС»)')}
        </Row>

        <Field>
          <Label>{t('fiscalSettings.vat', 'Ставка НДС, %')}</Label>
          <Select
            value={vatPercent}
            onChange={(e) => setVatPercent(e.target.value)}
            disabled={nonVatPayer}
          >
            <option value="0">0%</option>
            <option value="12">12%</option>
          </Select>
          {nonVatPayer && (
            <Muted>
              {t(
                'fiscalSettings.nonVatPayerHint',
                'Для неплательщика НДС ставка игнорируется — во все позиции отправляется «Без НДС».',
              )}
            </Muted>
          )}
        </Field>

        <Field>
          <Label>{t('fiscalSettings.posId', 'ID кассы (pos_id)')}</Label>
          <Input value={posId} onChange={(e) => setPosId(e.target.value)} onFocus={() => setActiveField('posId')} />
        </Field>

        <Row>
          <input
            type="checkbox"
            checked={vcrPrintsReceipt}
            onChange={(e) => setVcrPrintsReceipt(e.target.checked)}
          />
          {t('fiscalSettings.vcrPrintsReceipt', 'Чек печатает виртуальная касса (не печатать из POS)')}
        </Row>

        <Row>
          <input
            type="checkbox"
            checked={markingCodeCheck}
            onChange={(e) => setMarkingCodeCheck(e.target.checked)}
          />
          {t('fiscalSettings.markingCodeCheck', 'Проверять повторную продажу маркированных товаров (группа 022)')}
        </Row>

        <ButtonRow>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={handleTest} disabled={testing}>
            {testing ? t('common.processing') : t('fiscalSettings.testConnection', 'Проверить связь')}
          </Button>
        </ButtonRow>

        {testResult && (
          testResult.ok ? (
            <StatusLine $ok>
              <CheckCircle size={16} />
              {t('fiscalSettings.connected', 'Связь установлена')} — {testResult.terminalId} (applet {testResult.appletVersion})
            </StatusLine>
          ) : (
            <StatusLine>
              <XCircle size={16} />
              {testResult.error}
            </StatusLine>
          )
        )}
      </Card>
      )}

      {queue && (
        <Card>
          <Label>{t('fiscalSettings.queueStatus', 'Очередь фискализации')}</Label>
          <Muted>
            {t('fiscalSettings.fiscalized', 'Фискализировано')}: {queue.fiscalized} ·{' '}
            {t('fiscalSettings.pending', 'В ожидании')}: {queue.pending} ·{' '}
            {t('fiscalSettings.failed', 'Ошибки')}: {queue.failed}
          </Muted>
          <Muted>
            {t(
              'fiscalSettings.bulkHint',
              'Фискализирует все старые чеки с маркированными товарами (группа 022), исправляя QR-метки. Остальные старые чеки помечаются как не требующие фискализации.',
            )}
          </Muted>
          <ButtonRow>
            <Button
              variant="secondary"
              onClick={handleFiscalizeOld}
              disabled={bulkRunning || !queue.enabled}
            >
              {bulkRunning
                ? t('fiscalSettings.bulkRunning', 'Обработка чеков…')
                : t('fiscalSettings.bulkButton', 'Фискализировать все старые чеки')}
            </Button>
          </ButtonRow>

          {progress && (
            <>
              <ProgressHead>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {progress.phase !== 'done' && <Spin size={14} />}
                  {progress.phase === 'done'
                    ? t('fiscalSettings.bulkProgress.done', 'Готово')
                    : progress.phase === 'fiscalizing'
                      ? t('fiscalSettings.bulkProgress.fiscalizing', 'Фискализация…')
                      : t('fiscalSettings.bulkProgress.checking', 'Проверка маркировки…')}
                  {progress.currentReceipt && progress.phase !== 'done' ? ` #${progress.currentReceipt}` : ''}
                </span>
                <span>{progress.processed} / {progress.total}</span>
              </ProgressHead>
              <BarOuter>
                <BarInner
                  $pct={
                    progress.total
                      ? Math.round((progress.processed / progress.total) * 100)
                      : progress.phase === 'done' ? 100 : 0
                  }
                  $done={progress.phase === 'done'}
                />
              </BarOuter>
              <Chips>
                <Chip $tone="ok">
                  <CheckCircle size={12} /> {t('fiscalSettings.fiscalized', 'Фискализировано')}: {progress.fiscalized}
                </Chip>
                <Chip $tone="error">
                  <XCircle size={12} /> {t('fiscalSettings.failed', 'Ошибки')}: {progress.failed}
                </Chip>
                <Chip $tone="muted">
                  <Ban size={12} /> {t('fiscalSettings.bulkProgress.disabled', 'Отключено')}: {progress.disabled}
                </Chip>
                <Chip $tone="warn">
                  <Ban size={12} /> {t('fiscalSettings.bulkProgress.outOfCirculation', 'Вне оборота')}: {progress.outOfCirculation}
                </Chip>
              </Chips>
              {outList.length > 0 && (
                <>
                  <Label>
                    {t('fiscalSettings.bulkProgress.outOfCirculationList', 'Чеки, отключённые из-за маркировки вне оборота')}
                  </Label>
                  <OutList>
                    {outList.map((o, i) => (
                      <OutItem key={`${o.receipt}-${i}`}>
                        <Ban size={12} /> #{o.receipt} — {translateMarkingStatus(o.status, t)}
                      </OutItem>
                    ))}
                  </OutList>
                </>
              )}
            </>
          )}
        </Card>
      )}

      {keyboardOpen && (
        <VirtualKeyboard
          fixed
          onKeyPress={handleVirtualKey}
          onClose={() => setKeyboardOpen(false)}
        />
      )}
    </Container>
  );
}
