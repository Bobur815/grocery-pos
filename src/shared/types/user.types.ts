import { UserRole } from '../constants/roles';

export interface User {
  id: string;
  storeId: string | null; // Null for SUPER_ADMIN
  phone: string;
  nameUz: string;
  nameRu: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCreateInput {
  storeId: string;
  phone: string;
  password: string;
  nameUz: string;
  nameRu: string;
  role?: UserRole;
}

export interface UserUpdateInput {
  phone?: string;
  password?: string;
  nameUz?: string;
  nameRu?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UserLoginInput {
  phone: string;
  password: string;
  storeId?: string; // Optional: for store-scoped login
}

export interface AuthResponse {
  accessToken: string;
  user: Omit<User, 'createdAt' | 'updatedAt'>;
}

export interface CurrentUser {
  id: string;
  storeId: string | null;
  phone: string;
  nameUz: string;
  nameRu: string;
  role: UserRole;
}

/** User object returned by the local auth API (login/restoreSession) */
export interface AuthUser {
  id: string;
  phone: string;
  role: UserRole;
  nameUz: string;
  nameRu: string;
}

/** User object returned by users:getAll IPC (matches DB select) */
export interface UserListItem {
  id: string;
  phone: string;
  nameRu: string;
  nameUz: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  /**
   * Whether a quick-login PIN is set. The hash itself never leaves the main process — auth-handlers
   * maps the stored pin to this boolean — so an empty PIN field on an edit form means "leave it as
   * it is", never "clear it".
   */
  hasPin?: boolean;
}
