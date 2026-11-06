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
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
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

function extractAuditMeta(req: FastifyRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  const ipAddress =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : req.ip || null;
  const userAgent =
    typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"].slice(0, 255)
      : null;

  return { ipAddress, userAgent };
}

@Controller("api/v1/admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPayoutsController {
  constructor(
    private readonly payoutsService: PayoutsService,
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
