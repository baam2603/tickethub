import { VnpayApi } from "./vnpay-api";
import { VnpayQueryService } from "./vnpay-query.service";
import { Module } from "@nestjs/common";

import { VnpayIpnPreviewController } from "./vnpay-ipn.preview.controller";
import { VnpayIpnPreviewService } from "./vnpay-ipn.preview.service";

import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { EventsModule } from "../events/events.module";
import { VnpayIpnController } from "./vnpay-ipn.controller";
import { VnpayIpnService } from "./vnpay-ipn.service";

@Module({
  imports: [EventsModule],
  controllers: [
    PaymentController,
    VnpayIpnPreviewController,
    VnpayIpnController,
  ],
  providers: [
    VnpayApi,
    VnpayQueryService,
    PaymentService,
    VnpayIpnPreviewService,
    VnpayIpnService,
  ],
})
export class PaymentsModule {}
