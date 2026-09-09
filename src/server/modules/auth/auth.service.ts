import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload, LoginResponse } from './types/auth.types';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { dashboardLoginBlockReason, type LoginClient } from './dashboard-access';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(loginDto: LoginDto, userAgent?: string, ipAddress?: string): Promise<LoginResponse> {
    const { storeId, phone, password } = loginDto;

    const user = await this.usersService.findByPhoneAndStore(phone, storeId);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (user.role !== UserRole.SUPER_ADMIN && !user.storeId) {
      throw new UnauthorizedException('User is not assigned to any store');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.assertStoreCanUseDashboard(user.role, user.storeId, loginDto.client);

    const deviceName = await this.resolveDeviceName(user.id, ipAddress);
    const session = await this.prisma.userSession.create({
      data: { userId: user.id, userAgent, ipAddress, deviceName },
    });

    const payload: JwtPayload = {
      sub: user.id,
      storeId: user.storeId,
      phone: user.phone,
      role: user.role,
      sessionId: session.id,
    };

    const token = this.jwtService.sign(payload);

    return {
      token,
      user: {
        id: user.id,
        storeId: user.storeId,
        phone: user.phone,
        role: user.role,
        nameUz: user.nameUz,
        nameRu: user.nameRu,
      },
    };
  }

  /**
   * Refuse a dashboard login when the store itself cannot be managed from here.
   *
   * The rule lives in `dashboard-access.ts` so it can be tested without Nest; this method is only
   * the database read and the HTTP shape around it.
   *
   * Checked after the password on purpose: a wrong password must not reveal whether a store
   * exists or what state it is in. Checked here rather than only in the browser because the token
   * is what actually grants access — a UI-only block leaves every endpoint reachable.
   */
  private async assertStoreCanUseDashboard(
    role: UserRole,
    storeId: string | null,
    client: LoginClient = 'dashboard',
  ): Promise<void> {
    if (role === UserRole.SUPER_ADMIN || !storeId) return;

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { active: true, mode: true },
    });

    const reason = dashboardLoginBlockReason(role, storeId, store, client);
    if (!reason) return;

    // 403, not 401: the browser's axios interceptor turns a 401 into a logout and a redirect,
    // which reloads the login page and wipes the explanation before it can be read.
    throw new ForbiddenException(reason);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.usersService.findById(userId);

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('invalid_password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePassword(userId, hashedPassword);

    return { success: true };
  }

  async validateUser(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active) {
      return null;
    }

    // Re-check the store on every request, not just at login. Otherwise deactivating a store — or
    // switching it to OFFLINE_ONLY — leaves everyone already signed in working normally until
    // their token expires, which for an eight-hour token is most of a working day.
    //
    // `user.store` rides along on the query above, so this costs no extra round trip.
    //
    // Returning null yields a 401, which is what we want: the browser's interceptor clears the
    // session and sends them to the login page, where the next attempt explains why in a toast.
    // Throwing 403 here instead would leave them nominally signed in with every request failing.
    if (dashboardLoginBlockReason(user.role, user.storeId, user.store)) {
      return null;
    }

    if (payload.sessionId) {
      const session = await this.prisma.userSession.findUnique({
        where: { id: payload.sessionId },
      });
      if (!session || session.isRevoked) {
        return null;
      }
    }

    return { ...user, storeId: payload.storeId, sessionId: payload.sessionId };
  }

  async getSessions(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId, isRevoked: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(sessionId: string, userId: string) {
    const session = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new UnauthorizedException('Session not found');
    }
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { isRevoked: true },
    });
    return { success: true };
  }

  async revokeOtherSessions(currentSessionId: string, userId: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, isRevoked: false, id: { not: currentSessionId } },
      data: { isRevoked: true },
    });
    return { success: true };
  }

  async nameDevice(userId: string, ipAddress: string, name: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, ipAddress, isRevoked: false },
      data: { deviceName: name.trim() || null },
    });
    return { success: true };
  }

  private async resolveDeviceName(userId: string, ipAddress?: string): Promise<string | null> {
    if (!ipAddress) return null;
    const prev = await this.prisma.userSession.findFirst({
      where: { userId, ipAddress, deviceName: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { deviceName: true },
    });
    return prev?.deviceName ?? null;
  }
}
