import { apiClient } from "@/shared/api/client";
import type {
  PayoutRow,
  ReconciliationReport,
  SettlementPage,
} from "../domain/settlement.types";

export function getReconciliations(
  params: URLSearchParams,
  signal: AbortSignal,
) {
  return apiClient<ReconciliationReport>(`/admin/reconciliations?${params}`, {
    cache: "no-store",
    signal,
  });
}

export function getPayouts(params: URLSearchParams, signal: AbortSignal) {
  return apiClient<SettlementPage<PayoutRow>>(`/admin/payouts?${params}`, {
    cache: "no-store",
    signal,
  });
}

export function generatePayout(eventId: string) {
  return apiClient<unknown>("/admin/payouts/generate", {
    method: "POST",
    body: JSON.stringify({ eventId }),
  });
}

export function updatePayout(
  id: string,
  action: "approve" | "hold" | "recalculate",
  reason: string,
) {
  return apiClient<unknown>(`/admin/payouts/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(action === "hold" ? { reason } : {}),
  });
}
