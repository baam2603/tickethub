import { OperationsModule } from "./contexts/operations/operations.module";
import { Module } from "@nestjs/common";
import { RedisModule } from "./database/redis.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./contexts/identity/identity.module";
import { EventModule } from "./contexts/event/event.module";
import { BookingModule } from "./contexts/booking/booking.module";
import { PaymentModule } from "./contexts/payment/payment.module";
import { ModerationModule } from "./contexts/moderation/moderation.module";
import { UploadModule } from "./contexts/upload/upload.module";
import { SearchModule } from "./contexts/search/search.module";
import { RefundModule } from "./contexts/refund/refund.module";
import { TicketingModule } from "./contexts/ticketing/ticketing.module";
import { VenueModule } from "./contexts/venue/venue.module";
import { PayoutModule } from "./contexts/payout/payout.module";
@Module({
  imports: [
    RedisModule,
    HealthModule,
    IdentityModule,
    OperationsModule,
    EventModule,
    BookingModule,
    PaymentModule,
    ModerationModule,
    UploadModule,
    SearchModule,
    RefundModule,
    TicketingModule,
    VenueModule,
    PayoutModule,
  ],
})
export class AppModule {}
