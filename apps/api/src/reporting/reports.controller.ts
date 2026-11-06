import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
  NotFoundException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import { parseInput } from "../organizer-operations/operations.controller";
import {
  ExportSchema,
  PageSchema,
  ReportPeriodSchema,
  ReportListSchema,
  paginated,
} from "../organizer-operations/operations.schemas";
import { ReportsService } from "./reports.service";
import { exportFilePath } from "./export-files";
@Controller("api/v1/organizer/events")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ORGANIZER")
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly service: ReportsService,
  ) {}
  @Get(":eventId/reports") async report(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    return {
      success: true,
      data: await this.service.report(
        u.userId,
        id,
        parseInput(ReportPeriodSchema, query),
      ),
    };
  }
  @Get(":eventId/reports/buyers") async buyers(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    const filter = parseInput(ReportListSchema, query);
    return {
      success: true,
      ...paginated(
        await this.service.breakdown(u.userId, id, filter, "buyers"),
        filter,
      ),
    };
  }
  @Get(":eventId/reports/vouchers") async vouchers(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    const filter = parseInput(ReportListSchema, query);
    return {
      success: true,
      ...paginated(
        await this.service.breakdown(u.userId, id, filter, "vouchers"),
        filter,
      ),
    };
  }
  @Get(":eventId/checkins/summary") async checkinSummary(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
  ) {
    return {
      success: true,
      data: await this.service.checkinSummary(u.userId, id),
    };
  }
  @Get(":eventId/checkins") async history(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    const page = parseInput(PageSchema, query);
    return {
      success: true,
      ...paginated(await this.service.history(u.userId, id, page), page),
    };
  }
  @Post(":eventId/reports/exports") @HttpCode(202) async create(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = parseInput(ExportSchema, body);
    return {
      success: true,
      data: await this.service.createExport(u.userId, id, input.format, input),
    };
  }
  @Get(":eventId/reports/exports") async list(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    const page = parseInput(PageSchema, query);
    return {
      success: true,
      ...paginated(await this.service.listExports(u.userId, id, page), page),
    };
  }
  @Get(":eventId/reports/exports/:exportId") async status(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Param("exportId", new ParseUUIDPipe()) jobId: string,
  ) {
    const job = await this.service.exportStatus(u.userId, id, jobId);
    return {
      success: true,
      data: {
        id: job.id,
        status: job.status,
        format: job.format,
        createdAt: job.createdAt,
        expiresAt: job.expiresAt,
        ticketTypeId: job.ticketTypeId,
        voucherCode: job.voucherCode,
        fromDate: job.fromDate,
        toDate: job.toDate,
        errorMessage: job.errorMessage,
        downloadUrl:
          job.status === "COMPLETED"
            ? `/api/v1/organizer/events/${id}/reports/exports/${job.id}/download`
            : null,
      },
    };
  }
  @Get(":eventId/reports/exports/:exportId/download") async download(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Param("exportId", new ParseUUIDPipe()) jobId: string,
    @Res() reply: FastifyReply,
  ) {
    const job = await this.service.download(u.userId, id, jobId);
    const file = exportFilePath(job.fileName!);
    try {
      await access(file);
    } catch {
      throw new NotFoundException("EXPORT_FILE_NOT_FOUND");
    }
    reply
      .header(
        "Content-Disposition",
        `attachment; filename="event-report-${job.id}.${job.format}"`,
      )
      .header("Cache-Control", "private, no-store")
      .type(
        job.format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    return reply.send(createReadStream(file));
  }
}
