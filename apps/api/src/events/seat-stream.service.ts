import {
  Injectable,
  Inject,
  Logger,
  OnApplicationShutdown,
  Optional,
} from "@nestjs/common";
import type Redis from "ioredis";
import { Observable, Subject } from "rxjs";
import { REDIS_CLIENT } from "../database/redis.module";

export interface SeatStatusChangedPayload {
  seatIds: string[];
  status: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED";
  expiresAt: string | null;
}

export interface SeatStreamMessageEvent {
  data: SeatStatusChangedPayload | { type: string };
  type?: string;
  id?: string;
  retry?: number;
}

interface ChannelSubscription {
  subject: Subject<SeatStreamMessageEvent>;
  refCount: number;
}

@Injectable()
export class SeatStreamService implements OnApplicationShutdown {
  private readonly logger = new Logger(SeatStreamService.name);
  private readonly subscriberClient: Redis;
  private readonly channels = new Map<string, ChannelSubscription>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly publisherClient: Redis,
    @Optional() subscriberClient?: Redis,
  ) {
    if (subscriberClient) {
      this.subscriberClient = subscriberClient;
    } else {
      this.subscriberClient = this.publisherClient.duplicate();
    }

    this.subscriberClient.on("message", (channel: string, message: string) => {
      this.handleIncomingRedisMessage(channel, message);
    });

    this.subscriberClient.on("error", (err: unknown) => {
      this.logger.error("Redis subscriber error in SeatStreamService", err);
    });
  }

  /**
   * Phát thông báo cập nhật trạng thái ghế vào kênh Redis Pub/Sub
   */
  async publishSeatStatusChanged(
    eventId: string,
    payload: SeatStatusChangedPayload,
  ): Promise<void> {
    const channel = `events:${eventId}:seats`;
    try {
      const message = JSON.stringify(payload);
      await this.publisherClient.publish(channel, message);
    } catch (error) {
      this.logger.warn(
        `Failed to publish seat status changed event to Redis channel ${channel}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Khởi tạo luồng Observable Server-Sent Events cho client
   */
  createSeatStream(
    eventId: string,
    abortSignal?: AbortSignal,
  ): Observable<SeatStreamMessageEvent> {
    const channel = `events:${eventId}:seats`;
    let subInfo = this.channels.get(channel);

    if (!subInfo) {
      subInfo = {
        subject: new Subject<SeatStreamMessageEvent>(),
        refCount: 0,
      };
      this.channels.set(channel, subInfo);
      this.subscriberClient.subscribe(channel).catch((err) => {
        this.logger.error(
          `Failed to subscribe to Redis channel ${channel}`,
          err,
        );
      });
    }

    subInfo.refCount++;

    return new Observable<SeatStreamMessageEvent>((observer) => {
      const activeSubInfo = this.channels.get(channel);
      if (!activeSubInfo) {
        observer.complete();
        return;
      }

      const subscription = activeSubInfo.subject.subscribe({
        next: (event) => observer.next(event),
        error: (err) => observer.error(err),
        complete: () => observer.complete(),
      });

      // Heartbeat ping timer duy trì kết nối qua reverse proxy
      const heartbeatInterval = setInterval(() => {
        observer.next({
          type: "ping",
          data: { type: "ping" },
        });
      }, 20000);

      const cleanup = () => {
        clearInterval(heartbeatInterval);
        subscription.unsubscribe();
        this.decrementRefCount(channel);
      };

      if (abortSignal) {
        abortSignal.addEventListener("abort", () => {
          cleanup();
        });
      }

      return () => {
        cleanup();
      };
    });
  }

  /**
   * Lấy số lượng client đang lắng nghe trên kênh (phục vụ kiểm thử và giám sát)
   */
  getChannelRefCount(eventId: string): number {
    const channel = `events:${eventId}:seats`;
    const sub = this.channels.get(channel);
    return sub ? sub.refCount : 0;
  }

  private handleIncomingRedisMessage(channel: string, message: string): void {
    const subInfo = this.channels.get(channel);
    if (!subInfo) {
      return;
    }

    try {
      const payload = JSON.parse(message) as SeatStatusChangedPayload;
      subInfo.subject.next({
        type: "seat_status_changed",
        data: payload,
      });
    } catch (err) {
      this.logger.error(
        `Failed to parse Redis message on channel ${channel}: ${message}`,
        err,
      );
    }
  }

  private decrementRefCount(channel: string): void {
    const subInfo = this.channels.get(channel);
    if (!subInfo) {
      return;
    }

    subInfo.refCount--;

    if (subInfo.refCount <= 0) {
      this.channels.delete(channel);
      this.subscriberClient.unsubscribe(channel).catch((err) => {
        this.logger.error(
          `Failed to unsubscribe from Redis channel ${channel}`,
          err,
        );
      });
      subInfo.subject.complete();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      for (const [_channel, sub] of this.channels.entries()) {
        sub.subject.complete();
      }
      this.channels.clear();
      await this.subscriberClient.quit();
    } catch {
      // Ignored during shutdown
    }
  }
}
