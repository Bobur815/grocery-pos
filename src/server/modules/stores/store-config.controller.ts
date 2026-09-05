import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentStore } from '../../common/decorators/current-store.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const AI_TOKEN_LIMIT_FREE = 5;
const AI_TOKEN_LIMIT_PAID = 100;

@ApiTags('store-config')
@Controller('store-config')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class StoreConfigController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get server-controlled config for the current store' })
  async getConfig(@CurrentStore() storeId: string) {
    const store = storeId
      ? await this.prisma.store.findUnique({
          where: { id: storeId },
          select: { aiPlan: true, mode: true, posAdminLocked: true },
        })
      : null;

    return {
      ai_token_limit_daily: store?.aiPlan === 'paid' ? AI_TOKEN_LIMIT_PAID : AI_TOKEN_LIMIT_FREE,
      // Terminal operating mode. A terminal that can't resolve its store must keep behaving as it
      // does today, so an unknown store yields ONLINE + unlocked rather than a restricted terminal.
      mode: store?.mode ?? 'ONLINE',
      pos_admin_locked: store?.posAdminLocked ?? false,
    };
  }
}
