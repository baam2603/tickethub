import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Query,
} from "@nestjs/common";

import { ProcessVnpayIpnUseCase } from "../application/process-vnpay-ipn.use-case";
import type { IpnDecision } from "../domain/ipn-decision";

export function toVnpayResponse(decision: IpnDecision) {
  switch (decision) {
    case "APPLY_SUCCESS":
    case "RECORD_FAILURE":
    case "LATE_RESTORED":
    case "LATE_REFUND_PENDING":
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
    @Inject(ProcessVnpayIpnUseCase)
    private readonly ipnService: ProcessVnpayIpnUseCase,
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

      if (
        ["MANUAL_REVIEW", "INVALID_SIGNATURE", "AMOUNT_MISMATCH"].includes(
          decision,
        )
      )
        this.logger.warn(
          JSON.stringify({ event: "vnpay.ipn.review_required", decision }),
        );
      return toVnpayResponse(decision);
    } catch {
      this.logger.error(
        JSON.stringify({ event: "vnpay.ipn.processing_failed" }),
      );
      return {
        RspCode: "99",
        Message: "Unknown error",
      };
    }
  }
}
