import { Module } from "@nestjs/common";
import { RedisModule } from "./database/redis.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { EventsModule } from "./events/events.module";
import { BookingModule } from "./booking/booking.module";
import { PaymentsModule } from "./payments/payments.module";
import { AdminModule } from "./admin/admin.module";
import { UploadsModule } from "./uploads/uploads.module";
import { SearchModule } from "./search/search.module";
import { RefundsModule } from "./refunds/refunds.module";
import { TicketsModule } from "./tickets/tickets.module";
import { VenuesModule } from "./venues/venues.module";
import { PayoutsModule } from "./payouts/payouts.module";
@Module({
  imports: [
    RedisModule,
    HealthModule,
    AuthModule,
    EventsModule,
    BookingModule,
    PaymentsModule,
    AdminModule,
    UploadsModule,
    SearchModule,
    RefundsModule,
    TicketsModule,
    VenuesModule,
    PayoutsModule,
  ],
})
export class AppModule {}
