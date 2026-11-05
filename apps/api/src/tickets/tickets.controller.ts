import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { TicketsService } from "./tickets.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import { UserRole } from "@tickethub/shared";

@Controller("api/v1/tickets")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get(":id/qr")
  @Roles(UserRole.BUYER, UserRole.ADMIN)
  async getQrToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.ticketsService.getTicketQr(user.userId, user.role, id);
  }
}
