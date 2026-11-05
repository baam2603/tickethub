import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import { StaffService } from "./staff.service";
import {
  AssignmentSchema,
  GateSchema,
  PageSchema,
  StaffCreateSchema,
  StaffUpdateSchema,
} from "./operations.schemas";
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      details: result.error.flatten(),
    });
  return result.data;
}
@Controller("api/v1/organizer")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ORGANIZER")
export class OperationsController {
  constructor(@Inject(StaffService) private readonly service: StaffService) {}
  @Post("staff") async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return {
      success: true,
      data: await this.service.create(
        user.userId,
        parseInput(StaffCreateSchema, body),
      ),
    };
  }
  @Get("staff") async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ) {
    return {
      success: true,
      data: await this.service.list(user.userId, parseInput(PageSchema, query)),
    };
  }
  @Patch("staff/:staffId") async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("staffId", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return {
      success: true,
      data: await this.service.update(
        user.userId,
        id,
        parseInput(StaffUpdateSchema, body),
      ),
    };
  }
  @Post("events/:eventId/gates") async gate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return {
      success: true,
      data: await this.service.createGate(
        user.userId,
        id,
        parseInput(GateSchema, body),
      ),
    };
  }
  @Get("events/:eventId/gates") async gates(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
  ) {
    return {
      success: true,
      data: await this.service.listGates(user.userId, id),
    };
  }
  @Post("events/:eventId/staff") async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return {
      success: true,
      data: await this.service.assign(
        user.userId,
        id,
        parseInput(AssignmentSchema, body),
      ),
    };
  }
  @Get("events/:eventId/staff") async assignments(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
  ) {
    return {
      success: true,
      data: await this.service.assignments(user.userId, id),
    };
  }
  @Delete("events/:eventId/staff/:staffId") @HttpCode(200) async unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId", new ParseUUIDPipe()) id: string,
    @Param("staffId", new ParseUUIDPipe()) staff: string,
  ) {
    return {
      success: true,
      data: await this.service.unassign(user.userId, id, staff),
    };
  }
}
