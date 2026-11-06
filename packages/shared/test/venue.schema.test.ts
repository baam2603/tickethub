import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VenueCityEnum,
  VenueCategoryEnum,
  CreateVenueSchema,
  UpdateVenueSchema,
  CreateVenueLayoutSchema,
  VenueFilterQuerySchema,
} from "../src";

describe("Venue & Venue Layout Validation Schemas", () => {
  it("validates VenueCityEnum and VenueCategoryEnum values", () => {
    assert.deepEqual(VenueCityEnum, ["TP. Hồ Chí Minh", "Hà Nội", "Đà Nẵng"]);
    assert.deepEqual(VenueCategoryEnum, [
      "stadium",
      "arena",
      "theater",
      "sports",
    ]);
  });

  it("CreateVenueSchema accepts valid input and rejects invalid city or category", () => {
    const validData = {
      name: "Sân vận động Quốc gia Mỹ Đình",
      shortName: "SVĐ Mỹ Đình",
      city: "Hà Nội",
      district: "Nam Từ Liêm",
      address: "Đường Lê Đức Thọ, Phường Mỹ Đình 1, Nam Từ Liêm, Hà Nội",
      category: "stadium",
      totalCapacity: "40,000+",
      thumbnailUrl: "/images/venues/my-dinh.webp",
      description: "Sân vận động quốc gia lớn nhất miền Bắc",
    };

    const parsed = CreateVenueSchema.parse(validData);
    assert.equal(parsed.name, validData.name);
    assert.equal(parsed.city, "Hà Nội");
    assert.equal(parsed.category, "stadium");

    // Invalid city
    assert.throws(() =>
      CreateVenueSchema.parse({
        ...validData,
        city: "Hải Phòng",
      }),
    );

    // Invalid category
    assert.throws(() =>
      CreateVenueSchema.parse({
        ...validData,
        category: "club",
      }),
    );
  });

  it("UpdateVenueSchema allows partial updates", () => {
    const partialData = {
      name: "SVĐ Mỹ Đình Mới",
      totalCapacity: "45,000",
      isActive: false,
    };

    const parsed = UpdateVenueSchema.parse(partialData);
    assert.equal(parsed.name, "SVĐ Mỹ Đình Mới");
    assert.equal(parsed.isActive, false);
    assert.equal(parsed.city, undefined);
  });

  it("CreateVenueLayoutSchema validates default_zones and rejects unsafe SVG", () => {
    const validLayout = {
      name: "Sân Khấu Chữ T (Live Concert)",
      categoryName: "Live Concert",
      capacityEstimate: "25,000 - 30,000",
      mapKey: "my-dinh-concert-t-stage",
      svgContent: '<svg viewBox="0 0 1000 800"><g id="stage"></g></svg>',
      defaultZones: [
        {
          zoneName: "VVIP Khán Đài A",
          color: "#E5A93C",
          price: 3500000,
          capacity: 1500,
        },
        {
          zoneName: "GA Sân Cỏ - Fanzone",
          color: "#3B82F6",
          price: 1200000,
          capacity: 6000,
        },
      ],
      isDefault: true,
    };

    const parsed = CreateVenueLayoutSchema.parse(validLayout);
    assert.equal(parsed.name, validLayout.name);
    assert.equal(parsed.defaultZones.length, 2);

    // Rejects SVG with script tag
    assert.throws(() =>
      CreateVenueLayoutSchema.parse({
        ...validLayout,
        svgContent: '<svg><script>alert("xss")</script></svg>',
      }),
    );
  });

  it("VenueFilterQuerySchema parses defaults and filters", () => {
    const defaults = VenueFilterQuerySchema.parse({});
    assert.equal(defaults.page, 1);
    assert.equal(defaults.limit, 20);

    const filtered = VenueFilterQuerySchema.parse({
      city: "Đà Nẵng",
      category: "arena",
      search: "Tiên Sơn",
      page: "2",
      limit: "10",
    });

    assert.equal(filtered.city, "Đà Nẵng");
    assert.equal(filtered.category, "arena");
    assert.equal(filtered.search, "Tiên Sơn");
    assert.equal(filtered.page, 2);
    assert.equal(filtered.limit, 10);
  });
});
