import { apiClient } from "@/shared/api/client";
import type {
  AdminPendingEvent,
  AdminPendingOrganizer,
  ReviewDecision,
} from "../domain/moderation.types";

export function getAdminOrganizers() {
  return apiClient<AdminPendingOrganizer[]>("/admin/organizers", {
    cache: "no-store",
  });
}

export function getAdminPendingEvents() {
  return apiClient<AdminPendingEvent[]>("/admin/events", {
    cache: "no-store",
  });
}

function review(
  resource: "events" | "organizers",
  { id, ...body }: ReviewDecision,
) {
  return apiClient<unknown>(`/admin/${resource}/${id}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function reviewOrganizerProfile(decision: ReviewDecision) {
  return review("organizers", decision);
}

export function reviewAdminEvent(decision: ReviewDecision) {
  return review("events", decision);
}
