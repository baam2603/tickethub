import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { BuyerOrderService } from "./buyer-order.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import { BuyerOrderQuerySchema, UserRole } from "@tickethub/shared";

@Controller("api/v1/buyer/orders")
@UseGuards(JwtAuthGuard, RolesGuard)
export class BuyerOrderController {
  constructor(private readonly buyerOrderService: BuyerOrderService) {}

  @Get()
  @Roles(UserRole.BUYER, UserRole.ADMIN)
  async listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parseResult = BuyerOrderQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Tham số truy vấn đơn hàng không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await this.buyerOrderService.listBuyerOrders(
      user.userId,
      parseResult.data,
    );

    return {
      success: true,
      data: data.items,
      meta: data.meta,
    };
  }

  @Get(":id")
  @Roles(UserRole.BUYER, UserRole.ADMIN)
  async getOrderDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    const data = await this.buyerOrderService.getBuyerOrderDetail(
      user.userId,
      user.role,
      id,
    );

    return {
      success: true,
      data,
    };
  }
}
