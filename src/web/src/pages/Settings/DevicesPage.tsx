import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import {
  Monitor,
  Smartphone,
  Tablet,
  ShoppingCart,
  Wifi,
  LogOut,
  Shield,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
} from "lucide-react";
import { Button } from "@components/common/Button";
import { auth as authApi, DeviceSession } from "../../api/client";
import { useNavigate } from "react-router-dom";

// ─── Styled components ────────────────────────────────────────────────────────

const Container = styled.div`
  max-width: 800px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
  font-size: 24px;

  @media (max-width: 600px) {
    font-size: 20px;
    flex: 1;
  }
`;

export const TopBar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Section = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  overflow: hidden;
`;

const SectionHeader = styled.div`
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.lg}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const DeviceCard = styled.div`
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  &:last-child {
    border-bottom: none;
  }
`;

const DeviceRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.lg}`};

  @media (max-width: 600px) {
    flex-wrap: wrap;
    padding: ${({ theme }) => theme.spacing.md};
  }
`;

const DeviceIcon = styled.div<{ $current?: boolean }>`
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background-color: ${({ theme, $current }) =>
    $current ? theme.colors.primary + "20" : theme.colors.background};
  color: ${({ theme, $current }) =>
    $current ? theme.colors.primary : theme.colors.textSecondary};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const DeviceInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const DeviceIp = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const DeviceNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
`;

const DeviceNameInput = styled.input`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: 5px 8px;
  width: 200px;
  max-width: 100%;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }

  @media (max-width: 600px) {
    width: 140px;
  }
`;

const DeviceNameText = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SessionCountBadge = styled.span`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background-color: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.textSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const CurrentBadge = styled.span`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background-color: ${({ theme }) => theme.colors.primary};
  color: #fff;
`;

const DeviceActions = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-shrink: 0;

  @media (max-width: 600px) {
    width: 100%;
    padding-left: 52px;
  }
`;

const SessionsExpanded = styled.div`
  background: ${({ theme }) => theme.colors.background};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const SessionRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: 10px ${({ theme }) => theme.spacing.lg} 10px 72px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  &:last-child {
    border-bottom: none;
  }

  @media (max-width: 600px) {
    padding: 10px ${({ theme }) => theme.spacing.md};
    flex-wrap: wrap;
  }
`;

const SessionInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const SessionName = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const SessionMeta = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
`;

const EmptyState = styled.div`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

const FeedbackText = styled.p<{ $error?: boolean }>`
  margin: 0;
  font-size: 14px;
  color: ${({ theme, $error }) =>
    $error ? theme.colors.error : theme.colors.success};
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type DeviceType = "mobile" | "tablet" | "terminal" | "desktop";

function parseUA(ua: string | null): { deviceType: DeviceType; os: string; browser: string } {
  if (!ua) return { deviceType: "desktop", os: "Unknown", browser: "Unknown" };

  const isMobile = /iPhone|Android.*Mobile|BlackBerry|IEMobile|Windows Phone/i.test(ua);
  const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);
  const isTerminal = /Electron/i.test(ua);

  let os = "Unknown";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) os = "macOS";
  else if (/iPhone/i.test(ua)) os = "iOS (iPhone)";
  else if (/iPad/i.test(ua)) os = "iOS (iPad)";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Unknown";
  if (isTerminal) browser = "POS Terminal";
  else if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";

  const deviceType: DeviceType = isTerminal ? "terminal" : isMobile ? "mobile" : isTablet ? "tablet" : "desktop";
  return { deviceType, os, browser };
}

function DeviceTypeIcon({ type, current }: { type: DeviceType; current: boolean }) {
  const props = { size: 20 };
  switch (type) {
    case "mobile": return <Smartphone {...props} />;
    case "tablet": return <Tablet {...props} />;
    case "terminal": return <ShoppingCart {...props} />;
    default: return <Monitor {...props} />;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

interface DeviceGroup {
  ip: string;
  sessions: DeviceSession[];
  hasCurrent: boolean;
  deviceType: DeviceType;
  savedName: string | null;
}

function groupByIp(sessions: DeviceSession[]): DeviceGroup[] {
  const map = new Map<string, DeviceSession[]>();
  for (const s of sessions) {
    const key = s.ipAddress || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }

  return Array.from(map.entries()).map(([ip, list]) => {
    const sorted = [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const { deviceType } = parseUA(sorted[0].userAgent);
    const savedName = sorted.find((s) => s.deviceName)?.deviceName ?? null;
    return {
      ip,
      sessions: sorted,
      hasCurrent: list.some((s) => s.isCurrent),
      deviceType,
      savedName,
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DevicesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ msg: string; error: boolean } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [expandedIps, setExpandedIps] = useState<Set<string>>(new Set());
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [savingName, setSavingName] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await authApi.getSessions();
      setSessions(data);
    } catch {
      setFeedback({ msg: t("devices.loadError"), error: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await authApi.revokeSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setFeedback({ msg: t("devices.revokeSuccess"), error: false });
    } catch {
      setFeedback({ msg: t("devices.revokeError"), error: true });
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAll = async (ip: string) => {
    const ids = sessions.filter((s) => s.ipAddress === ip && !s.isCurrent).map((s) => s.id);
    if (ids.length === 0) return;
    setRevoking(`ip:${ip}`);
    try {
      await Promise.all(ids.map((id) => authApi.revokeSession(id)));
      setSessions((prev) => prev.filter((s) => !(s.ipAddress === ip && !s.isCurrent)));
      setFeedback({ msg: t("devices.revokeOthersSuccess"), error: false });
    } catch {
      setFeedback({ msg: t("devices.revokeError"), error: true });
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeOthers = async () => {
    setRevoking("others");
    try {
      await authApi.revokeOtherSessions();
      await load();
      setFeedback({ msg: t("devices.revokeOthersSuccess"), error: false });
    } catch {
      setFeedback({ msg: t("devices.revokeError"), error: true });
    } finally {
      setRevoking(null);
    }
  };

  const handleSaveName = async (ip: string) => {
    const name = editingNames[ip] ?? "";
    setSavingName(ip);
    try {
      await authApi.nameDevice(ip, name);
      setSessions((prev) =>
        prev.map((s) => (s.ipAddress === ip ? { ...s, deviceName: name || null } : s)),
      );
      setEditingNames((prev) => { const n = { ...prev }; delete n[ip]; return n; });
      setFeedback({ msg: t("devices.nameSaved"), error: false });
    } catch {
      setFeedback({ msg: t("devices.nameSaveError"), error: true });
    } finally {
      setSavingName(null);
    }
  };

  const toggleExpand = (ip: string) => {
    setExpandedIps((prev) => {
      const next = new Set(prev);
      next.has(ip) ? next.delete(ip) : next.add(ip);
      return next;
    });
  };

  const devices = groupByIp(sessions);
  const hasOthers = sessions.some((s) => !s.isCurrent);

  return (
    <Container>
      <TopBar>
        <Button
          variant="secondary"
          size="small"
          onClick={() => navigate("/settings")}
        >
          <ArrowLeft size={20} />
        </Button>
        <Title>{t("devices.title")}</Title>
        {hasOthers && (
          <Button
            variant="danger"
            size="small"
            onClick={handleRevokeOthers}
            disabled={revoking === "others"}
          >
            <LogOut size={16} />
            {revoking === "others" ? t("common.loading") : t("devices.logoutAllOthers")}
          </Button>
        )}
      </TopBar>

      {feedback && <FeedbackText $error={feedback.error}>{feedback.msg}</FeedbackText>}

      <Section>
        <SectionHeader>
          <Shield size={18} style={{ color: "var(--color-primary)" }} />
          <SectionTitle>{t("devices.activeSessions")}</SectionTitle>
        </SectionHeader>

        {loading ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : devices.length === 0 ? (
          <EmptyState>{t("devices.noSessions")}</EmptyState>
        ) : (
          devices.map((device) => {
            const isExpanded = expandedIps.has(device.ip);
            const isEditingName = device.ip in editingNames;
            const nameValue = isEditingName
              ? editingNames[device.ip]
              : (device.savedName ?? "");
            const nonCurrentSessions = device.sessions.filter((s) => !s.isCurrent);

            return (
              <DeviceCard key={device.ip}>
                <DeviceRow>
                  <DeviceIcon $current={device.hasCurrent}>
                    <DeviceTypeIcon type={device.deviceType} current={device.hasCurrent} />
                  </DeviceIcon>

                  <DeviceInfo>
                    <DeviceIp>
                      {device.ip === "unknown" ? "—" : device.ip}
                      {device.hasCurrent && (
                        <CurrentBadge>{t("devices.currentDevice")}</CurrentBadge>
                      )}
                      <SessionCountBadge>
                        {device.sessions.length} {t("devices.sessions")}
                      </SessionCountBadge>
                    </DeviceIp>

                    <DeviceNameRow>
                      {isEditingName ? (
                        <>
                          <DeviceNameInput
                            autoFocus
                            value={nameValue}
                            placeholder={t("devices.deviceNamePlaceholder")}
                            onChange={(e) =>
                              setEditingNames((prev) => ({ ...prev, [device.ip]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveName(device.ip);
                              if (e.key === "Escape")
                                setEditingNames((prev) => { const n = { ...prev }; delete n[device.ip]; return n; });
                            }}
                          />
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => handleSaveName(device.ip)}
                            disabled={savingName === device.ip}
                            style={{ padding: "4px 8px" }}
                          >
                            <Check size={13} />
                            {t("devices.saveName")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <DeviceNameText>
                            {device.savedName || t("devices.deviceName")}
                          </DeviceNameText>
                          <button
                            onClick={() =>
                              setEditingNames((prev) => ({
                                ...prev,
                                [device.ip]: device.savedName ?? "",
                              }))
                            }
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: "2px",
                              color: "inherit",
                              opacity: 0.5,
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                        </>
                      )}
                    </DeviceNameRow>
                  </DeviceInfo>

                  <DeviceActions>
                    {nonCurrentSessions.length > 0 && (
                      <Button
                        variant="danger"
                        size="small"
                        onClick={() => handleRevokeAll(device.ip)}
                        disabled={revoking === `ip:${device.ip}`}
                      >
                        {revoking === `ip:${device.ip}` ? "..." : t("devices.revokeAll")}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => toggleExpand(device.ip)}
                      style={{ display: "flex", alignItems: "center", gap: 4 }}
                    >
                      {t("devices.details")}
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </Button>
                  </DeviceActions>
                </DeviceRow>

                {isExpanded && (
                  <SessionsExpanded>
                    {device.sessions.map((session) => {
                      const { deviceType, os, browser } = parseUA(session.userAgent);
                      return (
                        <SessionRow key={session.id}>
                          <SessionInfo>
                            <SessionName>
                              {browser} — {os}
                              {session.isCurrent && (
                                <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 6px", borderRadius: 8, background: "var(--color-primary)", color: "#fff" }}>
                                  {t("devices.currentDevice")}
                                </span>
                              )}
                              {!session.isCurrent && (
                                <span style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3, color: "var(--color-success)" }}>
                                  <Wifi size={10} />
                                  {t("devices.active")}
                                </span>
                              )}
                            </SessionName>
                            <SessionMeta>
                              {t("devices.loginAt")}: {formatDate(session.createdAt)}
                            </SessionMeta>
                          </SessionInfo>
                          {!session.isCurrent && (
                            <Button
                              variant="danger"
                              size="small"
                              onClick={() => handleRevoke(session.id)}
                              disabled={revoking === session.id}
                            >
                              {revoking === session.id ? "..." : t("devices.revoke")}
                            </Button>
                          )}
                        </SessionRow>
                      );
                    })}
                  </SessionsExpanded>
                )}
              </DeviceCard>
            );
          })
        )}
      </Section>
    </Container>
  );
}
