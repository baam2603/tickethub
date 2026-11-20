import { readVnpayMerchantIp } from "./infrastructure/vnpay-merchant-ip";
import { sqlClient } from "../../database/db";
import { processPaymentEmails } from "./infrastructure/payment-email-worker";
import { QueryVnpayPaymentUseCase } from "./application/query-vnpay-payment.use-case";
import { VnpayQueryGateway } from "./infrastructure/vnpay-query.gateway";
import { env } from "../../config/env.config";
import { CreateVnpayPaymentUseCase } from "./application/create-vnpay-payment.use-case";
import { PreviewVnpayIpnUseCase } from "./application/preview-vnpay-ipn.use-case";
import { ProcessVnpayIpnUseCase } from "./application/process-vnpay-ipn.use-case";
import type { PaymentGateway } from "./domain/payment-gateway";
import type {
  CheckoutUnitOfWork,
  IpnUnitOfWork,
  PaymentQueryPort,
  SettlementNotifier,
} from "./domain/payment.ports";
import {
  DrizzleCheckoutUnitOfWork,
  DrizzleIpnUnitOfWork,
  DrizzlePaymentQuery,
} from "./infrastructure/drizzle-payment.repository";
import { EventSettlementNotifier } from "./infrastructure/event-settlement.notifier";
import { VnpayGateway } from "./infrastructure/vnpay.gateway";

type NotifierDeps = ConstructorParameters<typeof EventSettlementNotifier>;

export interface PaymentOverrides {
  gateway?: PaymentGateway;
  checkout?: CheckoutUnitOfWork;
  ipn?: IpnUnitOfWork;
  query?: PaymentQueryPort;
  notifier?: SettlementNotifier;
  takeQuerySlot?: (userId: string) => Promise<boolean>;
}

/** Lap rap cac use case thanh toan; `cache`/`seatStream` thuoc context Event va la tuy chon. */
export function createPaymentUseCases(
  cache?: NotifierDeps[0],
  seatStream?: NotifierDeps[1],
  overrides: PaymentOverrides = {},
) {
  const gateway = overrides.gateway ?? new VnpayGateway();
  const query = overrides.query ?? new DrizzlePaymentQuery();
  const processIpn = new ProcessVnpayIpnUseCase(
    gateway,
    query,
    overrides.ipn ?? new DrizzleIpnUnitOfWork(),
    overrides.notifier ?? new EventSettlementNotifier(cache, seatStream),
  );
  return {
    createPayment: new CreateVnpayPaymentUseCase(
      overrides.checkout ?? new DrizzleCheckoutUnitOfWork(),
      gateway,
      { returnUrl: env.VNPAY_RETURN_URL },
    ),
    processIpn,
    queryVnpay: new QueryVnpayPaymentUseCase(
      new DrizzlePaymentQuery(),
      new VnpayQueryGateway(),
      processIpn,
      readVnpayMerchantIp,
      overrides.takeQuerySlot ??
        (() => Promise.reject(new Error("Query rate limit unavailable"))),
    ),
    previewIpn: new PreviewVnpayIpnUseCase(gateway, query),
  };
}

export async function runPaymentEmailWorker() {
  try {
    await processPaymentEmails();
  } finally {
    await sqlClient.end();
  }
}
