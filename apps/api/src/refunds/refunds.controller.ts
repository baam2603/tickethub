import {
  Controller,
  Inject,
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
import {
  RefundPreviewRequestSchema,
  RefundExecuteRequestSchema,
} from "@tickethub/shared";
import { parseInput } from "../organizer-operations/operations.controller";
import type {
  RefundPreviewResponse,
  RefundExecuteResponse,
} from "@tickethub/shared";

@Controller("api/v1/refund")
@UseGuards(JwtAuthGuard)
export class RefundsController {
  constructor(
    @Inject(RefundsService) private readonly refundsService: RefundsService,
  ) {}

  @Post("preview")
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<RefundPreviewResponse> {
    return this.refundsService.previewRefund(
      user.userId,
      user.role,
      parseInput(RefundPreviewRequestSchema, body),
    );
  }

  @Post("request")
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() body: unknown,
  ): Promise<RefundExecuteResponse> {
    if (!idempotencyKey || idempotencyKey.trim() === "") {
      throw new BadRequestException("Missing Idempotency-Key header");
    }
    return this.refundsService.executeRefund(
      user.userId,
      user.role,
      parseInput(RefundExecuteRequestSchema, body),
      idempotencyKey.trim(),
    );
  }
}
