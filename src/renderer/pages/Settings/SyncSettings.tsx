import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { ArrowLeft, RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";
import { Button } from "../../components/common/Button";

const Container = styled.div`
  max-width: 600px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding-left: 25px;
`;

const BackButton = styled(Button)``;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Section = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;

const SectionTitle = styled.h2`
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  font-size: 18px;
  color: ${({ theme }) => theme.colors.text};
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${({ theme }) => theme.spacing.sm} 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const RowLabel = styled.span`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const RowValue = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const StatusBadge = styled.div<{
  $status: "syncing" | "ok" | "error" | "idle";
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background-color: ${({ theme, $status }) => {
    if ($status === "syncing") return theme.colors.primary + "20";
    if ($status === "ok") return theme.colors.success + "20";
    if ($status === "error") return theme.colors.error + "20";
    return theme.colors.border;
  }};
  color: ${({ theme, $status }) => {
    if ($status === "syncing") return theme.colors.primary;
    if ($status === "ok") return theme.colors.success;
    if ($status === "error") return theme.colors.error;
    return theme.colors.textSecondary;
  }};
`;

const ErrorText = styled.p`
  margin: ${({ theme }) => theme.spacing.sm} 0 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.error};
  word-break: break-all;
`;

const Actions = styled.div`
  margin-top: ${({ theme }) => theme.spacing.md};
`;

interface SyncStatus {
  isSyncing: boolean;
  lastSyncTime: string | null;
  lastError: string | null;
  vpsApiUrl?: string;
}

export function SyncSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SyncStatus>({
    isSyncing: false,
    lastSyncTime: null,
    lastError: null,
  });
  const [vpsUrl, setVpsUrl] = useState("");
  const [syncInterval, setSyncInterval] = useState("");

  useEffect(() => {
    loadAll();
    // Poll status every 3 seconds while visible
    const poll = setInterval(loadStatus, 3000);
    return () => clearInterval(poll);
  }, []);

  const loadAll = async () => {
    await loadStatus();
    try {
      const allSettings = await window.electronAPI.settings.getAll();
      setSyncInterval(allSettings.sync_interval || "5");
    } catch {
      // ignore
    }
  };

  const loadStatus = async () => {
    try {
      const s = (await window.electronAPI.sync.getStatus()) as SyncStatus;
      setStatus(s);
      if (s.vpsApiUrl) setVpsUrl(s.vpsApiUrl);
    } catch {
      // ignore
    }
  };

  const handleSyncNow = async () => {
    try {
      await window.electronAPI.sync.trigger();
      await loadStatus();
    } catch (err) {
      console.error("Sync failed:", err);
    }
  };

  const getStatusBadge = () => {
    if (status.isSyncing)
      return (
        <StatusBadge $status="syncing">
          <RefreshCw
            size={13}
            style={{ animation: "spin 1s linear infinite" }}
          />
          {t("settings.syncing")}
        </StatusBadge>
      );
    if (status.lastError)
      return (
        <StatusBadge $status="error">
          <XCircle size={13} />
          {t("settings.syncFailed")}
        </StatusBadge>
      );
    if (status.lastSyncTime)
      return (
        <StatusBadge $status="ok">
          <CheckCircle size={13} />
          {t("settings.syncOk")}
        </StatusBadge>
      );
    return (
      <StatusBadge $status="idle">
        <Clock size={13} />
        {t("settings.syncNever")}
      </StatusBadge>
    );
  };

  return (
    <Container>
      <Header>
        <BackButton variant="secondary" size="small" onClick={() => navigate("/settings")}>
          <ArrowLeft size={20} />
        </BackButton>
        <Title>{t("settings.syncSettings")}</Title>
      </Header>

      <Section>
        <SectionTitle>{t("settings.syncStatus")}</SectionTitle>

        <Row>
          <RowLabel>{t("settings.status")}</RowLabel>
          <RowValue>{getStatusBadge()}</RowValue>
        </Row>

        <Row>
          <RowLabel>{t("settings.lastSync")}</RowLabel>
          <RowValue>
            {status.lastSyncTime
              ? new Date(status.lastSyncTime).toLocaleString()
              : t("settings.never")}
          </RowValue>
        </Row>

        <Row>
          <RowLabel>{t("settings.syncInterval")}</RowLabel>
          <RowValue>
            {syncInterval} {t("settings.minutes")}
          </RowValue>
        </Row>

        <Row>
          <RowLabel>{t("settings.vpsApiUrl")}</RowLabel>
          <RowValue style={{ fontFamily: "monospace", fontSize: 12 }}>
            {vpsUrl}
          </RowValue>
        </Row>

        {status.lastError && (
          <ErrorText>
            {t(status.lastError, { defaultValue: status.lastError })}
          </ErrorText>
        )}

        <Actions>
          <Button
            onClick={handleSyncNow}
            disabled={status.isSyncing}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: status.isSyncing
                  ? "spin 1s linear infinite"
                  : "none",
              }}
            />
            {status.isSyncing ? t("settings.syncing") : t("settings.syncNow")}
          </Button>
        </Actions>
      </Section>
    </Container>
  );
}
