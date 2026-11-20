import type {
  ReportQuery,
  AdminSettlementExportQuery,
} from "../domain/settlement-report-query";

type ExportFormat = AdminSettlementExportQuery["format"];
export interface SettlementReportRow {
  groupKey: string;
  paidRevenue: string;
  refundedAmount: string;
  netRevenue: string;
  refreshedAt: string;
}

export abstract class SettlementOperations {
  abstract isActiveAdmin(userId: string): Promise<boolean>;
  abstract getInvestigations(
    eventId: string,
    page: number,
    limit: number,
  ): Promise<unknown>;
  abstract getInvestigationItems(
    eventId: string,
    caseId: string,
    page: number,
    limit: number,
  ): Promise<unknown>;
  abstract resolveInvestigations(
    eventId: string,
    adminId: string,
    reason: string,
  ): Promise<unknown>;
  abstract readAdminSettlementReport(
    query: ReportQuery,
  ): Promise<SettlementReportRow[]>;
  abstract renderAdminSettlementDownload(
    items: SettlementReportRow[],
    format: ExportFormat,
  ): Promise<Buffer>;
  abstract enqueueAdminSettlementExport(
    adminId: string,
    query: AdminSettlementExportQuery,
  ): Promise<unknown>;
  abstract listAdminSettlementExports(
    adminId: string,
    page: number,
    limit: number,
  ): Promise<unknown>;
  abstract downloadAdminSettlementExport(
    adminId: string,
    id: string,
  ): Promise<{ bytes: Buffer; format: ExportFormat }>;
  abstract closeEvent(eventId: string, adminId: string): Promise<unknown>;
  abstract releasePayout(
    id: string,
    reason: string,
    adminId: string,
  ): Promise<unknown>;
}
