import { QueryVnpayPaymentUseCase } from "./application/query-vnpay-payment.use-case";
import { Module } from "@nestjs/common";
import { EventModule } from "../event/event.module";
import { EventReadModel } from "../event/application/event-read-model";
import { SeatStreamService } from "../event/infrastructure/seat-stream.service";
import { CreateVnpayPaymentUseCase } from "./application/create-vnpay-payment.use-case";
import { PreviewVnpayIpnUseCase } from "./application/preview-vnpay-ipn.use-case";
import { ProcessVnpayIpnUseCase } from "./application/process-vnpay-ipn.use-case";
import { PaymentController } from "./interface/payment.controller";
import { VnpayIpnController } from "./interface/vnpay-ipn.controller";
import { VnpayIpnPreviewController } from "./interface/vnpay-ipn.preview.controller";
import { createPaymentUseCases } from "./payment.composition";

const PAYMENT_USE_CASES = Symbol("PAYMENT_USE_CASES");
type PaymentUseCases = ReturnType<typeof createPaymentUseCases>;

@Module({
  imports: [EventModule],
  controllers: [
    PaymentController,
    VnpayIpnPreviewController,
    VnpayIpnController,
  ],
  providers: [
    {
      provide: PAYMENT_USE_CASES,
      useFactory: (cache?: EventReadModel, stream?: SeatStreamService) =>
        createPaymentUseCases(cache, stream),
      inject: [
        { token: EventReadModel, optional: true },
        { token: SeatStreamService, optional: true },
      ],
    },
    {
      provide: CreateVnpayPaymentUseCase,
      useFactory: (u: PaymentUseCases) => u.createPayment,
      inject: [PAYMENT_USE_CASES],
    },
    {
      provide: QueryVnpayPaymentUseCase,
      useFactory: (u: PaymentUseCases) => u.queryVnpay,
      inject: [PAYMENT_USE_CASES],
    },
    {
      provide: ProcessVnpayIpnUseCase,
      useFactory: (u: PaymentUseCases) => u.processIpn,
      inject: [PAYMENT_USE_CASES],
    },
    {
      provide: PreviewVnpayIpnUseCase,
      useFactory: (u: PaymentUseCases) => u.previewIpn,
      inject: [PAYMENT_USE_CASES],
    },
  ],
})
export class PaymentModule {}
