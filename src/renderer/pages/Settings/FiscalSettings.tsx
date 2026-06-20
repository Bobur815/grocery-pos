import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Keyboard, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { KbToggle } from '../../components/common/SearchControls';
import { VirtualKeyboard } from '../../components/common/VirtualKeyboard';
import { useToast } from '../../context/ToastContext';
import type { FiscalConnectionResult, FiscalQueueStatus } from '@shared/types';

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

export function FiscalSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('http://127.0.0.1:22298');
  const [login, setLogin] = useState('cassir');
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
