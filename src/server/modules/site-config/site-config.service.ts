import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LoginBanner {
  imageUrl: string;
  title: string;
  subtitle: string;
}

export interface SubscriptionPlanPrices {
  starter: number;
  pro: number;
  vip: number;
}

/**
 * How a store pays for its subscription, as shown on the POS login screen.
 *
 * `qrPayload` is the raw bank-transfer string; the terminal renders it into a QR itself so the
 * dialog still works with no network. `paymentUrl` is the self-service Click/Payme/Paynet link
 * and may contain a `{storeId}` placeholder, substituted per store when it is served.
 */
export interface SubscriptionPayment {
  qrPayload: string;
  paymentUrl: string;
  supportPhone: string;
}

const BANNER_KEY = 'login_banner';
const PAYMENT_KEY = 'subscription_payment';
const DEFAULT: LoginBanner = { imageUrl: '', title: '', subtitle: '' };
const DEFAULT_PRICES: SubscriptionPlanPrices = { starter: 0, pro: 0, vip: 0 };
const DEFAULT_PAYMENT: SubscriptionPayment = { qrPayload: '', paymentUrl: '', supportPhone: '' };

@Injectable()
export class SiteConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getLoginBanner(): Promise<LoginBanner> {
    const row = await this.prisma.siteConfig.findUnique({ where: { key: BANNER_KEY } });
    if (!row) return DEFAULT;
    try {
      return JSON.parse(row.value) as LoginBanner;
    } catch {
      return DEFAULT;
    }
  }

  async setLoginBanner(banner: LoginBanner): Promise<LoginBanner> {
    await this.prisma.siteConfig.upsert({
      where: { key: BANNER_KEY },
      update: { value: JSON.stringify(banner) },
      create: { key: BANNER_KEY, value: JSON.stringify(banner) },
    });
    return banner;
  }

  async getSubscriptionPlans(): Promise<SubscriptionPlanPrices> {
    const rows = await this.prisma.siteConfig.findMany({
      where: { key: { in: ['subscription_price_starter', 'subscription_price_pro', 'subscription_price_vip'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
    return {
      starter: map['subscription_price_starter'] ?? DEFAULT_PRICES.starter,
      pro: map['subscription_price_pro'] ?? DEFAULT_PRICES.pro,
      vip: map['subscription_price_vip'] ?? DEFAULT_PRICES.vip,
    };
  }

  async setSubscriptionPlans(prices: SubscriptionPlanPrices): Promise<SubscriptionPlanPrices> {
    const entries: Array<{ key: string; value: string }> = [
      { key: 'subscription_price_starter', value: String(Math.round(prices.starter)) },
      { key: 'subscription_price_pro', value: String(Math.round(prices.pro)) },
      { key: 'subscription_price_vip', value: String(Math.round(prices.vip)) },
    ];
    await Promise.all(
      entries.map((e) =>
        this.prisma.siteConfig.upsert({
          where: { key: e.key },
          update: { value: e.value },
          create: { key: e.key, value: e.value },
        }),
      ),
    );
    return prices;
  }

  async getSubscriptionPayment(): Promise<SubscriptionPayment> {
    const row = await this.prisma.siteConfig.findUnique({ where: { key: PAYMENT_KEY } });
    if (!row) return DEFAULT_PAYMENT;
    try {
      return { ...DEFAULT_PAYMENT, ...(JSON.parse(row.value) as Partial<SubscriptionPayment>) };
    } catch {
      return DEFAULT_PAYMENT;
    }
  }

  async setSubscriptionPayment(payment: SubscriptionPayment): Promise<SubscriptionPayment> {
    const value = JSON.stringify(payment);
    await this.prisma.siteConfig.upsert({
      where: { key: PAYMENT_KEY },
      update: { value },
      create: { key: PAYMENT_KEY, value },
    });
    return payment;
  }
}
