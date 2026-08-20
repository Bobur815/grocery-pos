import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import {
  UserCog,
  Settings,
  Users,
  MonitorSmartphone,
} from "lucide-react";
import { useAuthStore } from "../../store/auth-store";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.75rem;
  color: ${({ theme }) => theme.colors.text};

  @media (max-width: 768px) {
    font-size: 1.5rem;
  }
`;

const SettingsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
`;

const SettingsCard = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    box-shadow: ${({ theme }) => theme.shadows.md};
    transform: translateY(-2px);
  }
`;

const CardIcon = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.primary};
`;

const CardTitle = styled.h3`
  margin: 0 0 ${({ theme }) => theme.spacing.xs};
  color: ${({ theme }) => theme.colors.text};
`;

const CardDescription = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const settingsSections = [
    // /users is `excludeSuperAdmin`, so only offer it to a plain store admin —
    // a SUPER_ADMIN clicking through would just be bounced to /admin/stores.
    ...(user?.role === "ADMIN"
      ? [
          {
            icon: <Users size={32} />,
            title: t("nav.users"),
            description: t("settings.usersDescription"),
            path: "/users",
          },
        ]
      : []),
    {
      icon: <UserCog size={32} />,
      title: t("settings.userSettings"),
      description: t("settings.userSettingsDescription"),
      path: "/settings/user",
    },
    {
      icon: <Settings size={32} />,
      title: t("settings.systemSettings"),
      description: t("settings.systemSettingsDescription"),
      path: "/settings/system",
    },
    {
      icon: <MonitorSmartphone size={32} />,
      title: t("settings.devicesSettings"),
      description: t("settings.devicesSettingsDescription"),
      path: "/settings/devices",
    },
  ];

  return (
    <Container>
      <Title>{t("settings.title")}</Title>
      <SettingsGrid>
        {settingsSections.map((section) => (
          <SettingsCard
            key={section.path}
            onClick={() => navigate(section.path)}
          >
            <CardIcon>{section.icon}</CardIcon>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </SettingsCard>
        ))}
      </SettingsGrid>
    </Container>
  );
}
