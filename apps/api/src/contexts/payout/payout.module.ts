import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { PayoutCommands } from "./application/payout-commands.service";
import { PayoutQueries } from "./application/payout-queries.service";
import { ReconciliationQueries } from "./application/reconciliation-queries.service";
import { SettlementOperations } from "./application/settlement-operations";
import { AdminPayoutsController } from "./interface/admin-payouts.controller";
import { OrganizerPayoutsController } from "./interface/organizer-payouts.controller";
import { SettlementController } from "./interface/settlement.controller";
import { ActiveSettlementAdminGuard } from "./interface/active-settlement-admin.guard";
import { PayoutsService } from "./infrastructure/payouts.service";
import { ReconciliationsService } from "./infrastructure/reconciliations.service";
import {
  readAdminSettlementReport,
  renderAdminSettlementDownload,
} from "./infrastructure/admin-settlement-report";
import {
  enqueueAdminSettlementExport,
  listAdminSettlementExports,
  downloadAdminSettlementExport,
} from "./infrastructure/admin-settlement-exports";

@Module({
  imports: [IdentityModule],
  controllers: [
    AdminPayoutsController,
    OrganizerPayoutsController,
    SettlementController,
  ],
  providers: [
    ActiveSettlementAdminGuard,
    PayoutsService,
    ReconciliationsService,
    { provide: PayoutCommands, useExisting: PayoutsService },
    { provide: PayoutQueries, useExisting: PayoutsService },
    { provide: ReconciliationQueries, useExisting: ReconciliationsService },
    {
      provide: SettlementOperations,
      inject: [PayoutsService, ReconciliationsService],
      useFactory: (
        payouts: PayoutsService,
        reconciliation: ReconciliationsService,
      ): SettlementOperations => ({
        isActiveAdmin: (userId) => payouts.isActiveAdmin(userId),
        getInvestigations: (eventId, page, limit) =>
          reconciliation.getInvestigations(eventId, page, limit),
        getInvestigationItems: (eventId, caseId, page, limit) =>
          reconciliation.getInvestigationItems(eventId, caseId, page, limit),
        resolveInvestigations: (eventId, adminId, reason) =>
          reconciliation.resolveInvestigations(eventId, adminId, reason),
        readAdminSettlementReport,
        renderAdminSettlementDownload,
        enqueueAdminSettlementExport,
        listAdminSettlementExports,
        downloadAdminSettlementExport,
        closeEvent: (eventId, actor) => payouts.closeEvent(eventId, actor),
        releasePayout: (id, reason, actor) =>
          payouts.releasePayout(id, reason, actor),
      }),
    },
  ],
  exports: [PayoutCommands, PayoutQueries, ReconciliationQueries],
})
export class PayoutModule {}
