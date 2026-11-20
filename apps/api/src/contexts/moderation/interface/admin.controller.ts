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
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { AuditLogQueries } from "../application/audit-log-queries.service";
import { EventModerationService } from "../application/event-moderation.service";
import { KycModerationService } from "../application/kyc-moderation.service";
import { mapModerationErrors } from "./moderation-http";

import { JwtAuthGuard } from "../../identity/interface/guards/jwt-auth.guard";
import { RolesGuard } from "../../identity/interface/guards/roles.guard";
import { Roles } from "../../identity/interface/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../../identity/interface/decorators/current-user.decorator";

import {
  ApproveActionSchema,
  AuditLogQuerySchema,
  EventControlQuerySchema,
  EventKillSwitchRequestSchema,
  EventResumeRequestSchema,
  RejectActionSchema,
  ReviewEventSchema,
  ReviewOrganizerSchema,
  UserRole,
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
export class AdminController {
  constructor(
    @Inject(KycModerationService) private readonly kyc: KycModerationService,
    @Inject(EventModerationService)
    private readonly eventModeration: EventModerationService,
    @Inject(AuditLogQueries) private readonly auditLogs: AuditLogQueries,
  ) {}

  // GET /api/v1/admin/organizers
  // Lấy danh sách hồ sơ Ban tổ chức chờ duyệt
  @Get("organizers")
  async getPendingOrganizers() {
    const items = await mapModerationErrors(() =>
      this.kyc.getPendingOrganizers(),
    );

    return {
      success: true,
      data: items,
      meta: {
        total: items.length,
      },
    };
  }

  // POST /api/v1/admin/organizers/:id/approve
  // Phê duyệt hồ sơ Ban tổ chức
  @Post("organizers/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approveOrganizer(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const result = ApproveActionSchema.safeParse(body ?? {});
    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu phê duyệt hồ sơ không hợp lệ",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.kyc.reviewOrganizer(
        id,
        user.userId,
        {
          decision: "APPROVE",
          version: result.data.version,
        },
        extractAuditMeta(req),
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/organizers/:id/reject
  // Từ chối hồ sơ Ban tổ chức kèm lý do
  @Post("organizers/:id/reject")
  @HttpCode(HttpStatus.OK)
  async rejectOrganizer(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const result = RejectActionSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Từ chối hồ sơ Ban tổ chức bắt buộc phải có lý do",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.kyc.reviewOrganizer(
        id,
        user.userId,
        {
          decision: "REJECT",
          reason: result.data.reason,
          version: result.data.version,
        },
        extractAuditMeta(req),
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/organizers/:id/review
  // Alias duyệt hoặc từ chối hồ sơ Ban tổ chức
  @Post("organizers/:id/review")
  @HttpCode(HttpStatus.OK)
  async reviewOrganizer(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const result = ReviewOrganizerSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu duyệt hồ sơ không hợp lệ",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.kyc.reviewOrganizer(
        id,
        user.userId,
        result.data,
        extractAuditMeta(req),
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // GET /api/v1/admin/events
  // Lấy danh sách sự kiện chờ duyệt
  @Get("events")
  async getPendingEvents() {
    const items = await mapModerationErrors(() =>
      this.eventModeration.getPendingEvents(),
    );

    return {
      success: true,
      data: items,
      meta: {
        total: items.length,
      },
    };
  }

  @Get("events/control")
  async getEventControls(@Query() query: unknown) {
    const result = EventControlQuerySchema.safeParse(query);
    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Bộ lọc quản trị sự kiện không hợp lệ",
        },
      });
    }
    const data = await mapModerationErrors(() =>
      this.eventModeration.getEventControls(result.data),
    );
    return { success: true, data };
  }

  // POST /api/v1/admin/events/:id/approve
  // Phê duyệt sự kiện chuyển sang trạng thái PUBLISHED
  @Post("events/:id/approve")
  @HttpCode(HttpStatus.OK)
  async approveEvent(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const result = ApproveActionSchema.safeParse(body ?? {});
    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu phê duyệt sự kiện không hợp lệ",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.eventModeration.reviewEvent(
        id,
        user.userId,
        {
          decision: "APPROVE",
          version: result.data.version,
        },
        extractAuditMeta(req),
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/events/:id/reject
  // Từ chối sự kiện kèm lý do chuyển về DRAFT
  @Post("events/:id/reject")
  @HttpCode(HttpStatus.OK)
  async rejectEvent(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const result = RejectActionSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Từ chối sự kiện bắt buộc phải có lý do",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.eventModeration.reviewEvent(
        id,
        user.userId,
        {
          decision: "REJECT",
          reason: result.data.reason,
          version: result.data.version,
        },
        extractAuditMeta(req),
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/events/:id/review
  // Alias duyệt hoặc từ chối sự kiện
  @Post("events/:id/review")
  @HttpCode(HttpStatus.OK)
  async reviewEvent(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const result = ReviewEventSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu duyệt sự kiện không hợp lệ",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.eventModeration.reviewEvent(
        id,
        user.userId,
        result.data,
        extractAuditMeta(req),
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/events/:id/kill-switch
  // Kích hoạt ngắt khẩn cấp sự kiện vi phạm
  @Post("events/:id/kill-switch")
  @HttpCode(HttpStatus.OK)
  async activateKillSwitch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const result = EventKillSwitchRequestSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu kích hoạt Kill Switch không hợp lệ",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.eventModeration.activateKillSwitch(
        id,
        user.userId,
        result.data,
        extractAuditMeta(req),
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // POST /api/v1/admin/events/:id/resume
  // Khôi phục sự kiện bị đình chỉ trở lại mở bán
  @Post("events/:id/resume")
  @HttpCode(HttpStatus.OK)
  async resumeEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const result = EventResumeRequestSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu khôi phục sự kiện không hợp lệ",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.eventModeration.resumeEvent(
        id,
        user.userId,
        result.data,
        extractAuditMeta(req),
      ),
    );

    return {
      success: true,
      data,
    };
  }

  // GET /api/v1/admin/events/:id/audit-logs
  // Truy vấn nhật ký kiểm toán bất biến theo sự kiện có phân trang
  @Get("events/:id/audit-logs")
  async getEventAuditLogs(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ) {
    const result = AuditLogQuerySchema.safeParse(query);

    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Tham số truy vấn audit log không hợp lệ",
          details: result.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await mapModerationErrors(() =>
      this.auditLogs.getEventAuditLogs(id, result.data),
    );

    return {
      success: true,
      data,
    };
  }
}
