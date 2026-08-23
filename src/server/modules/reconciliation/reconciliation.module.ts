import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { MoneyReconciliationService } from './money.service';

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationService, MoneyReconciliationService],
  exports: [ReconciliationService, MoneyReconciliationService],
})
export class ReconciliationModule {}
