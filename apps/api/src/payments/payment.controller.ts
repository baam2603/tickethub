import {
  Controller,
  Post,
  Param,
  ParseUUIDPipe,
  Ip,
  Headers,
  Inject,
  UseGuards,
} from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";

import { VnpayQueryService } from "./vnpay-query.service";
import { PaymentService } from "./payment.service";

@Controller("api/v1/payments")
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(
    @Inject(PaymentService)
    private readonly paymentService: PaymentService,
    @Inject(VnpayQueryService) private readonly queryService: VnpayQueryService,
  ) {}

  @Post("orders/:orderId/vnpay")
  async createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Ip() clientIp: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const data = await this.paymentService.createVnpayPayment(
      user.userId,
      orderId,
      clientIp,
      idempotencyKey,
    );

    return {
      success: true,
      data,
    };
  }
  @Post("orders/:orderId/vnpay/query")
  async queryPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
  ) {
    return {
      success: true,
      data: await this.queryService.query(user.userId, orderId),
    };
  }
}
