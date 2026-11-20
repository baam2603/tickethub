import { ActiveSettlementAdminGuard } from "./active-settlement-admin.guard";
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PayoutCommands } from "../application/payout-commands.service";
import { PayoutQueries } from "../application/payout-queries.service";
import { ReconciliationQueries } from "../application/reconciliation-queries.service";
import { mapPayoutErrors } from "./payout-http";
import { JwtAuthGuard } from "../../identity/interface/guards/jwt-auth.guard";
import { RolesGuard } from "../../identity/interface/guards/roles.guard";
import { Roles } from "../../identity/interface/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../../identity/interface/decorators/current-user.decorator";
import {
  UserRole,
  ReconciliationQuerySchema,
  PayoutFilterQuerySchema,
  GeneratePayoutSchema,
  HoldPayoutSchema,
} from "@tickethub/shared";

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
    @Inject(PayoutCommands) private readonly payoutCommands: PayoutCommands,
    @Inject(PayoutQueries) private readonly payoutQueries: PayoutQueries,
    @Inject(ReconciliationQueries)
    private readonly reconciliationQueries: ReconciliationQueries,
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

    const data = await mapPayoutErrors(() =>
      this.reconciliationQueries.getReconciliations(parseResult.data),
    );

    return {
      success: true,
      data,
    };
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

    const data = await mapPayoutErrors(() =>
      this.payoutQueries.getAdminPayouts(parseResult.data),
    );

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

    const data = await mapPayoutErrors(() =>
      this.payoutCommands.generatePayout(parseResult.data.eventId, user.userId),
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

    const data = await mapPayoutErrors(() =>
      this.payoutCommands.approvePayout(
        id,
        user.userId,
        ipAddress ?? undefined,
        userAgent ?? undefined,
      ),
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

    const data = await mapPayoutErrors(() =>
      this.payoutCommands.holdPayout(
        id,
        parseResult.data.reason,
        user.userId,
        ipAddress ?? undefined,
        userAgent ?? undefined,
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/payouts/:id/recalculate
  // Tinh toan lai so lieu cho lenh quyet toan
  @Post("payouts/:id/recalculate")
  @HttpCode(HttpStatus.OK)
  async recalculatePayout(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await mapPayoutErrors(() =>
      this.payoutCommands.recalculatePayout(id, user.userId),
    );

    return {
      success: true,
      data,
    };
  }
}
