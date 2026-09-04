import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useAuthStore } from "../../store/auth-store";
import { POSGROIcon } from "../../branding";
import { useTheme } from "../../theme/ThemeProvider";
import { ChevronDown, ChevronUp, Delete, Eraser, Keyboard } from "lucide-react";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { UzbekPhoneInput } from "@renderer/components/common/UzbekPhoneInput";
import { VirtualKeyboard } from "@renderer/components/common/VirtualKeyboard";
import { isUzPhoneComplete } from "@shared/utils/phone";
import { TerminalAccessBar } from "./TerminalAccessBar";

type LoginMode = "pin" | "phone";

const SAVED_KEY = "login_saved_pos";

const Container = styled.div`
  display: flex;
  min-height: 100vh;
  background-color: ${({ theme }) => theme.colors.background};
`;

const LeftPanel = styled.div`
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: ${({ theme }) => theme.spacing.xl};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const RightPanel = styled.div<{ $imageUrl?: string }>`
  flex: 1;
  position: relative;
  overflow: hidden;
  background: ${({ $imageUrl }) =>
    $imageUrl
      ? `url(${JSON.stringify($imageUrl)}) center / cover no-repeat`
      : "linear-gradient(135deg, #1976d2 0%, #dc004e 100%)"};
  display: flex;
  align-items: flex-end;

  @media (max-width: 768px) {
    display: none;
  }
`;

const RightOverlay = styled.div`
  width: 100%;
  padding: 32px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, transparent 100%);
`;

const RightTitle = styled.h2`
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
`;

const RightSubtitle = styled.p`
  margin: 0;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.85);
`;

const LoginCard = styled.div<{ $kbOpen?: boolean }>`
  width: 100%;
  max-width: 400px;
  text-align: center;
  margin-top: -60px;
  transform: translateY(${({ $kbOpen }) => ($kbOpen ? "-60px" : "0")});
  transition: transform 0.3s ease;
`;

const LogoBrand = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const BrandName = styled.span`
  font-size: 26px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
  letter-spacing: 1px;
`;

const Subtitle = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.xl};
  font-size: 20px;
`;

const PinDisplay = styled.div`
  display: flex;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.xl};
`;

const PinDot = styled.div<{ $filled: boolean }>`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.primary};
  background-color: ${({ theme, $filled }) =>
    $filled ? theme.colors.primary : "transparent"};
  transition: all 0.2s ease;
`;

const PinPad = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
  max-width: 300px;
  margin: 0 auto;
`;

const PinButton = styled.button<{ $variant?: "clear" | "back" }>`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 22px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
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
    $variant === "clear" &&
    `
    font-size: 14px;
    color: ${theme.colors.error};
    border-color: ${theme.colors.error}50;
    &:hover {
      background-color: ${theme.colors.error}15;
      border-color: ${theme.colors.error};
    }
  `}

  ${({ $variant, theme }) =>
    $variant === "back" &&
    `
    font-size: 20px;
    &:hover {
      background-color: ${theme.colors.warning}15;
      border-color: ${theme.colors.warning};
    }
  `}
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  margin-top: ${({ theme }) => theme.spacing.md};
  font-size: 14px;
  min-height: 20px;
`;

const LoadingOverlay = styled.div`
  position: fixed;
  inset: 0;
  background-color: ${({ theme }) => theme.colors.surface}cc;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: ${({ theme }) => theme.colors.primary};
  z-index: 100;
`;

const SwitchLink = styled.button`
  margin-top: ${({ theme }) => theme.spacing.xl};
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.primary};
  cursor: pointer;
  font-size: 14px;
  text-decoration: underline;

  &:hover {
    opacity: 0.8;
  }
`;

const KeyboardHint = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const ContentWrapper = styled.div`
  animation: fadeIn 0.3s ease;
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const PhoneForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
  text-align: left;
`;

const RememberRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  user-select: none;
`;

const PhoneRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
  text-align: left;

  & > *:first-child {
    flex: 1;
    min-width: 0;
  }
`;

const KbToggle = styled.button<{ $active?: boolean }>`
  flex-shrink: 0;
  background: none;
  border: 1px solid
    ${({ theme, $active }) =>
      $active ? theme.colors.primary : theme.colors.border};
  cursor: pointer;
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.textSecondary};
  border-radius: 6px;
  transition: all 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
    border-color: ${({ theme }) => theme.colors.primary};
    background: ${({ theme }) => theme.colors.primary}10;
  }
`;

function loadSaved(): { phone: string; password: string } | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw) return JSON.parse(raw) as { phone: string; password: string };
  } catch {
    /* ignore */
  }
  return null;
}

interface LoginBanner { imageUrl: string; title: string; subtitle: string; }

export function PinLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loginWithPin, login, isLoading, error, clearError } = useAuthStore();
  const { mode: themeMode } = useTheme();

  // null = still checking, true/false = result
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null);
  const [banner, setBanner] = useState<LoginBanner | null>(null);

  useEffect(() => {
    window.electronAPI.auth.isPinConfigured().then(setPinConfigured);
  }, []);

  useEffect(() => {
    window.electronAPI.config.getLocalConfig().then((cfg) => {
      if (!cfg?.apiUrl) return;
      const baseUrl = cfg.apiUrl.replace(/\/api\/?$/, "");
      fetch(`${cfg.apiUrl}/site-config/login-banner`)
        .then((r) => r.json())
        .then((data) => {
          const banner = data as LoginBanner;
          if (banner.imageUrl && !banner.imageUrl.startsWith("http")) {
            banner.imageUrl = `${baseUrl}${banner.imageUrl}`;
          }
          setBanner(banner);
        })
        .catch(() => {});
    });
  }, []);

  const [saved] = useState(loadSaved);
  const [mode, setMode] = useState<LoginMode>(saved ? "phone" : "pin");
  const [pin, setPin] = useState("");

  // Phone login state
  const [phoneDigits, setPhoneDigits] = useState(saved?.phone ?? "");
  const [password, setPassword] = useState(saved?.password ?? "");
  const [rememberMe, setRememberMe] = useState(!!saved);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [focusedField, setFocusedField] = useState<"phone" | "password">(
    "phone",
  );

  // When PIN status loads: if not configured, force phone mode
  useEffect(() => {
    if (pinConfigured === false && !saved) {
      setMode("phone");
    }
  }, [pinConfigured, saved]);

  useEffect(() => {
    clearError();
  }, [clearError]);

  const switchMode = (newMode: LoginMode) => {
    setPin("");
    setPhoneDigits("");
    setPassword("");
    clearError();
    setKeyboardOpen(false);
    setMode(newMode);
  };

  // --- PIN logic ---
  const handlePinSubmit = useCallback(
    async (pinValue: string) => {
      if (pinValue.length !== 4) return;

      const success = await loginWithPin(pinValue);
      if (success) {
        navigate("/");
      } else {
        setPin("");
      }
    },
    [loginWithPin, navigate],
  );

  useEffect(() => {
    if (pin.length === 4) {
      handlePinSubmit(pin);
    }
  }, [pin, handlePinSubmit]);

  useEffect(() => {
    if (mode !== "pin") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (pin.length < 4) {
          setPin((prev) => prev + e.key);
          clearError();
        }
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((prev) => prev.slice(0, -1));
        clearError();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPin("");
        clearError();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pin, isLoading, clearError, mode]);

  const handleNumberClick = (num: string) => {
    if (pin.length < 4 && !isLoading) {
      setPin((prev) => prev + num);
      clearError();
    }
  };

  const handleBackspace = () => {
    if (!isLoading) {
      setPin((prev) => prev.slice(0, -1));
      clearError();
    }
  };

  const handleClear = () => {
    if (!isLoading) {
      setPin("");
      clearError();
    }
  };

  // --- Phone login logic ---
  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isUzPhoneComplete(phoneDigits)) return;

    const fullPhone = "998" + phoneDigits;
    const success = await login(fullPhone, password);
    if (success) {
      if (rememberMe) {
        localStorage.setItem(
          SAVED_KEY,
          JSON.stringify({ phone: phoneDigits, password }),
        );
      } else {
        localStorage.removeItem(SAVED_KEY);
      }
      // Redirect to PIN setup if PIN not yet configured
      navigate(pinConfigured === false ? "/setup-pin" : "/");
    }
  };

  const handlePhoneEnter = () => {
    passwordRef.current?.focus();
  };

  // --- Virtual keyboard handler ---
  const handleVirtualKeyPress = (key: string) => {
    if (key === "BACKSPACE") {
      if (focusedField === "phone") {
        setPhoneDigits((prev) => prev.slice(0, -1));
      } else {
        setPassword((prev) => prev.slice(0, -1));
      }
      return;
    }

    if (key === "ENTER") {
      if (focusedField === "phone") {
        setFocusedField("password");
        passwordRef.current?.focus();
      } else if (
        focusedField === "password" &&
        isUzPhoneComplete(phoneDigits)
      ) {
        const fullPhone = "998" + phoneDigits;
        login(fullPhone, password).then((success) => {
          if (success) {
            if (rememberMe) {
              localStorage.setItem(
                SAVED_KEY,
                JSON.stringify({ phone: phoneDigits, password }),
              );
            } else {
              localStorage.removeItem(SAVED_KEY);
            }
            navigate(pinConfigured === false ? "/setup-pin" : "/");
          }
        });
      }
      return;
    }

    if (focusedField === "phone") {
      if (/^[0-9]$/.test(key)) {
        setPhoneDigits((prev) => (prev.length < 9 ? prev + key : prev));
      }
    } else {
      setPassword((prev) => prev + key);
    }
  };

  return (
    <Container>
      <LeftPanel>
        <LoginCard $kbOpen={keyboardOpen}>
          <LogoBrand>
            <POSGROIcon theme={themeMode} size={72} />
            <BrandName>POSGRO</BrandName>
          </LogoBrand>

          {mode === "pin" ? (
            <ContentWrapper key="pin">
              <Subtitle>{t("auth.enterPin")}</Subtitle>

              <PinDisplay>
                {[0, 1, 2, 3].map((i) => (
                  <PinDot key={i} $filled={pin.length > i} />
                ))}
              </PinDisplay>

              <PinPad>
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                  <PinButton
                    key={num}
                    onClick={() => handleNumberClick(num)}
                    disabled={isLoading}
                    tabIndex={-1}
                  >
                    {num}
                  </PinButton>
                ))}
                <PinButton
                  $variant="clear"
                  onClick={handleClear}
                  disabled={isLoading}
                  tabIndex={-1}
                >
                  <Eraser size={30} />
                </PinButton>
                <PinButton
                  onClick={() => handleNumberClick("0")}
                  disabled={isLoading}
                  tabIndex={-1}
                >
                  0
                </PinButton>
                <PinButton
                  $variant="back"
                  onClick={handleBackspace}
                  disabled={isLoading}
                  tabIndex={-1}
                >
                  <Delete size={30} />
                </PinButton>
              </PinPad>

              <ErrorMessage>
                {error ? t(error, { defaultValue: error }) : ""}
              </ErrorMessage>

              <KeyboardHint>{t("auth.keyboardHint")}</KeyboardHint>

              <SwitchLink onClick={() => switchMode("phone")}>
                {t("auth.usePhoneLogin")}
              </SwitchLink>
            </ContentWrapper>
          ) : (
            <ContentWrapper
              key="phone"
              style={{ display: "flex", flexDirection: "column", gap: "18px" }}
            >
              <Subtitle>{t("auth.login")}</Subtitle>

              <PhoneRow>
                <UzbekPhoneInput
                  label={t("auth.phone")}
                  valueDigits={phoneDigits}
                  onDigitsChange={setPhoneDigits}
                  onEnter={handlePhoneEnter}
                  onFocus={() => setFocusedField("phone")}
                  autoFocus
                />
                <KbToggle
                  type="button"
                  tabIndex={-1}
                  $active={keyboardOpen}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setKeyboardOpen((prev) => !prev)}
                >
                  <Keyboard size={19} />
                  {keyboardOpen ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </KbToggle>
              </PhoneRow>
              <PhoneForm onSubmit={handlePhoneSubmit}>
                <Input
                  label={t("auth.password")}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  placeholder={t("auth.password")}
                  ref={passwordRef}
                  required
                />
                <RememberRow>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  {t("auth.rememberMe")}
                </RememberRow>
                {error && (
                  <ErrorMessage>
                    {t(error, { defaultValue: error })}
                  </ErrorMessage>
                )}
                <Button
                  type="submit"
                  disabled={isLoading || !isUzPhoneComplete(phoneDigits)}
                  fullWidth
                >
                  {isLoading ? t("common.loading") : t("auth.login")}
                </Button>
              </PhoneForm>

              {pinConfigured !== false && (
                <SwitchLink onClick={() => switchMode("pin")}>
                  ← {t("auth.enterPin")}
                </SwitchLink>
              )}
            </ContentWrapper>
          )}
          <TerminalAccessBar />
        </LoginCard>
        {keyboardOpen && (
          <VirtualKeyboard
            numbersOnly={focusedField === "phone"}
            onKeyPress={handleVirtualKeyPress}
            onClose={() => setKeyboardOpen(false)}
          />
        )}
      </LeftPanel>

      <RightPanel $imageUrl={banner?.imageUrl || undefined}>
        {(banner?.title || banner?.subtitle) && (
          <RightOverlay>
            {banner.title && <RightTitle>{banner.title}</RightTitle>}
            {banner.subtitle && <RightSubtitle>{banner.subtitle}</RightSubtitle>}
          </RightOverlay>
        )}
      </RightPanel>

      {isLoading && <LoadingOverlay>{t("common.loading")}...</LoadingOverlay>}
    </Container>
  );
}
