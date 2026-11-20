import * as Sentry from "@sentry/node";
import { env } from "../config/env.config";

export function initializePaymentMonitoring() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    defaultIntegrations: false,
    beforeSend(event) {
      if (event.tags?.component !== "payments") return null;
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });
}

export function paymentSignal(
  event: string,
  level: "warning" | "error",
  fields: Record<string, string | number> = {},
) {
  const message = JSON.stringify({ event, level, ...fields });
  if (level === "error") console.error(message);
  else console.warn(message);
  if (env.SENTRY_DSN)
    Sentry.captureMessage(event, {
      level,
      tags: { component: "payments" },
      extra: fields,
    });
}

export async function flushPaymentMonitoring() {
  return !env.SENTRY_DSN || Sentry.flush(2_000);
}
