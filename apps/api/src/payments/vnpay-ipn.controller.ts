import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Query,
} from "@nestjs/common";

import { VnpayIpnService } from "./vnpay-ipn.service";
import type { IpnDecision } from "./vnpay-ipn.decision";

export function toVnpayResponse(decision: IpnDecision) {
  switch (decision) {
    case "APPLY_SUCCESS":
    case "RECORD_FAILURE":
    case "REFUND_PENDING":
      return { RspCode: "00", Message: "Confirm Success" };

    case "ALREADY_PROCESSED":
      return { RspCode: "02", Message: "Order already confirmed" };

    case "ORDER_NOT_FOUND":
      return { RspCode: "01", Message: "Order not found" };

    case "AMOUNT_MISMATCH":
      return { RspCode: "04", Message: "Invalid amount" };

    case "INVALID_SIGNATURE":
      return { RspCode: "97", Message: "Invalid signature" };

    case "MANUAL_REVIEW":
      return { RspCode: "99", Message: "Manual review required" };
  }
}

@Controller("api/v1/payments/vnpay")
export class VnpayIpnController {
  private readonly logger = new Logger(VnpayIpnController.name);

  constructor(
    @Inject(VnpayIpnService)
    private readonly ipnService: VnpayIpnService,
  ) {}

  @Get("ipn")
  async receive(@Query() query: Record<string, unknown>) {
    // VNPay IPN chi duoc xu ly khi feature flag duoc bat.
    // Mac dinh tat tren tat ca moi truong.
    if (process.env.ENABLE_VNPAY_IPN_PROCESSING !== "true") {
      throw new NotFoundException();
    }
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (!key.startsWith("vnp_")) continue;

      if (typeof value !== "string") {
        return { RspCode: "99", Message: "Invalid parameters" };
      }
      params[key] = value;
    }

    try {
      const decision = await this.ipnService.process(params);

      if (decision === "MANUAL_REVIEW") {
        this.logger.warn(
          `VNPay transaction needs review: ${params.vnp_TxnRef ?? "unknown"}`,
        );
      }

      return toVnpayResponse(decision);
    } catch (error) {
      this.logger.error(
        "VNPay IPN processing failed",
        error instanceof Error ? error.stack : String(error),
      );

      return {
        RspCode: "99",
        Message: "Unknown error",
      };
    }
  }
}
