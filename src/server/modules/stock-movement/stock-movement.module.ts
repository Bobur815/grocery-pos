import { Global, Module } from '@nestjs/common';
import { StockMovementService } from './stock-movement.service';

/**
 * Global like PrismaModule: the ledger is a cross-cutting concern that inventory, sales,
 * inventory-count and suppliers all emit into. Making it global avoids four separate imports
 * and the circular-dependency risk that comes with them.
 */
@Global()
@Module({
  providers: [StockMovementService],
  exports: [StockMovementService],
})
export class StockMovementModule {}
