import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// The asl-belgisi registry keys a marking code on AIs 01 (GTIN) + 21 (serial) only; the trailing
// crypto group (AI 91/92/93) must be stripped or /codes returns an empty array. The rule now lives
// in shared/ so the POS main process applies exactly the same one.
import { stripCryptoTail } from '@shared/utils/marking';
import { PrismaService } from '../../prisma/prisma.service';

const ASL_BELGISI_BASE = 'https://xtrace.aslbelgisi.uz';

/** Per-store override of ASLBELGISI_API_KEY, rotated from the POS "Проверка маркировки" screen. */
const API_KEY_SETTING = 'aslbelgisi_api_key';
/** asl-belgisi issues business-account keys with a 3-month lifetime. */
const API_KEY_TTL_DAYS = 90;

/**
 * Error codes returned as the HTTP `message`. The global exception filter strips every field but
 * `message`, so the code has to travel inside it — the POS matches on these exact strings to show
 * a human-readable reason instead of a bare HTTP status.
 */
export const ASL_ERROR = {
  keyMissing: 'REGISTRY_KEY_MISSING',
  keyRejected: 'REGISTRY_KEY_REJECTED',
  unreachable: 'REGISTRY_UNREACHABLE',
  badResponse: 'REGISTRY_BAD_RESPONSE',
} as const;

export interface McPublicInfo {
  isValid: boolean;
  status?: string;
  extendedStatus?: string;
  gtin?: string;
  productId?: string;
  productionDate?: string;
  expirationDate?: string;
  productSeries?: string;
  packageType?: string;
  issuerName?: string;
}

export interface ApiKeyStatus {
  configured: boolean;
  /** 'store' = rotated from a terminal, 'env' = the deploy-time ASLBELGISI_API_KEY, 'none' = unset. */
  source: 'store' | 'env' | 'none';
  /** Last four characters, so an admin can tell which key is live without exposing it. */
  maskedKey?: string;
  /** When the store-level key was saved (absent for env keys — we don't know when those were issued). */
  updatedAt?: string;
  /** updatedAt + 90 days: asl-belgisi keys expire, and a dead key silently disables every check. */
  expiresAt?: string;
}

@Injectable()
export class AslBelgisiService {
  private readonly logger = new Logger(AslBelgisiService.name);
  private readonly envApiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.envApiKey = this.config.get<string>('ASLBELGISI_API_KEY') ?? '';
    this.logger.log(
      `Env API key configured: ${this.envApiKey ? 'YES (' + this.envApiKey.slice(0, 6) + '...)' : 'NO'}`,
    );
  }

  async verifyCode(markingCode: string, storeId?: string): Promise<McPublicInfo> {
    const { key } = await this.resolveApiKey(storeId);
    if (!key) {
      this.logger.error('No ASL BELGISI API key (neither store setting nor env)');
      throw new HttpException(ASL_ERROR.keyMissing, HttpStatus.SERVICE_UNAVAILABLE);
    }

    const lookupCode = stripCryptoTail(markingCode);
    if (lookupCode !== markingCode) {
      this.logger.log(`Stripped crypto tail: ${markingCode.length} → ${lookupCode.length} chars`);
    }
    this.logger.log(`Verifying MC (${lookupCode.length} chars): ${lookupCode.slice(0, 30)}...`);

    const { res, rawBody } = await this.callRegistry(key, lookupCode);
    this.logger.log(`ASL BELGISI status=${res.status} body=${rawBody.slice(0, 300)}`);

    if (!res.ok) {
      // 401/403 from xtrace means OUR key was refused — never pass that status through, or the POS
      // cannot tell a dead registry key from its own expired session token.
      if (res.status === 401 || res.status === 403) {
        this.logger.error(`ASL BELGISI rejected the API key: ${rawBody.slice(0, 200)}`);
        throw new HttpException(ASL_ERROR.keyRejected, HttpStatus.BAD_GATEWAY);
      }
      throw new HttpException(
        `ASL BELGISI returned ${res.status}: ${rawBody.slice(0, 200)}`,
        res.status,
      );
    }

    let data: any[];
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new HttpException(ASL_ERROR.badResponse, HttpStatus.BAD_GATEWAY);
    }

    if (!data?.length) return { isValid: false };

    const mc = data[0];
    return {
      isValid: true,
      status: mc.status,
      extendedStatus: mc.extendedStatus,
      gtin: mc.gtin,
      productId: mc.productId,
      productionDate: mc.productionDate,
      expirationDate: mc.expirationDate,
      productSeries: mc.productSeries,
      packageType: mc.packageType,
      issuerName: mc.issuerShortInfo?.issuerName?.ru,
    };
  }

  async getApiKeyStatus(storeId?: string): Promise<ApiKeyStatus> {
    const { key, source, updatedAt } = await this.resolveApiKey(storeId);
    if (!key) return { configured: false, source: 'none' };
    return {
      configured: true,
      source,
      maskedKey: maskKey(key),
      updatedAt: updatedAt?.toISOString(),
      expiresAt: updatedAt ? addDays(updatedAt, API_KEY_TTL_DAYS).toISOString() : undefined,
    };
  }

  /**
   * Store a freshly issued key for this store. Probed against xtrace first: saving a key that the
   * registry already refuses would just move the outage instead of fixing it.
   */
  async setApiKey(storeId: string, rawKey: string): Promise<ApiKeyStatus> {
    const key = (rawKey ?? '').trim();
    if (!key) throw new HttpException('EMPTY_KEY', HttpStatus.BAD_REQUEST);
    if (!storeId) throw new HttpException('NO_STORE', HttpStatus.BAD_REQUEST);

    // A syntactically valid but almost certainly unissued code: a working key answers 200 [],
    // a dead one answers 401 before it ever looks at the code.
    const { res, rawBody } = await this.callRegistry(key, '010000000000000021PROBE');
    if (res.status === 401 || res.status === 403) {
      this.logger.warn(`Rejected new API key for store ${storeId}: ${rawBody.slice(0, 200)}`);
      throw new HttpException(ASL_ERROR.keyRejected, HttpStatus.BAD_REQUEST);
    }
    if (!res.ok) {
      this.logger.warn(`Probe for new key returned ${res.status}: ${rawBody.slice(0, 200)}`);
      throw new HttpException(ASL_ERROR.unreachable, HttpStatus.BAD_GATEWAY);
    }

    await this.prisma.systemSetting.upsert({
      where: { storeId_key: { storeId, key: API_KEY_SETTING } },
      update: { value: key },
      create: { storeId, key: API_KEY_SETTING, value: key },
    });
    this.logger.log(`ASL BELGISI API key rotated for store ${storeId} (${maskKey(key)})`);

    return this.getApiKeyStatus(storeId);
  }

  /** Store-level key wins over the deploy-time env key, so a terminal can fix its own outage. */
  private async resolveApiKey(
    storeId?: string,
  ): Promise<{ key: string; source: 'store' | 'env' | 'none'; updatedAt?: Date }> {
    if (storeId) {
      try {
        const row = await this.prisma.systemSetting.findUnique({
          where: { storeId_key: { storeId, key: API_KEY_SETTING } },
        });
        if (row?.value?.trim()) {
          return { key: row.value.trim(), source: 'store', updatedAt: row.updatedAt };
        }
      } catch (e) {
        this.logger.error('Failed reading store API key, falling back to env', e);
      }
    }
    if (this.envApiKey) return { key: this.envApiKey, source: 'env' };
    return { key: '', source: 'none' };
  }

  private async callRegistry(
    apiKey: string,
    lookupCode: string,
  ): Promise<{ res: Response; rawBody: string }> {
    let res: Response;
    try {
      res = await fetch(`${ASL_BELGISI_BASE}/public/api/cod/public/codes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ codes: [lookupCode], addCodeHistory: false }),
      });
    } catch (e) {
      this.logger.error('Network error reaching ASL BELGISI', e);
      throw new HttpException(ASL_ERROR.unreachable, HttpStatus.BAD_GATEWAY);
    }
    return { res, rawBody: await res.text() };
  }
}

function maskKey(key: string): string {
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
