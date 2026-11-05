import { Module } from "@nestjs/common";
import { RedisModule } from "./database/redis.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { EventsModule } from "./events/events.module";
import { WaitingRoomModule } from "./waiting-room/waiting-room.module";
import { BookingModule } from "./booking/booking.module";
import { PaymentsModule } from "./payments/payments.module";
import { AdminModule } from "./admin/admin.module";
import { UploadsModule } from "./uploads/uploads.module";
import { SearchModule } from "./search/search.module";
import { RefundsModule } from "./refunds/refunds.module";
import { TicketsModule } from "./tickets/tickets.module";
@Module({
  imports: [
    RedisModule,
    HealthModule,
    AuthModule,
    EventsModule,
    WaitingRoomModule,
    BookingModule,
    PaymentsModule,
    AdminModule,
    UploadsModule,
    SearchModule,
    RefundsModule,
    TicketsModule,
  ],
})
export class AppModule {}
