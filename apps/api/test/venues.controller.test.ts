import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VenuesController } from "../src/venues/venues.controller";
import { AdminVenuesController } from "../src/venues/admin-venues.controller";
import type { VenuesService } from "../src/venues/venues.service";
import type {
  CreateVenueDto,
  UpdateVenueDto,
  CreateVenueLayoutDto,
} from "@tickethub/shared";

describe("Venues Controllers Unit Tests", () => {
  const mockVenue = {
    id: "venue-uuid-1",
    name: "Sân vận động Mỹ Đình",
    shortName: "SVĐ Mỹ Đình",
    city: "Hà Nội",
    district: "Nam Từ Liêm",
    address: "Đường Lê Đức Thọ",
    category: "stadium",
    totalCapacity: "40,000",
    thumbnailUrl: null,
    description: null,
    isActive: true,
    layoutsCount: 1,
  };

  const mockLayout = {
    id: "layout-uuid-1",
    venueId: "venue-uuid-1",
    name: "Concert T-Stage",
    categoryName: "Live Concert",
    capacityEstimate: "25,000",
    mapKey: "my-dinh-t-stage",
    svgContent: "<svg></svg>",
    defaultZones: [],
    isDefault: true,
  };

  const mockVenuesService = {
    getVenues: async () => ({
      items: [mockVenue],
      total: 1,
      page: 1,
      limit: 20,
    }),
    getVenueById: async (id: string) => ({
      ...mockVenue,
      id,
      layouts: [mockLayout],
    }),
    getVenueLayouts: async () => [mockLayout],
    createVenue: async (dto: CreateVenueDto) => ({
      id: "new-venue-id",
      ...dto,
      isActive: true,
    }),
    updateVenue: async (id: string, dto: UpdateVenueDto) => ({
      id,
      ...mockVenue,
      ...dto,
    }),
    createVenueLayout: async (venueId: string, dto: CreateVenueLayoutDto) => ({
      id: "new-layout-id",
      venueId,
      ...dto,
      isDefault: dto.isDefault ?? false,
      isActive: true,
    }),
  } as unknown as VenuesService;

  it("VenuesController getVenues returns list of curated venues", async () => {
    const controller = new VenuesController(mockVenuesService);
    const result = await controller.getVenues({});

    assert.equal(result.success, true);
    assert.equal(result.data.items.length, 1);
    assert.equal(result.data.items[0]?.id, "venue-uuid-1");
  });

  it("VenuesController getVenueById returns venue details", async () => {
    const controller = new VenuesController(mockVenuesService);
    const result = await controller.getVenueById("venue-uuid-1");

    assert.equal(result.success, true);
    assert.equal(result.data.id, "venue-uuid-1");
    assert.equal(result.data.layouts.length, 1);
  });

  it("VenuesController getVenueLayouts returns layouts", async () => {
    const controller = new VenuesController(mockVenuesService);
    const result = await controller.getVenueLayouts("venue-uuid-1");

    assert.equal(result.success, true);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.mapKey, "my-dinh-t-stage");
  });

  it("AdminVenuesController createVenue validates and calls service", async () => {
    const controller = new AdminVenuesController(mockVenuesService);
    const newVenue: CreateVenueDto = {
      name: "Cung Điền kinh",
      shortName: "Cung ĐK",
      city: "Hà Nội",
      district: "Nam Từ Liêm",
      address: "Trần Hữu Dực",
      category: "arena",
      totalCapacity: "5,000",
    };

    const result = await controller.createVenue(newVenue);
    assert.equal(result.success, true);
    assert.equal(result.data.name, "Cung Điền kinh");
  });

  it("AdminVenuesController updateVenue updates venue data", async () => {
    const controller = new AdminVenuesController(mockVenuesService);
    const result = await controller.updateVenue("venue-uuid-1", {
      name: "SVĐ Mỹ Đình Đã Đổi Tên",
    });

    assert.equal(result.success, true);
    assert.equal(result.data.name, "SVĐ Mỹ Đình Đã Đổi Tên");
  });

  it("AdminVenuesController createVenueLayout creates layout for venue", async () => {
    const controller = new AdminVenuesController(mockVenuesService);
    const newLayout: CreateVenueLayoutDto = {
      name: "Sân Khấu 360",
      categoryName: "Concert",
      capacityEstimate: "30,000",
      mapKey: "my-dinh-360",
      defaultZones: [],
    };

    const result = await controller.createVenueLayout(
      "venue-uuid-1",
      newLayout,
    );
    assert.equal(result.success, true);
    assert.equal(result.data.name, "Sân Khấu 360");
  });
});
