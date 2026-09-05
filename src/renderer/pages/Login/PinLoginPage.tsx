import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import { useToast } from "../../context/ToastContext";

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
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 32px (theme.spacing.xl) at 768px of height and above; a shorter screen spends it on the pad
     instead. Horizontally it never matters — the card is capped at 400px inside a half-window. */
  padding: clamp(16px, 4.17vmin, ${({ theme }) => theme.spacing.xl});
  background-color: ${({ theme }) => theme.colors.surface};

  /* The safe keyword is what stops a screen too short for the card from eating its top edge:
     centring overflows in both directions and this panel clips, so plain center cut the logo
     off. When it cannot fit, alignment falls back to start and the panel scrolls instead. */
  justify-content: safe center;
  overflow-x: hidden;
  overflow-y: auto;
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

/**
 * The PIN pad scales with the screen, not with this card — the card is width-capped at 400px, so
 * it measures the same on a 1024×768 monoblock as on a 1080p desktop and can tell you nothing
 * about either. Height is the scarce axis here (the card is nearly as tall as a 768px screen),
 * so the keys are sized from the height left over and the rest from `vmin`.
 *
 * Every coefficient is set so the tokens equal today's fixed pixels at 768px of height — the
 * common monoblock keeps exactly the layout it has. Shorter screens (1024×600, 1280×720) shrink
 * rather than push the pad off the bottom, and roomier ones grow the keys up to a cap. The
 * whitespace tokens only ever shrink: a big screen should spend its height on keys, not margins.
 * Deliberately no mobile step — the POS is a terminal app, never a phone.
 *
 * Measured in Electron's Chromium from 1024×600 to 2560×1440: nothing clipped, keys centred,
 * and 64px keys at 768 exactly as before.
 */
const LoginCard = styled.div<{ $kbOpen?: boolean }>`
  /*
   * Keys take whatever height is left over. 440px is everything else stacked up — logo, subtitle,
   * dots, login button, mode switch, terminal bar and the panel's padding — and 5.125 is the pad
   * in key units (4 rows + 3 gaps of 0.375). So the pad is as large as the screen can actually
   * show, which at 768px of height works out to exactly today's 64px.
   *
   * The constant is shared with SetupPinPage, whose chrome is a little shorter: the two pads are
   * the same control seen back to back, so they are sized as one and the difference is slack.
   */
  --pin-key: clamp(48px, calc((100vh - 440px) / 5.125), 88px);
  --pin-gap: calc(var(--pin-key) * 0.375);
  --pin-dot: clamp(16px, 2.6vmin, 26px);
  /* Whitespace: the big vertical gaps, the mark, and never larger than today's fixed values —
     a roomier screen should spend its height on the keys, not on the margins. */
  --pin-rhythm: clamp(16px, 3.125vmin, 32px);
  --pin-logo: clamp(44px, 9.375vmin, 72px);

  width: 100%;
  max-width: 400px;
  text-align: center;
  transform: translateY(${({ $kbOpen }) => ($kbOpen ? "-60px" : "0")});
  transition: transform 0.3s ease;

  /* Sitting above centre is decorative, and a negative margin is not safe in the sense above:
     it pushes the logo out of the panel on a short screen. Only lift with height to spare. */
  @media (min-height: 860px) {
    margin-top: -60px;
  }
`;

const LogoBrand = styled.div`
  display: flex;
  align-items: center;
  /* The mark's size prop is a width/height attribute, which CSS outranks — so it scales too. */
  svg {
    width: var(--pin-logo);
    height: var(--pin-logo);
  }
  /* The card centres its text, but that says nothing about flex children: as a row this packs
     to the start unless the main axis is centred too. */
  justify-content: center;
  gap: 10px;
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
  margin-bottom: var(--pin-rhythm);
  font-size: 20px;
`;

const PinDisplay = styled.div`
  display: flex;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: var(--pin-rhythm);
`;

const PinDot = styled.div<{ $filled: boolean }>`
  width: var(--pin-dot);
  height: var(--pin-dot);
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.primary};
  background-color: ${({ theme, $filled }) =>
    $filled ? theme.colors.primary : "transparent"};
  transition: all 0.2s ease;
`;

/**
 * Tracks are exactly one key wide, so the pad measures its own keys and `justify-content` can
 * centre the block. With `1fr` tracks the fixed-width keys sat at the left of tracks a third of
 * a 300px pad wide, which left the whole pad hanging ~30px left of the card it is centred in.
 */
const PinPad = styled.div`
  display: grid;
  grid-template-columns: repeat(3, var(--pin-key));
  justify-content: center;
  gap: var(--pin-gap);
  margin: 0 auto;
`;

const PinButton = styled.button<{ $variant?: "clear" | "back" }>`
  width: var(--pin-key);
  height: var(--pin-key);
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  /* Digits and the lucide icons ride the key size — the factors reproduce today's 22px text and
     30px icons at the 64px floor. */
  font-size: calc(var(--pin-key) * 0.34);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    width: calc(var(--pin-key) * 0.47);
    height: calc(var(--pin-key) * 0.47);
  }

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

const ConfirmRow = styled.div`
  width: calc(var(--pin-key) * 3 + var(--pin-gap) * 2);
  margin: ${({ theme }) => theme.spacing.md} auto 0;
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
  margin-top: var(--pin-rhythm);
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
  const requestedMode = (useLocation().state as { mode?: LoginMode } | null)?.mode;
  const toast = useToast();

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
  // Remembered credentials normally open the phone form, but a caller can ask for a mode — the
  // app bar's switch-user button hands the terminal over on the PIN pad, not on someone else's
  // remembered phone number.
  const [mode, setMode] = useState<LoginMode>(
    requestedMode ?? (saved ? "phone" : "pin"),
  );
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

  // Logging out redirects here on its own, so this page can already be mounted by the time the
  // switch-user button's navigation lands. Track the request rather than only seeding state.
  useEffect(() => {
    if (requestedMode) {
      setMode(requestedMode);
    }
  }, [requestedMode]);

  // When PIN status loads: if nobody on this terminal has a PIN there is nothing to type, so the
  // phone form is the only way in — including when the PIN pad was explicitly asked for.
  useEffect(() => {
    if (pinConfigured === false) {
      setMode("phone");
    }
  }, [pinConfigured]);

  // Auth failures arrive on the store, not as local state. Show each one once and clear it, so
  // the same error can be raised again on the next attempt — and so an error left over from a
  // previous attempt can never be shown twice.
  useEffect(() => {
    if (!error) return;
    toast.error(t(error, { defaultValue: error }));
    clearError();
  }, [error, toast, clearError, t]);

  const switchMode = (newMode: LoginMode) => {
    setPin("");
    setPhoneDigits("");
    setPassword("");
    setKeyboardOpen(false);
    setMode(newMode);
  };

  // --- PIN logic ---
  // PINs are 1–4 digits. A full 4 digits submits on its own (the common case, and what the pad
  // has always done); anything shorter needs the confirm button or Enter, since there is no way
  // to tell "still typing" from "done" before then.
  const handlePinSubmit = useCallback(
    async (pinValue: string) => {
      if (pinValue.length < 1 || pinValue.length > 4) return;

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
        }
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPin("");
      } else if (e.key === "Enter" && pin.length > 0) {
        e.preventDefault();
        handlePinSubmit(pin);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pin, isLoading, mode, handlePinSubmit]);

  const handleNumberClick = (num: string) => {
    if (pin.length < 4 && !isLoading) {
      setPin((prev) => prev + num);
    }
  };

  const handleBackspace = () => {
    if (!isLoading) {
      setPin((prev) => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    if (!isLoading) {
      setPin("");
    }
  };

  // After a password login, offer PIN setup to whoever just signed in — the PIN belongs to the
  // person now, so "somebody on this terminal has one" says nothing about this account.
  const goHomeAfterLogin = useCallback(async () => {
    const hasPin = await window.electronAPI.auth.hasPin().catch(() => true);
    navigate(hasPin ? "/" : "/setup-pin");
  }, [navigate]);

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
      // Redirect to PIN setup if this user has no PIN yet
      await goHomeAfterLogin();
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
        login(fullPhone, password).then(async (success) => {
          if (success) {
            if (rememberMe) {
              localStorage.setItem(
                SAVED_KEY,
                JSON.stringify({ phone: phoneDigits, password }),
              );
            } else {
              localStorage.removeItem(SAVED_KEY);
            }
            await goHomeAfterLogin();
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

              {/* Submits a PIN of any allowed length; a 4th digit still submits on its own.
                  Dead until there is something to submit, so an empty tap cannot fail a login. */}
              <ConfirmRow>
                <Button
                  onClick={() => handlePinSubmit(pin)}
                  disabled={isLoading || pin.length === 0}
                  fullWidth
                >
                  {t("auth.login")}
                </Button>
              </ConfirmRow>

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
