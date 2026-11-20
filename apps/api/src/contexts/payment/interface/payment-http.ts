import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PaymentDomainError } from "../domain/payment.errors";

/** Giu nguyen hop dong loi cu: than phan hoi la chuoi mo ta. */
export async function mapPaymentErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof PaymentDomainError)) throw err;
    switch (err.kind) {
      case "RATE_LIMITED":
        throw new HttpException(err.message, HttpStatus.TOO_MANY_REQUESTS);
      case "UNAVAILABLE":
        throw new ServiceUnavailableException(err.message);
      case "NOT_FOUND":
        throw new NotFoundException(err.message);
      case "CONFLICT":
        throw new ConflictException(err.message);
      default:
        throw new BadRequestException(err.message);
    }
  }
}
