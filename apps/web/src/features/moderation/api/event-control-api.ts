import type {
  AuditLogListData,
  EventControlListData,
  EventKillSwitchData,
  EventKillSwitchRequest,
  EventResumeData,
  EventResumeRequest,
} from "@tickethub/shared";
import { apiClient } from "@/shared/api/client";

export function getEventControls(params: URLSearchParams, signal: AbortSignal) {
  return apiClient<EventControlListData>(`/admin/events/control?${params}`, {
    cache: "no-store",
    signal,
  });
}

export function getEventAuditLogs(
  id: string,
  page: number,
  signal: AbortSignal,
) {
  return apiClient<AuditLogListData>(
    `/admin/events/${id}/audit-logs?page=${page}`,
    { cache: "no-store", signal },
  );
}

export function activateKillSwitch(id: string, body: EventKillSwitchRequest) {
  return apiClient<EventKillSwitchData>(`/admin/events/${id}/kill-switch`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resumeEvent(id: string, body: EventResumeRequest) {
  return apiClient<EventResumeData>(`/admin/events/${id}/resume`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
