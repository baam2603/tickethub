import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { TicketingDomainError } from "../domain/ticketing.errors";

/** Giu nguyen hop dong loi cu: than phan hoi la chuoi "CODE: mo ta". */
export async function mapTicketingErrors<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof TicketingDomainError)) throw err;
    switch (err.kind) {
      case "NOT_FOUND":
        throw new NotFoundException(err.message);
      case "FORBIDDEN":
        throw new ForbiddenException(err.message);
      case "CONFLICT":
        throw new ConflictException(
          err.details
            ? { code: err.code, message: err.message, ...err.details }
            : err.message,
        );
      default:
        throw new BadRequestException(err.message);
    }
  }
}
