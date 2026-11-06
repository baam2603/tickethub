import {
  Controller,
  Post,
  Body,
  Headers,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import { RefundsService } from "./refunds.service";
import type {
  RefundPreviewRequest,
  RefundPreviewResponse,
  RefundExecuteRequest,
  RefundExecuteResponse,
} from "@tickethub/shared";

@Controller("api/v1/refund")
@UseGuards(JwtAuthGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post("preview")
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RefundPreviewRequest,
  ): Promise<RefundPreviewResponse> {
    return this.refundsService.previewRefund(user.userId, user.role, body);
  }

  @Post("request")
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() body: RefundExecuteRequest,
  ): Promise<RefundExecuteResponse> {
    if (!idempotencyKey || idempotencyKey.trim() === "") {
      throw new BadRequestException("Missing Idempotency-Key header");
    }
    return this.refundsService.executeRefund(
      user.userId,
      user.role,
      body,
      idempotencyKey.trim(),
    );
  }
}
