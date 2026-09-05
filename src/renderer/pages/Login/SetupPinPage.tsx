import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled, { keyframes } from "styled-components";
import { Delete, Eraser, ShieldCheck } from "lucide-react";
import { Button } from "../../components/common/Button";
import { useToast } from "../../context/ToastContext";

const Container = styled.div`
  display: flex;
  min-height: 100vh;
  background-color: ${({ theme }) => theme.colors.background};
  /* safe: on a screen too short for the card, centring would put its top out of reach above the
     scroll origin. Falls back to start-aligned, so the page simply scrolls. */
  align-items: safe center;
  justify-content: center;
`;

/**
 * Same sizing tokens as the login pad in PinLoginPage — deliberately identical, since it is the
 * same pad and the two pages are seen back to back. See that file for the reasoning; the short
 * version is that keys take the height left over after the fixed chrome (440px covers this
 * card's 402px plus breathing room), which is exactly today's 64px on a 768px-tall monoblock.
 */
const Card = styled.div`
  --pin-key: clamp(48px, calc((100vh - 440px) / 5.125), 88px);
  --pin-gap: calc(var(--pin-key) * 0.375);
  --pin-dot: clamp(16px, 2.6vmin, 26px);
  --pin-rhythm: clamp(16px, 3.125vmin, 32px);
  --pin-icon: clamp(32px, 6.25vmin, 48px);

  width: 100%;
  max-width: 360px;
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xl};
`;

const IconWrap = styled.div`
  display: flex;
  justify-content: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.primary};

  svg {
    width: var(--pin-icon);
    height: var(--pin-icon);
  }
`;

const Title = styled.h1`
  font-size: 22px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
`;

const Subtitle = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 15px;
  margin: 0 0 var(--pin-rhythm);
`;

const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
`;

const PinDot = styled.div<{ $filled: boolean; $error?: boolean }>`
  width: var(--pin-dot);
  height: var(--pin-dot);
  border-radius: 50%;
  border: 2px solid ${({ theme, $error }) => $error ? theme.colors.error : theme.colors.primary};
  background-color: ${({ theme, $filled, $error }) =>
    $filled ? ($error ? theme.colors.error : theme.colors.primary) : "transparent"};
  transition: all 0.2s ease;
`;

const DotsRow = styled.div<{ $shake?: boolean }>`
  display: flex;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: var(--pin-rhythm);
  animation: ${({ $shake }) => $shake ? shake : "none"} 0.4s ease;
`;

/* Tracks one key wide, so the block of keys is what gets centred — with 1fr tracks the fixed
   keys sat at the left of each, leaving the pad visibly off-centre inside the card. */
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
  /* Reproduces today's 22px digits and 28px icons at the 64px floor. */
  font-size: calc(var(--pin-key) * 0.34);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    width: calc(var(--pin-key) * 0.44);
    height: calc(var(--pin-key) * 0.44);
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
`;

const SkipLink = styled.button`
  margin-top: ${({ theme }) => theme.spacing.lg};
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  font-size: 14px;
  text-decoration: underline;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const ConfirmRow = styled.div`
  width: calc(var(--pin-key) * 3 + var(--pin-gap) * 2);
  margin: ${({ theme }) => theme.spacing.md} auto 0;
`;

const StepIndicator = styled.div`
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const StepDot = styled.div<{ $active: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme, $active }) => $active ? theme.colors.primary : theme.colors.border};
  transition: background 0.2s;
`;

type Step = "enter" | "confirm";

export function SetupPinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<Step>("enter");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [hasError, setHasError] = useState(false);
  const [shakeConfirm, setShakeConfirm] = useState(false);

  const current = step === "enter" ? pin : confirmPin;
  const setCurrent = step === "enter" ? setPin : setConfirmPin;

  const triggerShake = () => {
    setShakeConfirm(true);
    setTimeout(() => setShakeConfirm(false), 450);
  };

  // Save, or move on to the confirm step. A 4-digit PIN triggers this on its own; a shorter one
  // (1–3 digits is allowed) waits for the continue button, since it has no natural end.
  const submitCurrent = useCallback((value: string) => {
    if (value.length < 1 || value.length > 4) return;

    if (step === "enter") {
      setStep("confirm");
      return;
    }

    if (value !== pin) {
      triggerShake();
      toast.error(t("auth.errors.pin_mismatch"));
      // Let the shake finish before the dots empty, so the two read as one reaction.
      setTimeout(() => {
        setConfirmPin("");
        setHasError(true);
      }, 420);
      return;
    }

    window.electronAPI.auth.setupPin(value).then(() => {
      navigate("/", { replace: true });
    }).catch((err: unknown) => {
      const raw = err instanceof Error ? err.message : "";
      const match = raw.match(/(auth\.errors\.\S+)/);
      toast.error(t(match ? match[1] : "auth.errors.login_failed"));
      // A rejected PIN (already taken, bad format) means starting over, not fixing a typo.
      setConfirmPin("");
      setStep("enter");
      setPin("");
    });
  }, [pin, step, navigate, toast, t]);

  const handleNumber = useCallback((num: string) => {
    if (current.length >= 4) return;
    setHasError(false);
    const next = current + num;
    setCurrent(next);

    if (next.length === 4) {
      // Let the fourth dot render before the step flips or the page navigates away.
      setTimeout(() => submitCurrent(next), 200);
    }
  }, [current, setCurrent, submitCurrent]);

  const handleBackspace = useCallback(() => {
    setHasError(false);
    setCurrent((prev) => prev.slice(0, -1));
  }, [setCurrent]);

  const handleClear = useCallback(() => {
    setHasError(false);
    if (step === "confirm") {
      setStep("enter");
      setPin("");
      setConfirmPin("");
    } else {
      setPin("");
    }
  }, [step]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleNumber(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClear();
      } else if (e.key === "Enter" && current.length > 0) {
        e.preventDefault();
        submitCurrent(current);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNumber, handleBackspace, handleClear, submitCurrent, current]);

  const isError = hasError && step === "confirm";

  return (
    <Container>
      <Card>
        <IconWrap>
          <ShieldCheck size={48} />
        </IconWrap>

        <Title>{t("auth.setupPin")}</Title>
        <Subtitle>
          {step === "enter" ? t("auth.setupPinSubtitle") : t("auth.confirmPinSubtitle")}
        </Subtitle>

        <StepIndicator>
          <StepDot $active={step === "enter"} />
          <StepDot $active={step === "confirm"} />
        </StepIndicator>

        <DotsRow $shake={shakeConfirm}>
          {[0, 1, 2, 3].map((i) => (
            <PinDot key={i} $filled={current.length > i} $error={isError} />
          ))}
        </DotsRow>

        <PinPad>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
            <PinButton key={num} onClick={() => handleNumber(num)}>
              {num}
            </PinButton>
          ))}
          <PinButton $variant="clear" onClick={handleClear}>
            <Eraser size={28} />
          </PinButton>
          <PinButton onClick={() => handleNumber("0")}>0</PinButton>
          <PinButton onClick={handleBackspace}>
            <Delete size={28} />
          </PinButton>
        </PinPad>

        {/* Only 1–3 digit PINs need it — a 4th digit continues on its own. */}
        {current.length > 0 && current.length < 4 && (
          <ConfirmRow>
            <Button onClick={() => submitCurrent(current)} fullWidth>
              {t("common.continue")}
            </Button>
          </ConfirmRow>
        )}

        {/* A PIN is a convenience, not a requirement — phone + password always works. */}
        <SkipLink type="button" onClick={() => navigate("/", { replace: true })}>
          {t("setup.pin.skip")}
        </SkipLink>
      </Card>
    </Container>
  );
}
