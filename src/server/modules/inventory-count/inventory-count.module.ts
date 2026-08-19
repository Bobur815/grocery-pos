import { Module } from '@nestjs/common';
import { InventoryCountController } from './inventory-count.controller';
import { InventoryCountService } from './inventory-count.service';

@Module({
  controllers: [InventoryCountController],
  providers: [InventoryCountService],
  exports: [InventoryCountService],
})
export class InventoryCountModule {}
