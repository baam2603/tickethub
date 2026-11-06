import {
  BadRequestException,
  Body,
  Inject,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TicketsService } from "./tickets.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import {
  GateLookupRequestSchema,
  GateScanRequestSchema,
  UserRole,
} from "@tickethub/shared";

@Controller("api/v1/gate")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GATE_STAFF, UserRole.ADMIN)
export class GateController {
  constructor(
    @Inject(TicketsService) private readonly ticketsService: TicketsService,
  ) {}

  @Post("scan")
  @HttpCode(HttpStatus.OK)
  async scanTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parseResult = GateScanRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu quét mã QR không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    return this.ticketsService.scanTicket(
      user.userId,
      user.role,
      parseResult.data,
    );
  }

  @Post("lookup")
  @HttpCode(HttpStatus.OK)
  async lookupTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parseResult = GateLookupRequestSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu tra cứu vé thủ công không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    return this.ticketsService.lookupTicket(
      user.userId,
      user.role,
      parseResult.data,
    );
  }
}
