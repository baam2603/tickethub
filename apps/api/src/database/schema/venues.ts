import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    shortName: varchar("short_name", { length: 100 }).notNull(),
    city: varchar("city", { length: 50 }).notNull(),
    district: varchar("district", { length: 100 }).notNull(),
    address: text("address").notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    totalCapacity: varchar("total_capacity", { length: 50 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_venues_city_category").on(table.city, table.category)],
);
