import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useAuthStore } from "../../store/auth-store";
import { useSettingsStore } from "../../store/settings-store";
import { POSGROIcon } from "../../branding";
import { Button } from "@components/common/Button";
import { Input } from "@components/common/Input";
import { UzbekPhoneInput } from "@components/common/UzbekPhoneInput";
import { isUzPhoneComplete } from "@shared/utils/phone";
import { Eye, EyeOff, Download } from "lucide-react";
import { useToast } from "@context/ToastContext";
import { siteConfig, type LoginBanner } from "../../api/client";

/**
 * Refusals that are about the store, not the credentials.
 *
 * The password was right — the shop simply cannot be managed from here. That deserves a sentence
 * explaining why and what to do instead, which is more than the one-line field error under the
 * form is meant to carry, so these get a toast and the inline error is cleared.
 */
const STORE_BLOCKED_ERRORS = [
  "auth.errors.store_inactive",
  "auth.errors.store_offline_only",
];

const RELEASES_BASE = "/releases";

// ─── Layout ──────────────────────────────────────────────────────────────────

const Container = styled.div`
  display: flex;
  min-height: 100vh;
  background-color: ${({ theme }) => theme.colors.background};
`;

const LeftPanel = styled.div`
  flex: 1;
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

// ─── Card (left panel content) ───────────────────────────────────────────────

const Card = styled.div`
  width: 100%;
  max-width: 420px;
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
  margin: 0 0 ${({ theme }) => theme.spacing.xl};
  font-size: 16px;
  text-align: center;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 14px;
  min-height: 20px;
  padding: ${({ theme }) => theme.spacing.sm};
  background-color: ${({ theme }) => theme.colors.error}10;
  border: 1px solid ${({ theme }) => theme.colors.error}30;
  border-radius: ${({ theme }) => theme.borderRadius};
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

const LangRow = styled.div`
  display: flex;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-top: ${({ theme }) => theme.spacing.lg};
`;

const LangButton = styled.button<{ $active?: boolean }>`
  background: none;
  border: 1px solid
    ${({ theme, $active }) =>
      $active ? theme.colors.primary : theme.colors.border};
  color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.textSecondary};
  padding: 4px 12px;
  border-radius: ${({ theme }) => theme.borderRadius};
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const DownloadBanner = styled.a`
  @media (max-width: 600px) {
    display: none;
  }
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: ${({ theme }) => theme.spacing.md};
  padding: 8px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  text-decoration: none;
  transition: all 0.2s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.colors.primary};
    background-color: ${({ theme }) => theme.colors.primary}08;
  }

  span.ver {
    font-weight: 500;
    color: ${({ theme }) => theme.colors.text};
  }
`;

const PasswordWrapper = styled.div`
  position: relative;
`;

const EyeButton = styled.button`
  position: absolute;
  right: 10px;
  top: 70%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;

  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
`;

// ─── Component ───────────────────────────────────────────────────────────────

const ENV_STORE_ID = import.meta.env.VITE_STORE_ID as string | undefined;
const SAVED_KEY = "login_saved";

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuthStore();
  const toast = useToast();
  const { language, setLanguage, theme } = useSettingsStore();

  const [phoneDigits, setPhoneDigits] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [storeId, setStoreId] = useState(
    ENV_STORE_ID ?? localStorage.getItem("last_store_id") ?? "",
  );
  const [showStoreId, setShowStoreId] = useState(
    !ENV_STORE_ID && !localStorage.getItem("last_store_id"),
  );
  const [rememberMe, setRememberMe] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [latestRelease, setLatestRelease] = useState<{
    version: string;
    url: string;
  } | null>(null);
  const [banner, setBanner] = useState<LoginBanner | null>(null);

  useEffect(() => {
    clearError();
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as {
          phone?: string;
          password?: string;
          storeId?: string;
        };
        if (saved.phone) setPhoneDigits(saved.phone);
        if (saved.password) setPassword(saved.password);
        if (saved.storeId && !ENV_STORE_ID) {
          setStoreId(saved.storeId);
          setShowStoreId(false);
        }
        setRememberMe(true);
      } catch {
        /* ignore */
      }
    }
  }, [clearError]);

  useEffect(() => {
    fetch(`${RELEASES_BASE}/latest.yml`)
      .then((r) => r.text())
      .then((yaml) => {
        const versionMatch = yaml.match(/^version:\s*(.+)$/m);
        const pathMatch = yaml.match(/^path:\s*(.+)$/m);
        if (versionMatch && pathMatch) {
          setLatestRelease({
            version: versionMatch[1].trim(),
            url: `${RELEASES_BASE}/${pathMatch[1].trim()}`,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    siteConfig
      .getLoginBanner()
      .then(setBanner)
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isUzPhoneComplete(phoneDigits)) return;

    const fullPhone = "998" + phoneDigits;
    const success = await login(fullPhone, password, storeId || undefined);

    if (!success) {
      const reason = useAuthStore.getState().error;
      if (reason && STORE_BLOCKED_ERRORS.includes(reason)) {
        // Long enough to actually read — it explains where to go instead.
        toast.error(t(reason), 12000);
        clearError();
      }
      return;
    }

    if (rememberMe) {
      localStorage.setItem(
        SAVED_KEY,
        JSON.stringify({
          phone: phoneDigits,
          password,
          storeId: storeId || undefined,
        }),
      );
    } else {
      localStorage.removeItem(SAVED_KEY);
    }
    if (storeId) localStorage.setItem("last_store_id", storeId);
    navigate("/");
  };

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  const showOverlay = banner && (banner.title || banner.subtitle);

  return (
    <Container>
      <LeftPanel>
        <Card>
          <LogoBrand>
            <POSGROIcon theme={theme} size={72} />
            <BrandName>POSGRO</BrandName>
          </LogoBrand>
          <Subtitle>{t("auth.login")}</Subtitle>

          <Form onSubmit={handleSubmit}>
            <UzbekPhoneInput
              label={t("auth.phone")}
              valueDigits={phoneDigits}
              onDigitsChange={setPhoneDigits}
              onEnter={() => passwordRef.current?.focus()}
            />

            <PasswordWrapper>
              <Input
                label={t("auth.password")}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.password")}
                ref={passwordRef}
                required
                style={{ paddingRight: "40px" }}
              />
              <EyeButton
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                title={
                  showPassword
                    ? t("auth.hidePassword") || "Hide"
                    : t("auth.showPassword") || "Show"
                }
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </EyeButton>
            </PasswordWrapper>

            {!ENV_STORE_ID && (
              <>
                {!showStoreId ? (
                  <button
                    type="button"
                    onClick={() => setShowStoreId(true)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "inherit",
                      opacity: 0.5,
                      fontSize: 13,
                      cursor: "pointer",
                      textAlign: "left",
                      padding: 0,
                    }}
                  >
                    {storeId
                      ? `${t("common.store")}: ${storeId}`
                      : t("auth.enterStoreId") || "+ Enter store ID"}
                  </button>
                ) : (
                  <Input
                    label={t("common.storeId")}
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                    placeholder="XXXX"
                  />
                )}
              </>
            )}

            <RememberRow>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              {t("auth.rememberMe") || "Запомнить меня"}
            </RememberRow>

            {error && (
              <ErrorMessage>
                {t(error, { defaultValue: t("auth.errors.login_failed") })}
              </ErrorMessage>
            )}

            <Button
              type="submit"
              disabled={isLoading || !isUzPhoneComplete(phoneDigits)}
              fullWidth
            >
              {isLoading ? t("common.loading") : t("auth.login")}
            </Button>
          </Form>

          <LangRow>
            <LangButton
              type="button"
              $active={language === "ru"}
              onClick={() => handleLanguageChange("ru")}
            >
              Русский
            </LangButton>
            <LangButton
              type="button"
              $active={language === "uz"}
              onClick={() => handleLanguageChange("uz")}
            >
              O'zbekcha
            </LangButton>
          </LangRow>

          {latestRelease && (
            <DownloadBanner href={latestRelease.url} download>
              <Download size={14} />
              {language === "uz"
                ? "Dasturni yuklab olish"
                : "Скачать приложение"}{" "}
              <span className="ver">v{latestRelease.version}</span>
            </DownloadBanner>
          )}
        </Card>
      </LeftPanel>

      <RightPanel $imageUrl={banner?.imageUrl || undefined}>
        {showOverlay && (
          <RightOverlay>
            {banner!.title && <RightTitle>{banner!.title}</RightTitle>}
            {banner!.subtitle && (
              <RightSubtitle>{banner!.subtitle}</RightSubtitle>
            )}
          </RightOverlay>
        )}
      </RightPanel>
    </Container>
  );
}
