import { QueryVnpayPaymentUseCase } from "../application/query-vnpay-payment.use-case";
import {
  Controller,
  Post,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Ip,
  Inject,
  UseGuards,
} from "@nestjs/common";

import { JwtAuthGuard } from "../../identity/interface/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthenticatedUser,
} from "../../identity/interface/decorators/current-user.decorator";

import { CreateVnpayPaymentUseCase } from "../application/create-vnpay-payment.use-case";
import { mapPaymentErrors } from "./payment-http";

@Controller("api/v1/payments")
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(
    @Inject(CreateVnpayPaymentUseCase)
    private readonly createPaymentUseCase: CreateVnpayPaymentUseCase,
    @Inject(QueryVnpayPaymentUseCase)
    private readonly queryVnpay: QueryVnpayPaymentUseCase,
  ) {}

  @Post("orders/:orderId/vnpay")
  async createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Ip() clientIp: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const data = await mapPaymentErrors(() =>
      this.createPaymentUseCase.execute(
        user.userId,
        orderId,
        clientIp,
        idempotencyKey,
      ),
    );

    return {
      success: true,
      data,
    };
  }
  @Get("vnpay/status/:transactionRef")
  @Header("Cache-Control", "private, no-store")
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @Param("transactionRef") ref: string,
  ) {
    return {
      success: true,
      data: await mapPaymentErrors(() =>
        this.queryVnpay.status(user.userId, ref),
      ),
    };
  }

  @Post("orders/:orderId/vnpay/query")
  async reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Ip() clientIp: string,
  ) {
    return {
      success: true,
      data: await mapPaymentErrors(() =>
        this.queryVnpay.reconcile(user.userId, orderId, clientIp),
      ),
    };
  }
}
