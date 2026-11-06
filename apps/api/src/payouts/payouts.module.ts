import { Module } from "@nestjs/common";
import { PayoutsService } from "./payouts.service";
import { ReconciliationsService } from "./reconciliations.service";
import { AdminPayoutsController } from "./admin-payouts.controller";
import { OrganizerPayoutsController } from "./organizer-payouts.controller";

@Module({
  controllers: [AdminPayoutsController, OrganizerPayoutsController],
  providers: [PayoutsService, ReconciliationsService],
  exports: [PayoutsService, ReconciliationsService],
})
export class PayoutsModule {}
