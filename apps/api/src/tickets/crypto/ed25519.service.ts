import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as crypto from "node:crypto";
import { env } from "../../config/env.config";

export interface DynamicQrPayload {
  sub: string; // ticketId
  eventId: string;
  orderId: string;
  userId: string;
  nonce: string;
  iat: number;
  exp: number;
}

@Injectable()
export class Ed25519Service {
  private readonly privateKey: crypto.KeyObject;
  private readonly publicKey: crypto.KeyObject;

  constructor() {
    this.privateKey = crypto.createPrivateKey({
      key: Buffer.from(env.ED25519_PRIVATE_KEY, "base64"),
      format: "der",
      type: "pkcs8",
    });
    this.publicKey = crypto.createPublicKey(this.privateKey);
  }

  /**
   * Ký số mã QR động theo chuẩn JWT RFC 7519 với thuật toán EdDSA (Ed25519)
   * Token có thời hạn sử dụng 30 giây.
   */
  signDynamicQr(data: Omit<DynamicQrPayload, "iat" | "exp" | "nonce">): {
    token: string;
    expiresAt: Date;
    remainingSeconds: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = 30;
    const expiresAt = new Date((now + ttlSeconds) * 1000);

    const payload: DynamicQrPayload = {
      ...data,
      nonce: randomUUID(),
      iat: now,
      exp: now + ttlSeconds,
    };

    const token = this.generateToken(payload);

    return {
      token,
      expiresAt,
      remainingSeconds: ttlSeconds,
    };
  }

  /**
   * Xác thực token QR động Ed25519
   * @param token Chuỗi JWT
   * @param maxSkewSeconds Dung sai thời gian phát hành tối đa (mặc định 35 giây = 30s TTL + 5s clock skew)
   */
  verifyDynamicQr(token: string, maxSkewSeconds = 35): DynamicQrPayload {
    if (!token || typeof token !== "string") {
      throw new BadRequestException("MALFORMED_QR_TOKEN: Empty token");
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new BadRequestException(
        "MALFORMED_QR_TOKEN: Token must have 3 segments",
      );
    }

    const [headerB64, payloadB64, signatureB64] = parts as [
      string,
      string,
      string,
    ];
    const signingInput = `${headerB64}.${payloadB64}`;

    let header: { alg?: string; typ?: string };
    let payload: DynamicQrPayload;

    try {
      header = JSON.parse(
        Buffer.from(headerB64, "base64url").toString("utf8"),
      ) as { alg?: string; typ?: string };
      payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf8"),
      ) as DynamicQrPayload;
    } catch {
      throw new BadRequestException(
        "MALFORMED_QR_TOKEN: Invalid JSON encoding",
      );
    }

    if (header.alg !== "EdDSA") {
      throw new BadRequestException(
        `INVALID_QR_SIGNATURE: Unsupported algorithm ${header.alg}`,
      );
    }

    let isSignatureValid: boolean;
    try {
      const signatureBuf = Buffer.from(signatureB64, "base64url");
      isSignatureValid = crypto.verify(
        null,
        Buffer.from(signingInput, "utf8"),
        this.publicKey,
        signatureBuf,
      );
    } catch {
      isSignatureValid = false;
    }

    if (!isSignatureValid) {
      throw new BadRequestException(
        "INVALID_QR_SIGNATURE: Cryptographic verification failed",
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const ageSeconds = nowSec - payload.iat;

    if (ageSeconds > maxSkewSeconds) {
      throw new BadRequestException(
        `QR_TOKEN_EXPIRED: Token expired ${ageSeconds - 30} seconds ago`,
      );
    }

    return payload;
  }

  /**
   * Tạo token giả lập thời gian phát hành phục vụ kiểm thử đơn vị
   */
  createTokenForTesting(options: {
    sub: string;
    eventId: string;
    orderId: string;
    userId: string;
    issuedAtSecondsAgo: number;
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const iat = now - options.issuedAtSecondsAgo;
    const exp = iat + 30;

    const payload: DynamicQrPayload = {
      sub: options.sub,
      eventId: options.eventId,
      orderId: options.orderId,
      userId: options.userId,
      nonce: randomUUID(),
      iat,
      exp,
    };

    return this.generateToken(payload);
  }

  private generateToken(payload: DynamicQrPayload): string {
    const header = { alg: "EdDSA", typ: "JWT" };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );
    const signingInput = `${headerB64}.${payloadB64}`;

    const signature = crypto.sign(
      null,
      Buffer.from(signingInput, "utf8"),
      this.privateKey,
    );
    const signatureB64 = signature.toString("base64url");

    return `${signingInput}.${signatureB64}`;
  }
}
