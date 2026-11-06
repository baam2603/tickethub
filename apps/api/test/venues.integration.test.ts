import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VenuesController } from "../src/venues/venues.controller";
import { AdminVenuesController } from "../src/venues/admin-venues.controller";
import { VenuesService } from "../src/venues/venues.service";
import type Redis from "ioredis";
import type {
  CreateVenueDto,
  CreateVenueLayoutDto,
  VenueFilterQueryDto,
} from "@tickethub/shared";

interface MemoryVenue extends CreateVenueDto {
  id: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface MemoryLayout extends CreateVenueLayoutDto {
  id: string;
  venueId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

describe("Venues Integration Flow Simulation", () => {
  it("allows Admin to create venue and layout, and Public to search and view layouts", async () => {
    const memoryVenues: MemoryVenue[] = [];
    const memoryLayouts: MemoryLayout[] = [];
    const cacheStore = new Map<string, string>();

    const mockRedis = {
      get: async (key: string) => cacheStore.get(key) || null,
      set: async (key: string, value: string) => {
        cacheStore.set(key, value);
        return "OK";
      },
      del: async (...keys: string[]) => {
        for (const k of keys) cacheStore.delete(k);
        return keys.length;
      },
      keys: async (pattern: string) => {
        const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
        return Array.from(cacheStore.keys()).filter((k) => regex.test(k));
      },
    } as unknown as Redis;

    const venuesService = new VenuesService(mockRedis);

    // Mock DB operations to use in-memory store
    venuesService["insertVenueToDb"] = async (dto: CreateVenueDto) => {
      const newV = {
        id: `v-${memoryVenues.length + 1}`,
        ...dto,
        thumbnailUrl: dto.thumbnailUrl || null,
        description: dto.description || null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryVenues.push(newV);
      return newV;
    };

    venuesService["insertVenueLayoutToDb"] = async (
      venueId: string,
      dto: CreateVenueLayoutDto,
    ) => {
      const newL = {
        id: `layout-${memoryLayouts.length + 1}`,
        venueId,
        ...dto,
        isDefault: dto.isDefault ?? false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryLayouts.push(newL);
      return newL;
    };

    venuesService["getVenues"] = async (filters: VenueFilterQueryDto) => {
      let filtered = [...memoryVenues];
      if (filters.city) {
        filtered = filtered.filter((v) => v.city === filters.city);
      }
      if (filters.category) {
        filtered = filtered.filter((v) => v.category === filters.category);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        filtered = filtered.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            v.shortName.toLowerCase().includes(q) ||
            v.district.toLowerCase().includes(q),
        );
      }
      return {
        items: filtered.map((v) => ({
          ...v,
          layoutsCount: memoryLayouts.filter((l) => l.venueId === v.id).length,
        })),
        total: filtered.length,
        page: filters.page || 1,
        limit: filters.limit || 20,
      };
    };

    venuesService["getVenueById"] = async (id: string) => {
      const v = memoryVenues.find((item) => item.id === id);
      if (!v) throw new Error("Venue not found");
      const layouts = memoryLayouts.filter((l) => l.venueId === id);
      return { ...v, layouts };
    };

    venuesService["getVenueLayouts"] = async (venueId: string) => {
      return memoryLayouts.filter((l) => l.venueId === venueId);
    };

    const publicController = new VenuesController(venuesService);
    const adminController = new AdminVenuesController(venuesService);

    // 1. Admin creates Curated Venue: SVĐ Mỹ Đình
    const createVenueRes = await adminController.createVenue({
      name: "Sân vận động Quốc gia Mỹ Đình",
      shortName: "SVĐ Mỹ Đình",
      city: "Hà Nội",
      district: "Nam Từ Liêm",
      address: "Đường Lê Đức Thọ, Phường Mỹ Đình 1, Nam Từ Liêm, Hà Nội",
      category: "stadium",
      totalCapacity: "40,000+",
      thumbnailUrl: "/images/venues/my-dinh.webp",
      description: "Sân vận động quốc gia hàng đầu tại Hà Nội",
    });

    assert.equal(createVenueRes.success, true);
    const venueId = createVenueRes.data.id;

    // 2. Admin adds SVG Layout
    const createLayoutRes = await adminController.createVenueLayout(venueId, {
      name: "Sân Khấu Chữ T (Live Concert T-Stage)",
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
      ],
      isDefault: true,
    });

    assert.equal(createLayoutRes.success, true);
    assert.equal(createLayoutRes.data.mapKey, "my-dinh-concert-t-stage");

    // 3. Organizer / Public searches venues by city
    const haNoiVenues = await publicController.getVenues({ city: "Hà Nội" });
    assert.equal(haNoiVenues.success, true);
    assert.equal(haNoiVenues.data.items.length, 1);
    assert.equal(haNoiVenues.data.items[0]?.layoutsCount, 1);

    // 4. Search with non-matching city returns 0
    const hcmVenues = await publicController.getVenues({
      city: "TP. Hồ Chí Minh",
    });
    assert.equal(hcmVenues.success, true);
    assert.equal(hcmVenues.data.items.length, 0);

    // 5. Query layout details for event setup
    const layoutsRes = await publicController.getVenueLayouts(venueId);
    assert.equal(layoutsRes.success, true);
    assert.equal(layoutsRes.data.length, 1);
    assert.equal(
      layoutsRes.data[0]?.defaultZones[0]?.zoneName,
      "VVIP Khán Đài A",
    );
  });
});
