import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { PayoutsService } from "./payouts.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import { UserRole, OrganizerPayoutQuerySchema } from "@tickethub/shared";

@Controller("api/v1/organizer/payouts")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ORGANIZER)
export class OrganizerPayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  // GET /api/v1/organizer/payouts
  // Danh sach quyet toan danh cho ban to chuc
  @Get()
  @HttpCode(HttpStatus.OK)
  async getOrganizerPayouts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ) {
    const parseResult = OrganizerPayoutQuerySchema.safeParse(query);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_QUERY_PARAMS",
          message: "Tham số truy vấn quyết toán không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await this.payoutsService.getOrganizerPayouts(
      user.userId,
      parseResult.data,
    );

    return {
      success: true,
      data,
    };
  }
}
