export type TicketingErrorKind =
  "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST";

/**
 * Loi nghiep vu cua context Ticketing. `message` la than phan hoi dang chuoi
 * "CODE: mo ta" nhu hop dong cu; `code` la phan ma on dinh.
 */
export class TicketingDomainError extends Error {
  constructor(
    readonly kind: TicketingErrorKind,
    readonly code: string,
    message: string,
    readonly details?: {
      checkedInAt: string | null;
      gateId: string | null;
      staffId: string | null;
    },
  ) {
    super(message);
    this.name = "TicketingDomainError";
  }
}

const withText = (kind: TicketingErrorKind, code: string, text: string) =>
  new TicketingDomainError(kind, code, `${code}: ${text}`);

export const ticketingErrors = {
  ticketNotFound: () =>
    new TicketingDomainError(
      "NOT_FOUND",
      "TICKET_NOT_FOUND",
      "TICKET_NOT_FOUND",
    ),
  lookupTicketNotFound: () =>
    withText(
      "NOT_FOUND",
      "TICKET_NOT_FOUND",
      "Invalid ticket code for this event",
    ),
  accessDenied: () =>
    withText(
      "FORBIDDEN",
      "ACCESS_DENIED",
      "You do not have permission to access this ticket",
    ),
  alreadyUsed: () =>
    withText("CONFLICT", "TICKET_ALREADY_USED", "Ticket has already been used"),
  alreadyCheckedIn: () =>
    withText(
      "CONFLICT",
      "TICKET_ALREADY_USED",
      "Ticket has already been checked in",
    ),
  alreadyUsedBy: (at: string | undefined, staffId: string | null) =>
    withText(
      "CONFLICT",
      "TICKET_ALREADY_USED",
      `Ticket was already checked in at ${at} by staff ${staffId}`,
    ),
  notActive: (status: string) =>
    withText(
      "BAD_REQUEST",
      "TICKET_NOT_ACTIVE",
      `Ticket is not active (status: ${status})`,
    ),
  notEligible: (status: string) =>
    withText(
      "BAD_REQUEST",
      "TICKET_NOT_ELIGIBLE",
      `Ticket status is ${status}`,
    ),
  eventNotActiveWithStatus: (status: string) =>
    withText(
      "BAD_REQUEST",
      "EVENT_NOT_ACTIVE",
      `Event is not published or is suspended (status: ${status})`,
    ),
  eventNotActive: () =>
    withText(
      "BAD_REQUEST",
      "EVENT_NOT_ACTIVE",
      "Event is not published or is suspended",
    ),
  staffNotAssigned: () =>
    withText(
      "FORBIDDEN",
      "STAFF_NOT_ASSIGNED_TO_EVENT",
      "Gate staff is not assigned to this event",
    ),
  invalidGate: () =>
    withText(
      "BAD_REQUEST",
      "INVALID_GATE_ID",
      "Gate does not belong to this event",
    ),
  verificationFailed: () =>
    withText(
      "BAD_REQUEST",
      "VERIFICATION_FAILED",
      "Phone or email last 4 digits do not match",
    ),
  malformedQr: (text: string) =>
    withText("BAD_REQUEST", "MALFORMED_QR_TOKEN", text),
  invalidQrSignature: (text: string) =>
    withText("BAD_REQUEST", "INVALID_QR_SIGNATURE", text),
  qrExpired: (secondsAgo: number) =>
    withText(
      "BAD_REQUEST",
      "QR_TOKEN_EXPIRED",
      `Token expired ${secondsAgo} seconds ago`,
    ),
};
