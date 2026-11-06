import { Module } from "@nestjs/common";
import { BookingController } from "./booking.controller";
import { BookingService } from "./booking.service";
import { BuyerOrderController } from "./buyer-order.controller";
import { BuyerOrderService } from "./buyer-order.service";
import { BookingCleanupTask } from "./booking-cleanup.task";
import { AuthModule } from "../auth/auth.module";
import { EventsModule } from "../events/events.module";
@Module({
  imports: [AuthModule, EventsModule],
  controllers: [BookingController, BuyerOrderController],
  providers: [BookingService, BuyerOrderService, BookingCleanupTask],
  exports: [BookingService, BuyerOrderService],
})
export class BookingModule {}
