import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { venues } from "./venues";

export const venueLayouts = pgTable(
  "venue_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    categoryName: varchar("category_name", { length: 100 }).notNull(),
    description: text("description"),
    capacityEstimate: varchar("capacity_estimate", { length: 50 }).notNull(),
    mapKey: varchar("map_key", { length: 100 }).notNull(),
    svgContent: text("svg_content"),
    defaultZones: jsonb("default_zones").notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_venue_layouts_venue_id").on(table.venueId),
    index("idx_venue_layouts_map_key").on(table.mapKey),
  ],
);
