import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { venues } from "../src/database/schema/venues";
import { venueLayouts } from "../src/database/schema/venue-layouts";
import { events } from "../src/database/schema/events";

describe("Venues & Venue Layouts Drizzle Schema Tests", () => {
  it("verifies venues table columns match ERD specification", () => {
    assert(venues !== undefined, "venues table should be defined");
    const cols = Object.keys(venues);

    assert(cols.includes("id"), "should have id column");
    assert(cols.includes("name"), "should have name column");
    assert(cols.includes("shortName"), "should have shortName column");
    assert(cols.includes("city"), "should have city column");
    assert(cols.includes("district"), "should have district column");
    assert(cols.includes("address"), "should have address column");
    assert(cols.includes("category"), "should have category column");
    assert(cols.includes("totalCapacity"), "should have totalCapacity column");
    assert(cols.includes("thumbnailUrl"), "should have thumbnailUrl column");
    assert(cols.includes("description"), "should have description column");
    assert(cols.includes("isActive"), "should have isActive column");
    assert(cols.includes("createdAt"), "should have createdAt column");
    assert(cols.includes("updatedAt"), "should have updatedAt column");
  });

  it("verifies venue_layouts table columns match ERD specification", () => {
    assert(venueLayouts !== undefined, "venueLayouts table should be defined");
    const cols = Object.keys(venueLayouts);

    assert(cols.includes("id"), "should have id column");
    assert(cols.includes("venueId"), "should have venueId column");
    assert(cols.includes("name"), "should have name column");
    assert(cols.includes("categoryName"), "should have categoryName column");
    assert(cols.includes("description"), "should have description column");
    assert(
      cols.includes("capacityEstimate"),
      "should have capacityEstimate column",
    );
    assert(cols.includes("mapKey"), "should have mapKey column");
    assert(cols.includes("svgContent"), "should have svgContent column");
    assert(cols.includes("defaultZones"), "should have defaultZones column");
    assert(cols.includes("isDefault"), "should have isDefault column");
    assert(cols.includes("isActive"), "should have isActive column");
    assert(cols.includes("createdAt"), "should have createdAt column");
    assert(cols.includes("updatedAt"), "should have updatedAt column");
  });

  it("verifies events table includes foreign keys venueId and venueLayoutId", () => {
    const cols = Object.keys(events);
    assert(cols.includes("venueId"), "events table should have venueId column");
    assert(
      cols.includes("venueLayoutId"),
      "events table should have venueLayoutId column",
    );
  });
});
