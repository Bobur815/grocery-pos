import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled, { keyframes } from "styled-components";
import { Table } from "@components/common/Table";
import { Button } from "@components/common/Button";
import { ConfirmDialog } from "@components/common/ConfirmDialog";
import { formatDate } from "../../utils/formatters";
import { UserFormModal } from "./UserFormModal";
import { users as usersApi } from "../../api/client";
import { useAuthStore } from "../../store/auth-store";
import type { UserListItem } from "@shared/types";
import { Edit, UserCheck, UserX, Plus, ArrowLeft } from "lucide-react";
import {
  MobileCard,
  MobileCardList,
  DesktopOnly,
} from "../../components/common/MobileCard";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
    gap: ${({ theme }) => theme.spacing.sm};
  }
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.75rem;
  color: ${({ theme }) => theme.colors.text};

  @media (max-width: 768px) {
    font-size: 1.5rem;
  }
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

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb, 59, 130, 246), 0.5); }
  70% { box-shadow: 0 0 0 12px rgba(var(--primary-rgb, 59, 130, 246), 0); }
  100% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb, 59, 130, 246), 0); }
`;

const FAB = styled.button`
  position: fixed;
  bottom: 50px;
  right: 16px;
  z-index: 100;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: none;
  background-color: ${({ theme }) => theme.colors.primary};
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  animation: ${pulse} 2s ease-out infinite;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    transform: scale(1.1);
  }

  &:active {
    transform: scale(0.95);
  }
`;

export function UserList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userToToggle, setUserToToggle] = useState<UserListItem | null>(null);
  // Add and edit both happen in a modal over this list, matching the POS terminal and supplier
  // management. `user` undefined means "create".
  const [formState, setFormState] = useState<{
    open: boolean;
    user?: UserListItem;
  }>({ open: false });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await usersApi.getAll();
      setUsers(data as UserListItem[]);
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // ADMIN cannot deactivate other ADMINs (only SUPER_ADMIN can)
  const canToggle = (user: UserListItem) =>
    currentUser?.role === "SUPER_ADMIN" || user.role !== "ADMIN";

  const handleToggleActive = async (user: UserListItem) => {
    try {
      await usersApi.update(user.id, { active: !user.active });
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
            onClick={() => setFormState({ open: true, user })}
          >
            <Edit size={18} />
          </Button>
          {canToggle(user) && (
            <Button
              size="small"
              variant={user.active ? "danger" : "primary"}
              tooltip={
                user.active ? t("users.deactivate") : t("users.activate")
              }
              onClick={() => setUserToToggle(user)}
            >
              {user.active ? <UserX size={18} /> : <UserCheck size={18} />}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Container>
      <Header>
        <Button
          variant="secondary"
          size="small"
          onClick={() => navigate("/settings")}
        >
          <ArrowLeft size={20} />
        </Button>
        <Title>{t("users.title")}</Title>
      </Header>

      <MobileCardList>
        {users.map((user) => (
          <MobileCard
            key={user.id}
            title={i18n.language === "uz" ? user.nameUz : user.nameRu}
            subtitle={user.phone}
            fields={[
              {
                label: t("users.role"),
                value: (
                  <RoleBadge $role={user.role}>
                    {user.role === "ADMIN"
                      ? t("users.admin")
                      : t("users.cashier")}
                  </RoleBadge>
                ),
              },
              {
                label: t("users.status"),
                value: (
                  <Badge $active={user.active}>
                    {user.active ? t("users.active") : t("users.inactive")}
                  </Badge>
                ),
              },
              {
                label: t("users.createdAt"),
                value: formatDate(user.createdAt),
              },
            ]}
            actions={
              <>
                <Button
                  size="small"
                  variant="secondary"
                  tooltip={t("common.edit")}
                  onClick={() => setFormState({ open: true, user })}
                >
                  <Edit size={18} />
                </Button>
                {canToggle(user) && (
                  <Button
                    size="small"
                    variant={user.active ? "danger" : "primary"}
                    tooltip={
                      user.active ? t("users.deactivate") : t("users.activate")
                    }
                    onClick={() => setUserToToggle(user)}
                  >
                    {user.active ? (
                      <UserX size={18} />
                    ) : (
                      <UserCheck size={18} />
                    )}
                  </Button>
                )}
              </>
            }
          />
        ))}
      </MobileCardList>

      <DesktopOnly>
        <Table
          columns={columns}
          data={users}
          loading={isLoading}
          emptyMessage={t("users.noUsers")}
        />
      </DesktopOnly>
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
      {formState.open && (
        <UserFormModal
          // Remount on target change so the form rebuilds from the user being edited rather than
          // carrying state over from whoever was open before.
          key={formState.user?.id ?? "new"}
          user={formState.user}
          onClose={() => setFormState({ open: false })}
          onSaved={loadUsers}
        />
      )}

      <FAB onClick={() => setFormState({ open: true })}>
        <Plus size={38} />
      </FAB>
    </Container>
  );
}
