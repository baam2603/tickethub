import {
  Controller,
  Inject,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
  HttpCode,
  HttpStatus,
  StreamableFile,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ActiveSettlementAdminGuard } from "./active-settlement-admin.guard";
import { PayoutsService } from "./payouts.service";
import { ReconciliationsService } from "./reconciliations.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import {
  UserRole,
  ReconciliationQuerySchema,
  PayoutFilterQuerySchema,
  GeneratePayoutSchema,
  HoldPayoutSchema,
} from "@tickethub/shared";

import {
  AdminSettlementReportQuery,
  readAdminSettlementReport,
  renderAdminSettlementDownload,
  type AdminSettlementExportQuery,
} from "../reporting/admin-settlement-report";

import {
  downloadAdminSettlementExport,
  enqueueAdminSettlementExport,
  listAdminSettlementExports,
} from "../reporting/admin-settlement-exports";
import { PageSchema } from "../organizer-operations/operations.schemas";

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

function extractAuditMeta(req: FastifyRequest) {
  const ipAddress = req.ip || null;
  const userAgent =
    typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"].slice(0, 255)
      : null;

  return { ipAddress, userAgent };
}

@Controller("api/v1/admin")
@UseGuards(JwtAuthGuard, RolesGuard, ActiveSettlementAdminGuard)
@Roles(UserRole.ADMIN)
export class AdminPayoutsController {
  constructor(
    @Inject(PayoutsService) private readonly payoutsService: PayoutsService,
    @Inject(ReconciliationsService)
    private readonly reconciliationsService: ReconciliationsService,
  ) {}

  // GET /api/v1/admin/reconciliations
  // Doi soat giao dich VNPay va he thong
  @Get("reconciliations")
  @HttpCode(HttpStatus.OK)
  async getReconciliations(@Query() query: unknown) {
    const parseResult = ReconciliationQuerySchema.safeParse(query);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_QUERY_PARAMS",
          message: "Tham số truy vấn đối soát không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await this.reconciliationsService.getReconciliations(
      parseResult.data,
    );

    return {
      success: true,
      data,
    };
  }

  @Get("reconciliations/:eventId/investigations")
  async getInvestigations(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Query() query: unknown,
  ) {
    const { page, limit } = parsePage(query);
    const data = await this.reconciliationsService.getInvestigations(
      eventId,
      page,
      limit,
    );
    return { success: true, data };
  }

  @Get("reconciliations/:eventId/investigations/:caseId")
  async getInvestigationItems(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string,
    @Query() query: unknown,
  ) {
    const { page, limit } = parsePage(query);
    const data = await this.reconciliationsService.getInvestigationItems(
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
    const data = await this.reconciliationsService.resolveInvestigations(
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
    const items = await readAdminSettlementReport(parsed.data);
    if (parsed.data.format !== "json") {
      reply.header("Cache-Control", "private, no-store");
      return settlementDownload(
        await renderAdminSettlementDownload(items, parsed.data.format),
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
    const data = await enqueueAdminSettlementExport(user.userId, {
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
    const data = await listAdminSettlementExports(user.userId, page, limit);
    return { success: true, data };
  }

  @Get("settlement-report/exports/:id/download")
  async downloadSettlementExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { bytes, format } = await downloadAdminSettlementExport(
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
    const data = await this.payoutsService.closeEvent(id, user.userId);
    return { success: true, data };
  }

  // GET /api/v1/admin/payouts
  // Danh sach quyet toan toan he thong
  @Get("payouts")
  @HttpCode(HttpStatus.OK)
  async getPayouts(@Query() query: unknown) {
    const parseResult = PayoutFilterQuerySchema.safeParse(query);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_QUERY_PARAMS",
          message: "Tham số truy vấn lệnh chi trả không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await this.payoutsService.getAdminPayouts(parseResult.data);

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/payouts/generate
  // Tinh toan va khoi tao lenh quyet toan cho su kien
  @Post("payouts/generate")
  @HttpCode(HttpStatus.OK)
  async generatePayout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parseResult = GeneratePayoutSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_REQUEST_DATA",
          message: "Dữ liệu tạo lệnh chi trả không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await this.payoutsService.generatePayout(
      parseResult.data.eventId,
      user.userId,
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/payouts/:id/approve
  // Phe duyet lenh chi tra sang trang thai PAID_OUT
  @Post("payouts/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approvePayout(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
  ) {
    const { ipAddress, userAgent } = extractAuditMeta(req);

    const data = await this.payoutsService.approvePayout(
      id,
      user.userId,
      ipAddress ?? undefined,
      userAgent ?? undefined,
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/payouts/:id/hold
  // Tam giu lenh chi tra kem ly do
  @Post("payouts/:id/hold")
  @HttpCode(HttpStatus.OK)
  async holdPayout(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const parseResult = HoldPayoutSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_HOLD_DATA",
          message: "Lý do tạm giữ không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const { ipAddress, userAgent } = extractAuditMeta(req);

    const data = await this.payoutsService.holdPayout(
      id,
      parseResult.data.reason,
      user.userId,
      ipAddress ?? undefined,
      userAgent ?? undefined,
    );

    return {
      success: true,
      data,
    };
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
    const data = await this.payoutsService.releasePayout(
      id,
      parsed.data.reason,
      user.userId,
    );
    return { success: true, data };
  }

  // POST /api/v1/admin/payouts/:id/recalculate
  // Tinh toan lai so lieu cho lenh quyet toan
  @Post("payouts/:id/recalculate")
  @HttpCode(HttpStatus.OK)
  async recalculatePayout(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.payoutsService.recalculatePayout(id, user.userId);

    return {
      success: true,
      data,
    };
  }
}
