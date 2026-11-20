import type {
  Page,
  ReportPeriod,
  StaffCreate,
  StaffUpdate,
} from "../domain/operations.schemas";

type ExportFormat = "csv" | "xlsx";

export abstract class StaffService {
  abstract create(userId: string, input: StaffCreate): Promise<unknown>;
  abstract list(userId: string, page: Page): Promise<unknown[]>;
  abstract update(
    userId: string,
    staffId: string,
    input: StaffUpdate,
  ): Promise<unknown>;
  abstract createGate(
    userId: string,
    eventId: string,
    input: { name: string; locationDesc?: string | undefined },
  ): Promise<unknown>;
  abstract listGates(
    userId: string,
    eventId: string,
    page: Page,
  ): Promise<unknown[]>;
  abstract assign(
    userId: string,
    eventId: string,
    input: { userId: string; gateId: string },
  ): Promise<unknown>;
  abstract assignments(
    userId: string,
    eventId: string,
    page: Page,
  ): Promise<unknown[]>;
  abstract unassign(
    userId: string,
    eventId: string,
    staffId: string,
  ): Promise<unknown>;
}

export abstract class ReportsService {
  abstract report(
    userId: string,
    eventId: string,
    period: ReportPeriod,
  ): Promise<unknown>;
  abstract breakdown(
    userId: string,
    eventId: string,
    filter: Page & ReportPeriod,
    kind: "buyers" | "vouchers",
  ): Promise<unknown[]>;
  abstract checkinSummary(userId: string, eventId: string): Promise<unknown>;
  abstract history(
    userId: string,
    eventId: string,
    page: Page,
  ): Promise<unknown[]>;
  abstract createExport(
    userId: string,
    eventId: string,
    format: ExportFormat,
    period: ReportPeriod,
  ): Promise<unknown>;
  abstract listExports(
    userId: string,
    eventId: string,
    page: Page,
  ): Promise<unknown[]>;
  abstract exportStatus(
    userId: string,
    eventId: string,
    exportId: string,
  ): Promise<{
    id: string;
    status: string;
    format: ExportFormat;
    createdAt: Date;
    expiresAt: Date | null;
    ticketTypeId: string | null;
    voucherCode: string | null;
    fromDate: string | null;
    toDate: string | null;
    errorMessage: string | null;
  }>;
  abstract download(
    userId: string,
    eventId: string,
    exportId: string,
  ): Promise<{ id: string; format: ExportFormat; filePath: string }>;
}
