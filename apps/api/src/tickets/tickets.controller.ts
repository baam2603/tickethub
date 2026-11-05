import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { TicketsService } from "./tickets.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import { MyTicketsQuerySchema, UserRole } from "@tickethub/shared";

@Controller("api/v1/tickets")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get("my-tickets")
  @Roles(UserRole.BUYER, UserRole.ADMIN)
  async getMyTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parseResult = MyTicketsQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Tham số truy vấn vé cá nhân không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await this.ticketsService.getMyTickets(
      user.userId,
      parseResult.data,
    );

    return {
      success: true,
      data: data.items,
      meta: data.meta,
    };
  }

  @Get(":id/qr")
  @Roles(UserRole.BUYER, UserRole.ADMIN)
  async getQrToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.ticketsService.getTicketQr(user.userId, user.role, id);
  }
}

