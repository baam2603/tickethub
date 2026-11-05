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
  ) {
    return { success: true, data: await this.service.report(u.userId, id) };
  }
  @Get(":eventId/checkins") async history(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    return {
      success: true,
      data: await this.service.history(
        u.userId,
        id,
        parseInput(PageSchema, query),
      ),
    };
  }
  @Post(":eventId/reports/exports") @HttpCode(202) async create(
    @CurrentUser() u: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return {
      success: true,
      data: await this.service.createExport(
        u.userId,
        id,
        parseInput(ExportSchema, body).format,
      ),
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
