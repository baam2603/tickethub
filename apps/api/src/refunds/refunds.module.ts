import { Module } from "@nestjs/common";
import { RefundsController } from "./refunds.controller";
import { RefundsService } from "./refunds.service";
import { EventsModule } from "../events/events.module";

@Module({
  imports: [EventsModule],
  controllers: [RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
