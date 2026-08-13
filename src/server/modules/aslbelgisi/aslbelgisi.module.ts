import { Module } from '@nestjs/common';
import { AslBelgisiController } from './aslbelgisi.controller';
import { AslBelgisiService } from './aslbelgisi.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AslBelgisiController],
  providers: [AslBelgisiService],
})
export class AslBelgisiModule {}
