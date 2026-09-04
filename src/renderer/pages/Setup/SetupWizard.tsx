import React, { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import styled, { keyframes } from "styled-components";
import { CheckCircle, Store, KeyRound, ShieldCheck, Delete, Eraser, ChevronRight } from "lucide-react";
import { VirtualKeyboard } from "../../components/common/VirtualKeyboard";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { UzbekPhoneInput } from "../../components/common/UzbekPhoneInput";
import { isUzPhoneComplete } from "@shared/utils/phone";

// ─── Styled Components ─────────────────────────────────────────────────────

const Wrapper = styled.div`
  display: flex;
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.background};
  align-items: stretch;
`;

const Sidebar = styled.div`
  width: 240px;
  background: ${({ theme }) => theme.colors.primary};
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
`;

const SidebarLogo = styled.h1`
  color: #fff;
  font-size: 22px;
  font-weight: 800;
  margin: 0 0 8px;
`;

const SidebarSubtitle = styled.p`
  color: rgba(255,255,255,0.7);
  font-size: 13px;
  margin: 0 0 40px;
`;

const StepList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
`;

const LangSwitcher = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 32px;
`;

const LangBtn = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 7px 0;
  border-radius: 6px;
  border: 1.5px solid ${({ $active }) => $active ? '#fff' : 'rgba(255,255,255,0.3)'};
  background: ${({ $active }) => $active ? '#fff' : 'transparent'};
  color: ${({ $active, theme }) => $active ? theme.colors.primary : 'rgba(255,255,255,0.75)'};
  font-size: 13px;
  font-weight: ${({ $active }) => $active ? 700 : 400};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: #fff;
    color: ${({ $active, theme }) => $active ? theme.colors.primary : '#fff'};
  }
`;

const StepItem = styled.div<{ $active: boolean; $done: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: ${({ $active, $done }) =>
    $active ? 'rgba(255,255,255,0.2)' : $done ? 'rgba(255,255,255,0.08)' : 'transparent'};
  transition: background 0.2s;
`;

const StepNumber = styled.div<{ $active: boolean; $done: boolean }>`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
  background: ${({ $active, $done }) =>
    $done ? 'rgba(255,255,255,0.9)' : $active ? '#fff' : 'rgba(255,255,255,0.2)'};
  color: ${({ $active, $done, theme }) =>
    $active || $done ? theme.colors.primary : 'rgba(255,255,255,0.6)'};
`;

const StepLabel = styled.span<{ $active: boolean; $done: boolean }>`
  color: ${({ $active, $done }) =>
    $active ? '#fff' : $done ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)'};
  font-size: 14px;
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
`;

const Content = styled.div<{ $kbOpen?: boolean }>`
  flex: 1;
  padding: 40px 48px ${({ $kbOpen }) => ($kbOpen ? '360px' : '40px')};
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const StepHeader = styled.div`
  margin-bottom: 22px;
`;

const StepTitle = styled.h2`
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const StepSubtitle = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 15px;
`;

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 480px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
`;

const ErrorMsg = styled.div`
  color: ${({ theme }) => theme.colors.error};
  background: ${({ theme }) => theme.colors.error}18;
  border: 1px solid ${({ theme }) => theme.colors.error}40;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 14px;
`;

const FieldHint = styled.div<{ $error?: boolean }>`
  font-size: 12px;
  margin-top: -10px;
  color: ${({ theme, $error }) => $error ? theme.colors.error : theme.colors.textSecondary};
`;

const Actions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 8px;
`;

const SkipLink = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  align-self: center;

  &:hover { color: ${({ theme }) => theme.colors.text}; }
`;

const LoadingOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => theme.colors.surface}cc;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.primary};
  z-index: 999;
`;

// PIN pad styles
const PinSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  max-width: 340px;
`;

const PinSubtitleSmall = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  margin: 0 0 20px;
  text-align: center;
`;

const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
`;

const DotsRow = styled.div<{ $shake?: boolean }>`
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 24px;
  animation: ${({ $shake }) => $shake ? shake : 'none'} 0.4s ease;
`;

const PinDot = styled.div<{ $filled: boolean; $error?: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${({ theme, $error }) => $error ? theme.colors.error : theme.colors.primary};
  background: ${({ theme, $filled, $error }) =>
    $filled ? ($error ? theme.colors.error : theme.colors.primary) : 'transparent'};
  transition: all 0.2s;
`;

const PinPad = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 280px;
  margin: 0 auto 24px;
`;

const PinButton = styled.button<{ $variant?: 'clear' }>`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 22px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: ${({ theme }) => theme.colors.primary}15;
    border-color: ${({ theme }) => theme.colors.primary};
  }

  &:active {
    transform: scale(0.95);
    background: ${({ theme }) => theme.colors.primary}30;
  }

  ${({ $variant, theme }) => $variant === 'clear' && `
    color: ${theme.colors.error};
    border-color: ${theme.colors.error}50;
    &:hover { background: ${theme.colors.error}15; border-color: ${theme.colors.error}; }
  `}
`;

const PinStepIndicator = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 20px;
`;

const PinStepDot = styled.div<{ $active: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme, $active }) => $active ? theme.colors.primary : theme.colors.border};
`;

const PinErrorMsg = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 13px;
  min-height: 18px;
  text-align: center;
  margin-bottom: 8px;
`;

const PinStepTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  color: ${({ theme }) => theme.colors.text};
`;

// ─── Types ────────────────────────────────────────────────────────────────

type WizardStep = 'login' | 'storeInfo' | 'password' | 'pin';

interface WizardData {
  phone: string;
  password: string;
  storeId: string;
  token: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeStir: string;
  taxRate: string;
  syncInterval: string;
  terminalId: string;
  // Learned from the server during activation and cached locally, so an OFFLINE_ONLY terminal
  // never has to reach the internet again.
  mode: string;
  posAdminLocked: boolean;
}

const STEPS: WizardStep[] = ['login', 'storeInfo', 'password', 'pin'];

const STEP_ICONS: Record<WizardStep, React.ReactNode> = {
  login: <KeyRound size={14} />,
  storeInfo: <Store size={14} />,
  password: <ShieldCheck size={14} />,
  pin: <ShieldCheck size={14} />,
};

// ─── Main Component ────────────────────────────────────────────────────────

export function SetupWizard() {
  const { t } = useTranslation();
  const [lang, setLang] = useState(localStorage.getItem('language') || 'ru');

  const handleLangChange = (l: string) => {
    setLang(l);
    localStorage.setItem('language', l);
    i18n.changeLanguage(l);
  };

  const [currentStep, setCurrentStep] = useState<WizardStep>('login');
  const [data, setData] = useState<WizardData>({
    phone: '',
    password: '',
    storeId: '',
    token: '',
    storeName: '',
    storeAddress: '',
    storePhone: '',
    storeStir: '',
    taxRate: '0',
    syncInterval: '5',
    terminalId: 'T1',
    // Unrestricted until the server says otherwise — a failed prefill must never lock a terminal.
    mode: 'ONLINE',
    posAdminLocked: false,
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [existingTerminalIds, setExistingTerminalIds] = useState<string[]>([]);

  const stepIndex = STEPS.indexOf(currentStep);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const suggestTerminalId = (existing: string[]): string => {
    const set = new Set(existing.map((s) => s.toUpperCase()));
    let n = 1;
    while (set.has(`T${n}`)) n++;
    return `T${n}`;
  };

  const isTerminalIdTaken = (id: string): boolean =>
    existingTerminalIds.some((e) => e.toLowerCase() === id.trim().toLowerCase());

  // ── Step 1: Login ────────────────────────────────────────────────────────

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isUzPhoneComplete(data.phone) || !data.password || !data.storeId.trim()) {
      setError(t('setup.errors.required_fields'));
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const result = await window.electronAPI.setup.authenticate({
        phone: '998' + data.phone,
        password: data.password,
        storeId: data.storeId.trim(),
      });

      // Pre-fill store info from server (best-effort)
      let prefill: Partial<WizardData> = {};
      try {
        const config = await window.electronAPI.config.getLocalConfig();
        const vpsApiUrl = config?.apiUrl || 'https://pos.bobur-dev.uz/api';
        const res = await fetch(`${vpsApiUrl}/stores/${data.storeId.trim()}`, {
          headers: { Authorization: `Bearer ${result.token}` },
        });
        if (res.ok) {
          const store = await res.json();
          const settings = store.settings ? JSON.parse(store.settings) : {};
          prefill = {
            storeName: store.name || '',
            storeAddress: store.address || '',
            storePhone: store.phone || '',
            taxRate: settings.taxRate != null ? String(settings.taxRate) : '0',
            // This is the activation step: the mode is cached now and never needs the net again.
            mode: store.mode === 'OFFLINE_ONLY' ? 'OFFLINE_ONLY' : 'ONLINE',
            posAdminLocked: store.posAdminLocked === true,
          };
        }
      } catch {
        // Non-fatal — proceed with empty prefill
      }

      // Fetch existing terminal IDs to check uniqueness
      let ids: string[] = [];
      try {
        const config = await window.electronAPI.config.getLocalConfig();
        const vpsApiUrl = config?.apiUrl || 'https://pos.bobur-dev.uz/api';
        const res = await fetch(`${vpsApiUrl}/terminals/status`, {
          headers: { Authorization: `Bearer ${result.token}` },
        });
        if (res.ok) {
          const statuses = await res.json() as Array<{ terminalId: string }>;
          ids = statuses.map((s) => s.terminalId);
        }
      } catch {
        // Non-fatal — proceed without uniqueness check
      }
      setExistingTerminalIds(ids);
      const suggestedId = suggestTerminalId(ids);

      setData(prev => ({
        ...prev,
        ...prefill,
        token: result.token,
        storePhone: prefill.storePhone || ('998' + data.phone),
        terminalId: suggestedId,
      }));
      setCurrentStep('storeInfo');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'setup.errors.login_failed';
      setError(t(msg, { defaultValue: t('setup.errors.login_failed') }));
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 2: Store Info ───────────────────────────────────────────────────

  const handleStoreInfo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!data.storeName.trim() || !data.storeAddress.trim() || !data.storePhone.trim() || !data.storeStir.trim()) {
      setError(t('setup.errors.required_fields'));
      return;
    }
    setError('');
    setCurrentStep('password');
  };

  // ── Step 3: Password Change ──────────────────────────────────────────────

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || !confirmPassword) {
      setError(t('setup.errors.required_fields'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('setup.password.mismatch'));
      return;
    }
    if (newPassword.length < 6) {
      setError(t('setup.password.tooShort'));
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const config = await window.electronAPI.config.getLocalConfig();
      const vpsApiUrl = config?.apiUrl || 'https://pos.bobur-dev.uz/api';
      await fetch(`${vpsApiUrl}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
        body: JSON.stringify({ currentPassword: data.password, newPassword }),
      });
    } catch {
      // Non-fatal — proceed even if password change fails
    } finally {
      setIsLoading(false);
      setCurrentStep('pin');
    }
  };

  // ── Finish ───────────────────────────────────────────────────────────────

  const handleFinish = async (savedPin?: string) => {
    setCompleting(true);
    try {
      await window.electronAPI.setup.complete({
        storeId: data.storeId.trim(),
        terminalId: data.terminalId.trim() || 'T1',
        storeName: data.storeName.trim(),
        storeAddress: data.storeAddress.trim(),
        storePhone: data.storePhone.trim(),
        storeStir: data.storeStir.trim(),
        taxRate: data.taxRate || '0',
        syncInterval: data.syncInterval || '5',
        token: data.token,
        pin: savedPin,
        mode: data.mode,
        posAdminLocked: data.posAdminLocked,
      });
      await window.electronAPI.setup.launchApp();
    } catch (e) {
      setCompleting(false);
      const msg = e instanceof Error ? e.message : 'setup.errors.login_failed';
      setError(t(msg, { defaultValue: t('setup.errors.login_failed') }));
    }
  };

  // ── Step 4: PIN Setup ────────────────────────────────────────────────────

  const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [shakePins, setShakePins] = useState(false);

  // ── Virtual Keyboard ─────────────────────────────────────────────────────
  const [activeField, setActiveField] = useState<string | null>(null);

  const NUMBER_ONLY_FIELDS = new Set(['phone', 'taxRate', 'syncInterval']);

  const handleVirtualKey = useCallback((key: string) => {
    if (!activeField) return;
    if (key === 'ENTER') { setActiveField(null); return; }

    if (activeField === 'phone') {
      if (key === 'BACKSPACE') setData(p => ({ ...p, phone: p.phone.slice(0, -1) }));
      else if (/^\d$/.test(key) && data.phone.length < 9) setData(p => ({ ...p, phone: p.phone + key }));
      return;
    }
    if (activeField === 'newPassword') {
      if (key === 'BACKSPACE') setNewPassword(p => p.slice(0, -1));
      else setNewPassword(p => p + key);
      return;
    }
    if (activeField === 'confirmPassword') {
      if (key === 'BACKSPACE') setConfirmPassword(p => p.slice(0, -1));
      else setConfirmPassword(p => p + key);
      return;
    }
    const field = activeField as keyof WizardData;
    if (key === 'BACKSPACE') setData(p => ({ ...p, [field]: String(p[field]).slice(0, -1) }));
    else setData(p => ({ ...p, [field]: String(p[field]) + key }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeField, data.phone.length]);

  const currentPin = pinStep === 'enter' ? pin : confirmPin;
  const setCurrentPin = pinStep === 'enter' ? setPin : setConfirmPin;

  const triggerShake = () => {
    setShakePins(true);
    setTimeout(() => setShakePins(false), 450);
  };

  const handlePinNumber = useCallback((num: string) => {
    if (currentPin.length >= 4) return;
    setPinError('');
    const next = currentPin + num;
    setCurrentPin(next);
    if (next.length === 4) {
      if (pinStep === 'enter') {
        setTimeout(() => setPinStep('confirm'), 200);
      } else {
        if (next !== pin) {
          triggerShake();
          setTimeout(() => {
            setConfirmPin('');
            setPinError(t('auth.errors.pin_mismatch'));
          }, 420);
        } else {
          handleFinish(next);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPin, pin, pinStep, setCurrentPin]);

  const handlePinBackspace = useCallback(() => {
    setPinError('');
    setCurrentPin(prev => prev.slice(0, -1));
  }, [setCurrentPin]);

  const handlePinClear = useCallback(() => {
    setPinError('');
    if (pinStep === 'confirm') {
      setPinStep('enter');
      setPin('');
      setConfirmPin('');
    } else {
      setPin('');
    }
  }, [pinStep]);

  useEffect(() => {
    if (currentStep !== 'pin') return;
    const handler = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); handlePinNumber(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); handlePinBackspace(); }
      else if (e.key === 'Escape') { e.preventDefault(); handlePinClear(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentStep, handlePinNumber, handlePinBackspace, handlePinClear]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Wrapper>
      {/* Sidebar */}
      <Sidebar>
        <SidebarLogo>POSGRO</SidebarLogo>
        <SidebarSubtitle>{t('setup.subtitle')}</SidebarSubtitle>
        <StepList>
          {STEPS.map((step, i) => {
            const isDone = i < stepIndex;
            const isActive = i === stepIndex;
            return (
              <StepItem key={step} $active={isActive} $done={isDone}>
                <StepNumber $active={isActive} $done={isDone}>
                  {isDone ? <CheckCircle size={14} /> : STEP_ICONS[step]}
                </StepNumber>
                <StepLabel $active={isActive} $done={isDone}>
                  {t(`setup.steps.${step}`)}
                </StepLabel>
              </StepItem>
            );
          })}
        </StepList>
        <LangSwitcher>
          <LangBtn $active={lang === 'uz'} onClick={() => handleLangChange('uz')}>O'zbekcha</LangBtn>
          <LangBtn $active={lang === 'ru'} onClick={() => handleLangChange('ru')}>Русский</LangBtn>
        </LangSwitcher>
      </Sidebar>

      {/* Main content */}
      <Content $kbOpen={activeField !== null}>
        {currentStep === 'login' && (
          <>
            <StepHeader>
              <StepTitle>{t('setup.login.title')}</StepTitle>
              <StepSubtitle>{t('setup.login.subtitle')}</StepSubtitle>
            </StepHeader>
            <Form as="form" onSubmit={handleLogin}>
              <UzbekPhoneInput
                label={t('setup.login.phone')}
                valueDigits={data.phone}
                onDigitsChange={(v) => setData(prev => ({ ...prev, phone: v }))}
                onFocus={() => setActiveField('phone')}
                autoFocus
              />
              <Input
                label={t('setup.login.password')}
                type="password"
                value={data.password}
                onChange={(e) => setData(prev => ({ ...prev, password: e.target.value }))}
                onFocus={() => setActiveField('password')}
                required
              />
              <Input
                label={t('setup.login.storeId')}
                value={data.storeId}
                onChange={(e) => setData(prev => ({ ...prev, storeId: e.target.value }))}
                onFocus={() => setActiveField('storeId')}
                placeholder={t('setup.login.storeIdPlaceholder')}
                required
              />
              {error && <ErrorMsg>{error}</ErrorMsg>}
              <Actions>
                <Button
                  type="submit"
                  disabled={isLoading || !isUzPhoneComplete(data.phone) || !data.password || !data.storeId.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {isLoading ? t('setup.login.loading') : t('setup.login.submit')}
                  {!isLoading && <ChevronRight size={16} />}
                </Button>
              </Actions>
            </Form>
          </>
        )}

        {currentStep === 'storeInfo' && (
          <>
            <StepHeader>
              <StepTitle>{t('setup.storeInfo.title')}</StepTitle>
              <StepSubtitle>{t('setup.storeInfo.subtitle')}</StepSubtitle>
            </StepHeader>
            <Form as="form" onSubmit={handleStoreInfo}>
              <Input
                label={`${t('setup.storeInfo.storeName')} *`}
                value={data.storeName}
                onChange={(e) => setData(prev => ({ ...prev, storeName: e.target.value }))}
                onFocus={() => setActiveField('storeName')}
                required
              />
              <Input
                label={`${t('setup.storeInfo.storeAddress')} *`}
                value={data.storeAddress}
                onChange={(e) => setData(prev => ({ ...prev, storeAddress: e.target.value }))}
                onFocus={() => setActiveField('storeAddress')}
                required
              />
              <Row>
                <Input
                  label={`${t('setup.storeInfo.storePhone')} *`}
                  value={data.storePhone}
                  onChange={(e) => setData(prev => ({ ...prev, storePhone: e.target.value }))}
                  onFocus={() => setActiveField('storePhone')}
                  required
                />
                <Input
                  label={`${t('setup.storeInfo.storeStir')} *`}
                  value={data.storeStir}
                  onChange={(e) => setData(prev => ({ ...prev, storeStir: e.target.value }))}
                  onFocus={() => setActiveField('storeStir')}
                  required
                />
              </Row>
              <Row>
                <Input
                  label={t('setup.storeInfo.taxRate')}
                  type="number"
                  step="0.01"
                  value={data.taxRate}
                  onChange={(e) => setData(prev => ({ ...prev, taxRate: e.target.value }))}
                  onFocus={() => setActiveField('taxRate')}
                />
                <Input
                  label={t('setup.storeInfo.syncInterval')}
                  type="number"
                  value={data.syncInterval}
                  onChange={(e) => setData(prev => ({ ...prev, syncInterval: e.target.value }))}
                  onFocus={() => setActiveField('syncInterval')}
                />
              </Row>
              <Input
                label={t('setup.storeInfo.terminalId')}
                value={data.terminalId}
                onChange={(e) => setData(prev => ({ ...prev, terminalId: e.target.value }))}
                onFocus={() => setActiveField('terminalId')}
                placeholder="T1"
              />
              {isTerminalIdTaken(data.terminalId) ? (
                <FieldHint $error>
                  {t('setup.storeInfo.terminalIdTaken', { id: data.terminalId, suggestion: suggestTerminalId(existingTerminalIds) })}
                </FieldHint>
              ) : existingTerminalIds.length > 0 ? (
                <FieldHint>
                  {t('setup.storeInfo.terminalIdUsed')}: {existingTerminalIds.join(', ')}
                </FieldHint>
              ) : (
                <FieldHint>{t('setup.storeInfo.terminalIdHint')}</FieldHint>
              )}
              {error && <ErrorMsg>{error}</ErrorMsg>}
              <Actions>
                <Button
                  type="submit"
                  disabled={!data.storeName.trim() || !data.storeAddress.trim() || !data.storePhone.trim() || !data.storeStir.trim() || isTerminalIdTaken(data.terminalId)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {t('setup.storeInfo.next')}
                  <ChevronRight size={16} />
                </Button>
              </Actions>
            </Form>
          </>
        )}

        {currentStep === 'password' && (
          <>
            <StepHeader>
              <StepTitle>{t('setup.password.title')}</StepTitle>
              <StepSubtitle>{t('setup.password.subtitle')}</StepSubtitle>
            </StepHeader>
            <Form as="form" onSubmit={handlePasswordChange}>
              <Input
                label={t('setup.password.newPassword')}
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(''); }}
                onFocus={() => setActiveField('newPassword')}
              />
              <Input
                label={t('setup.password.confirmPassword')}
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                onFocus={() => setActiveField('confirmPassword')}
              />
              {error && <ErrorMsg>{error}</ErrorMsg>}
              <Actions>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? t('setup.password.loading') : t('setup.password.submit')}
                </Button>
                <SkipLink type="button" onClick={() => { setError(''); setCurrentStep('pin'); }}>
                  {t('setup.password.skip')}
                </SkipLink>
              </Actions>
            </Form>
          </>
        )}

        {currentStep === 'pin' && (
          <>
            <StepHeader>
              <StepTitle>{t('setup.pin.title')}</StepTitle>
            </StepHeader>
            <PinSection>
              <PinStepTitle>
                {pinStep === 'enter' ? t('auth.setupPinSubtitle') : t('auth.confirmPinSubtitle')}
              </PinStepTitle>
              <PinSubtitleSmall>
                {t('setup.pin.subtitle')}
              </PinSubtitleSmall>
              <PinStepIndicator>
                <PinStepDot $active={pinStep === 'enter'} />
                <PinStepDot $active={pinStep === 'confirm'} />
              </PinStepIndicator>
              <DotsRow $shake={shakePins}>
                {[0, 1, 2, 3].map((i) => (
                  <PinDot key={i} $filled={currentPin.length > i} $error={!!pinError} />
                ))}
              </DotsRow>
              <PinErrorMsg>{pinError}</PinErrorMsg>
              <PinPad>
                {['1','2','3','4','5','6','7','8','9'].map(num => (
                  <PinButton key={num} onClick={() => handlePinNumber(num)}>{num}</PinButton>
                ))}
                <PinButton $variant="clear" onClick={handlePinClear}><Eraser size={26} /></PinButton>
                <PinButton onClick={() => handlePinNumber('0')}>0</PinButton>
                <PinButton onClick={handlePinBackspace}><Delete size={26} /></PinButton>
              </PinPad>
              {error && <ErrorMsg>{error}</ErrorMsg>}
              <SkipLink onClick={() => handleFinish(undefined)}>
                {t('setup.pin.skip')}
              </SkipLink>
            </PinSection>
          </>
        )}
      </Content>

      {activeField !== null && (
        <VirtualKeyboard
          fixed
          zIndex={500}
          numbersOnly={NUMBER_ONLY_FIELDS.has(activeField)}
          onKeyPress={handleVirtualKey}
          onClose={() => setActiveField(null)}
        />
      )}

      {completing && (
        <LoadingOverlay>
          <div>{t('setup.complete.loading')}</div>
        </LoadingOverlay>
      )}
    </Wrapper>
  );
}
