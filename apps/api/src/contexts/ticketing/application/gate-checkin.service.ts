import type { GateLookupResponse, GateScanResponse } from "@tickethub/shared";
import type {
  DynamicQrPayload,
  GateLookupRequest,
  GateScanRequest,
} from "../domain/ticketing.models";
import type { GateRepository, QrTokenService } from "../domain/ticketing.ports";

export class GateCheckInService {
  constructor(
    private readonly gate: GateRepository,
    private readonly qrTokens: QrTokenService,
  ) {}

  async scanTicket(
    staffUserId: string,
    staffRole: string,
    dto: GateScanRequest,
  ): Promise<GateScanResponse> {
    let qr: DynamicQrPayload;
    try {
      qr = this.qrTokens.verify(dto.qrToken);
    } catch (error) {
      await this.gate.recordInvalidQr(staffUserId);
      throw error;
    }
    return this.gate.checkIn(staffUserId, staffRole, {
      eventId: qr.eventId,
      gateId: dto.gateId,
      qr,
    });
  }

  async lookupTicket(
    staffUserId: string,
    staffRole: string,
    dto: GateLookupRequest,
  ): Promise<GateLookupResponse> {
    const result = await this.gate.checkIn(staffUserId, staffRole, {
      eventId: dto.eventId,
      gateId: dto.gateId,
      manual: dto,
    });
    return { ...result, method: "MANUAL_LOOKUP" };
  }
}
