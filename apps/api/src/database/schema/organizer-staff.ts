import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizerProfiles } from "./organizer-profiles";

export const organizerStaff = pgTable(
  "organizer_staff",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organizerProfiles.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_organizer_staff_owner").on(t.organizerId)],
);
