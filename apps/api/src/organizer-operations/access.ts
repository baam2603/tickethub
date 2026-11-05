import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { db } from "../database/db";
import { events, organizerProfiles, users } from "../database/schema";
export async function requireOrganizer(userId: string) {
  const [row] = await db
    .select({ profile: organizerProfiles })
    .from(organizerProfiles)
    .innerJoin(users, eq(users.id, organizerProfiles.userId))
    .where(
      and(
        eq(users.id, userId),
        eq(users.role, "ORGANIZER"),
        eq(users.status, "ACTIVE"),
        eq(organizerProfiles.status, "VERIFIED"),
      ),
    );
  if (!row) throw new ForbiddenException("VERIFIED_ORGANIZER_REQUIRED");
  return row.profile;
}
export async function requireEvent(userId: string, eventId: string) {
  const profile = await requireOrganizer(userId);
  const event = await db.query.events.findFirst({
    where: and(eq(events.id, eventId), eq(events.organizerId, profile.id)),
  });
  if (!event) throw new NotFoundException("EVENT_NOT_FOUND");
  return { profile, event };
}
