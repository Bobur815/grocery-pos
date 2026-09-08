import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Table } from "../../components/common/Table";
import { Button } from "../../components/common/Button";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { formatDate } from "../../utils/formatters";
import type { UserListItem } from "@shared/types";
import { ArrowLeft, Edit, Plus, UserCheck, UserX } from "lucide-react";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const BackButton = styled(Button)``;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-left: 25px;
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Badge = styled.span<{ $active?: boolean }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.success : theme.colors.error};
  color: white;
`;

const RoleBadge = styled.span<{ $role: string }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  background-color: ${({ theme, $role }) =>
    $role === "ADMIN" ? theme.colors.primary : theme.colors.secondary};
  color: white;
`;

export function UserList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userToToggle, setUserToToggle] = useState<UserListItem | null>(null);
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await window.electronAPI.users.getAll();
      setUsers(data as UserListItem[]);
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleActive = async (user: UserListItem) => {
    try {
      await window.electronAPI.users.update(user.id, { active: !user.active });
      loadUsers();
    } catch (error) {
      console.error("Failed to update user:", error);
    }
  };

  const columns = [
    { key: "phone", header: t("users.phone") },
    {
      key: "name",
      header: t("users.name"),
      render: (user: UserListItem) =>
        i18n.language === "uz" ? user.nameUz : user.nameRu,
    },
    {
      key: "role",
      header: t("users.role"),
      render: (user: UserListItem) => (
        <RoleBadge $role={user.role}>
          {user.role === "ADMIN" ? t("users.admin") : t("users.cashier")}
        </RoleBadge>
      ),
    },
    {
      key: "active",
      header: t("users.status"),
      render: (user: UserListItem) => (
        <Badge $active={user.active}>
          {user.active ? t("users.active") : t("users.inactive")}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: t("users.createdAt"),
      render: (user: UserListItem) => formatDate(user.createdAt),
    },
    {
      key: "actions",
      header: "",
      render: (user: UserListItem) => (
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            size="small"
            variant="secondary"
            tooltip={t("common.edit")}
            onClick={() => navigate(`/users/${user.id}/edit`)}
          >
            <Edit size={16} />
          </Button>
          <Button
            size="small"
            variant={user.active ? "danger" : "primary"}
            tooltip={user.active ? t("users.deactivate") : t("users.activate")}
            onClick={() => setUserToToggle(user)}
          >
            {user.active ? <UserX size={16} /> : <UserCheck size={16} />}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Container>
      <Header>
        <BackButton
          variant="secondary"
          size="small"
          onClick={() => navigate("/settings")}
        >
          <ArrowLeft size={20} />
        </BackButton>
        <Title>{t("users.title")}</Title>
        <Button onClick={() => navigate("/users/new")}>
          <Plus size={16} />
          {t("users.addUser")}
        </Button>
      </Header>

      <Table
        columns={columns}
        data={users}
        loading={isLoading}
        emptyMessage={t("users.noUsers")}
      />

      {userToToggle && (
        <ConfirmDialog
          title={
            userToToggle.active ? t("users.deactivate") : t("users.activate")
          }
          message={
            userToToggle.active
              ? t("users.deactivateConfirm", {
                  name:
                    i18n.language === "uz"
                      ? userToToggle.nameUz
                      : userToToggle.nameRu,
                })
              : t("users.activateConfirm", {
                  name:
                    i18n.language === "uz"
                      ? userToToggle.nameUz
                      : userToToggle.nameRu,
                })
          }
          confirmLabel={
            userToToggle.active ? t("users.deactivate") : t("users.activate")
          }
          cancelLabel={t("common.cancel")}
          variant={userToToggle.active ? "danger" : "primary"}
          onConfirm={() => {
            handleToggleActive(userToToggle);
            setUserToToggle(null);
          }}
          onCancel={() => setUserToToggle(null)}
        />
      )}
    </Container>
  );
}
