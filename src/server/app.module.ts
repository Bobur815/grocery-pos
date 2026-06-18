import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { SalesModule } from './modules/sales/sales.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { StoresModule } from './modules/stores/stores.module';
import { InvoiceScannerModule } from './modules/invoice-scanner/invoice-scanner.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { SettingsModule } from './modules/settings/settings.module';
import { MxikModule } from './modules/mxik/mxik.module';
import { TerminalsModule } from './modules/terminals/terminals.module';
import { LogsModule } from './modules/logs/logs.module';
import { SiteConfigModule } from './modules/site-config/site-config.module';
import { PaynetModule } from './modules/paynet/paynet.module';
import { AslBelgisiModule } from './modules/aslbelgisi/aslbelgisi.module';
import { MarkingCodesModule } from './modules/marking-codes/marking-codes.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CategoriesModule,
    SettingsModule,
    SalesModule,
    InventoryModule,
    AnalyticsModule,
    TelegramModule,
    SuppliersModule,
    StoresModule,
    InvoiceScannerModule,
    MxikModule,
    TerminalsModule,
    LogsModule,
    SiteConfigModule,
    PaynetModule,
    AslBelgisiModule,
    MarkingCodesModule,
  ],
})
export class AppModule {}
