import type { GateLookupRequest, GateScanResponse } from "@tickethub/shared";
import type {
  DynamicQrPayload,
  MyTicketsPage,
  MyTicketsQuery,
  QrSubject,
  QrTicketRecord,
  SignedQr,
} from "./ticketing.models";

export interface QrTokenService {
  sign(subject: QrSubject): SignedQr;
  /** Nem TicketingDomainError neu token sai dinh dang, chu ky hoac het han. */
  verify(token: string, maxSkewSeconds?: number): DynamicQrPayload;
}

export interface TicketQrReader {
  findForQr(ticketId: string): Promise<QrTicketRecord | null>;
}

export interface MyTicketsReader {
  list(userId: string, query: MyTicketsQuery): Promise<MyTicketsPage>;
}

export type GateCheckInInput = {
  gateId: string | undefined;
} & (
  | { eventId: string; manual: GateLookupRequest; qr?: undefined }
  | { eventId: string; manual?: undefined; qr: DynamicQrPayload }
);

export interface GateRepository {
  checkIn(
    staffUserId: string,
    staffRole: string,
    input: GateCheckInInput,
  ): Promise<GateScanResponse>;
  recordInvalidQr(staffUserId: string): Promise<void>;
}
