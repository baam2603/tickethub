import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { HoldPayoutSchema, UserRole } from "@tickethub/shared";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../identity/interface/decorators/current-user.decorator";
import { Roles } from "../../identity/interface/decorators/roles.decorator";
import { JwtAuthGuard } from "../../identity/interface/guards/jwt-auth.guard";
import { RolesGuard } from "../../identity/interface/guards/roles.guard";
import { SettlementOperations } from "../application/settlement-operations";
import { ActiveSettlementAdminGuard } from "./active-settlement-admin.guard";
import {
  AdminSettlementReportQuery,
  type AdminSettlementExportQuery,
} from "../domain/settlement-report-query";

const PageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function parsePage(input: unknown) {
  const page = PageSchema.safeParse(input);
  if (!page.success) throw new BadRequestException("INVALID_PAGE");
  return page.data;
}

function settlementDownload(
  bytes: Buffer,
  format: AdminSettlementExportQuery["format"],
) {
  return new StreamableFile(bytes, {
    type:
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    disposition: `attachment; filename=settlement-report.${format}`,
  });
}

@Controller("api/v1/admin")
@UseGuards(JwtAuthGuard, RolesGuard, ActiveSettlementAdminGuard)
@Roles(UserRole.ADMIN)
export class SettlementController {
  constructor(
    @Inject(SettlementOperations)
    private readonly service: SettlementOperations,
  ) {}

  @Get("reconciliations/:eventId/investigations")
  async getInvestigations(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Query() query: unknown,
  ) {
    const { page, limit } = parsePage(query);
    const data = await this.service.getInvestigations(eventId, page, limit);
    return { success: true, data };
  }

  @Get("reconciliations/:eventId/investigations/:caseId")
  async getInvestigationItems(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Query() query: unknown,
  ) {
    const { page, limit } = parsePage(query);
    const data = await this.service.getInvestigationItems(
      eventId,
      caseId,
      page,
      limit,
    );
    return { success: true, data };
  }

  @Post("reconciliations/:eventId/investigations/resolve")
  @HttpCode(HttpStatus.OK)
  async resolveInvestigations(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = HoldPayoutSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("INVALID_RESOLUTION");
    const data = await this.service.resolveInvestigations(
      eventId,
      user.userId,
      parsed.data.reason,
    );
    return { success: true, data };
  }

  @Get("settlement-report")
  async getSettlementReport(
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = AdminSettlementReportQuery.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException("INVALID_SETTLEMENT_REPORT_QUERY");
    const items = await this.service.readAdminSettlementReport(parsed.data);
    if (parsed.data.format !== "json") {
      reply.header("Cache-Control", "private, no-store");
      return settlementDownload(
        await this.service.renderAdminSettlementDownload(
          items,
          parsed.data.format,
        ),
        parsed.data.format,
      );
    }
    return {
      success: true,
      data: {
        items,
        groupBy: parsed.data.groupBy,
        timezone: "Asia/Ho_Chi_Minh",
      },
    };
  }

  @Post("settlement-report/exports")
  @HttpCode(HttpStatus.ACCEPTED)
  async createSettlementExport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = AdminSettlementReportQuery.safeParse(body);
    if (!parsed.success || parsed.data.format === "json")
      throw new BadRequestException("CSV_OR_XLSX_EXPORT_REQUIRED");
    const data = await this.service.enqueueAdminSettlementExport(user.userId, {
      ...parsed.data,
      format: parsed.data.format,
    });
    return { success: true, data };
  }

  @Get("settlement-report/exports")
  async listSettlementExports(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ) {
    const { page, limit } = parsePage(query);
    const data = await this.service.listAdminSettlementExports(
      user.userId,
      page,
      limit,
    );
    return { success: true, data };
  }

  @Get("settlement-report/exports/:id/download")
  async downloadSettlementExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { bytes, format } = await this.service.downloadAdminSettlementExport(
      user.userId,
      id,
    );
    reply.header("Cache-Control", "private, no-store");
    return settlementDownload(bytes, format);
  }

  @Post("events/:id/end")
  @HttpCode(HttpStatus.OK)
  async endEvent(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.service.closeEvent(id, user.userId);
    return { success: true, data };
  }

  @Post("payouts/:id/release")
  @HttpCode(HttpStatus.OK)
  async releasePayout(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = HoldPayoutSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException("INVALID_RELEASE_REASON");
    const data = await this.service.releasePayout(
      id,
      parsed.data.reason,
      user.userId,
    );
    return { success: true, data };
  }
}
