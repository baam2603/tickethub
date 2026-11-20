import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  Req,
} from "@nestjs/common";

import type { FastifyRequest } from "fastify";
import { env } from "../config/env.config";
import { isAllowedIp, parseIpAllowlist } from "../config/ip-allowlist";
import { paymentSignal } from "../monitoring/payment-monitoring";
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
  private readonly allowedSources = parseIpAllowlist(
    env.VNPAY_IPN_ALLOWED_CIDRS,
  );

  constructor(
    @Inject(VnpayIpnService)
    private readonly ipnService: VnpayIpnService,
  ) {}

  @Get("ipn")
  async receive(
    @Query() query: Record<string, unknown>,
    @Req() request?: FastifyRequest,
  ) {
    // VNPay IPN chi duoc xu ly khi feature flag duoc bat.
    // Mac dinh tat tren tat ca moi truong.
    if (process.env.ENABLE_VNPAY_IPN_PROCESSING !== "true") {
      throw new NotFoundException();
    }
    if (
      env.NODE_ENV === "production" &&
      !isAllowedIp(this.allowedSources, request?.ip)
    ) {
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

      if (decision === "MANUAL_REVIEW" || decision === "AMOUNT_MISMATCH") {
        paymentSignal("vnpay.ipn.review_required", "warning", { decision });
      }

      return toVnpayResponse(decision);
    } catch {
      paymentSignal("vnpay.ipn.processing_failed", "error");

      return {
        RspCode: "99",
        Message: "Unknown error",
      };
    }
  }
}
