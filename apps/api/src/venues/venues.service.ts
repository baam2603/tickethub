import { Injectable, Inject, NotFoundException, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { and, eq, ilike, or, count, desc, sql } from "drizzle-orm";
import { db } from "../database/db";
import { venues } from "../database/schema/venues";
import { venueLayouts } from "../database/schema/venue-layouts";
import { REDIS_CLIENT } from "../database/redis.module";
import type {
  CreateVenueDto,
  UpdateVenueDto,
  CreateVenueLayoutDto,
  VenueFilterQueryDto,
} from "@tickethub/shared";

@Injectable()
export class VenuesService {
  private readonly logger = new Logger(VenuesService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Lấy danh sách địa điểm khả dụng kèm bộ lọc
   */
  async getVenues(filters: VenueFilterQueryDto) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const cacheKey = `venues:list:${JSON.stringify({ ...filters, page, limit })}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.warn(`Redis get error: ${(err as Error).message}`);
    }

    const conditions = [eq(venues.isActive, true)];

    if (filters.city) {
      conditions.push(eq(venues.city, filters.city));
    }

    if (filters.category) {
      conditions.push(eq(venues.category, filters.category));
    }

    if (filters.search) {
      const searchPattern = `%${filters.search.trim()}%`;
      conditions.push(
        or(
          ilike(venues.name, searchPattern),
          ilike(venues.shortName, searchPattern),
          ilike(venues.district, searchPattern),
          ilike(venues.address, searchPattern),
        )!,
      );
    }

    const whereClause = and(...conditions);

    // Truy vấn dữ liệu địa điểm
    const items = await db
      .select({
        id: venues.id,
        name: venues.name,
        shortName: venues.shortName,
        city: venues.city,
        district: venues.district,
        address: venues.address,
        category: venues.category,
        totalCapacity: venues.totalCapacity,
        thumbnailUrl: venues.thumbnailUrl,
        description: venues.description,
        isActive: venues.isActive,
        createdAt: venues.createdAt,
        updatedAt: venues.updatedAt,
      })
      .from(venues)
      .where(whereClause)
      .orderBy(desc(venues.createdAt))
      .limit(limit)
      .offset(offset);

    // Đếm tổng số bản ghi
    const countRows = await db
      .select({ totalCount: count() })
      .from(venues)
      .where(whereClause);
    const totalCount = countRows[0]?.totalCount ?? 0;

    // Lấy số lượng layout cho từng địa điểm
    const venueIds = items.map((v) => v.id);
    const layoutCountsMap = new Map<string, number>();

    if (venueIds.length > 0) {
      const layoutCounts = await db
        .select({
          venueId: venueLayouts.venueId,
          count: count(),
        })
        .from(venueLayouts)
        .where(
          and(
            eq(venueLayouts.isActive, true),
            sql`${venueLayouts.venueId} IN ${venueIds}`,
          ),
        )
        .groupBy(venueLayouts.venueId);

      for (const row of layoutCounts) {
        layoutCountsMap.set(row.venueId, Number(row.count));
      }
    }

    const enrichedItems = items.map((item) => ({
      ...item,
      layoutsCount: layoutCountsMap.get(item.id) || 0,
    }));

    const response = {
      items: enrichedItems,
      total: Number(totalCount),
      page,
      limit,
    };

    try {
      await this.redis.set(cacheKey, JSON.stringify(response), "EX", 3600);
    } catch (err) {
      this.logger.warn(`Redis set error: ${(err as Error).message}`);
    }

    return response;
  }

  /**
   * Lấy chi tiết một địa điểm theo ID
   */
  async getVenueById(id: string) {
    const cacheKey = `venue:detail:${id}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.warn(`Redis get error: ${(err as Error).message}`);
    }

    const [venue] = await db
      .select()
      .from(venues)
      .where(and(eq(venues.id, id), eq(venues.isActive, true)))
      .limit(1);

    if (!venue) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "VENUE_NOT_FOUND",
          message: "Không tìm thấy địa điểm tổ chức",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const layouts = await this.getVenueLayouts(id);

    const result = {
      ...venue,
      layouts,
    };

    try {
      await this.redis.set(cacheKey, JSON.stringify(result), "EX", 3600);
    } catch (err) {
      this.logger.warn(`Redis set error: ${(err as Error).message}`);
    }

    return result;
  }

  /**
   * Lấy danh sách các sơ đồ layout của một địa điểm
   */
  async getVenueLayouts(venueId: string) {
    const cacheKey = `venue:layouts:${venueId}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.warn(`Redis get error: ${(err as Error).message}`);
    }

    const layouts = await db
      .select({
        id: venueLayouts.id,
        venueId: venueLayouts.venueId,
        name: venueLayouts.name,
        categoryName: venueLayouts.categoryName,
        description: venueLayouts.description,
        capacityEstimate: venueLayouts.capacityEstimate,
        mapKey: venueLayouts.mapKey,
        svgContent: venueLayouts.svgContent,
        defaultZones: venueLayouts.defaultZones,
        isDefault: venueLayouts.isDefault,
        isActive: venueLayouts.isActive,
        createdAt: venueLayouts.createdAt,
        updatedAt: venueLayouts.updatedAt,
      })
      .from(venueLayouts)
      .where(
        and(eq(venueLayouts.venueId, venueId), eq(venueLayouts.isActive, true)),
      )
      .orderBy(desc(venueLayouts.isDefault), desc(venueLayouts.createdAt));

    try {
      await this.redis.set(cacheKey, JSON.stringify(layouts), "EX", 86400);
    } catch (err) {
      this.logger.warn(`Redis set error: ${(err as Error).message}`);
    }

    return layouts;
  }

  /**
   * Tạo mới địa điểm (Admin)
   */
  async createVenue(dto: CreateVenueDto) {
    const venue = await this.insertVenueToDb(dto);
    await this.invalidateVenuesCache();
    return venue;
  }

  /**
   * Cập nhật thông tin địa điểm (Admin)
   */
  async updateVenue(id: string, dto: UpdateVenueDto) {
    const updated = await this.updateVenueInDb(id, dto);
    await this.invalidateVenuesCache(id);
    return updated;
  }

  /**
   * Thêm sơ đồ khán đài SVG cho địa điểm (Admin)
   */
  async createVenueLayout(venueId: string, dto: CreateVenueLayoutDto) {
    const layout = await this.insertVenueLayoutToDb(venueId, dto);
    await this.invalidateVenuesCache(venueId);
    return layout;
  }

  // Phương thức thao tác DB hỗ trợ testing và DI
  protected async insertVenueToDb(dto: CreateVenueDto) {
    const [venue] = await db
      .insert(venues)
      .values({
        name: dto.name,
        shortName: dto.shortName,
        city: dto.city,
        district: dto.district,
        address: dto.address,
        category: dto.category,
        totalCapacity: dto.totalCapacity,
        thumbnailUrl: dto.thumbnailUrl,
        description: dto.description,
      })
      .returning();
    return venue;
  }

  protected async updateVenueInDb(id: string, dto: UpdateVenueDto) {
    const [updated] = await db
      .update(venues)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(venues.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException({
        success: false,
        error: {
          code: "VENUE_NOT_FOUND",
          message: "Không tìm thấy địa điểm tổ chức để cập nhật",
          timestamp: new Date().toISOString(),
        },
      });
    }

    return updated;
  }

  protected async insertVenueLayoutToDb(
    venueId: string,
    dto: CreateVenueLayoutDto,
  ) {
    if (dto.isDefault) {
      await db
        .update(venueLayouts)
        .set({ isDefault: false })
        .where(eq(venueLayouts.venueId, venueId));
    }

    const [layout] = await db
      .insert(venueLayouts)
      .values({
        venueId,
        name: dto.name,
        categoryName: dto.categoryName,
        description: dto.description,
        capacityEstimate: dto.capacityEstimate,
        mapKey: dto.mapKey,
        svgContent: dto.svgContent,
        defaultZones: dto.defaultZones,
        isDefault: dto.isDefault ?? false,
      })
      .returning();

    return layout;
  }

  private async invalidateVenuesCache(venueId?: string) {
    try {
      const keysToDelete: string[] = [];

      if (venueId) {
        keysToDelete.push(`venue:detail:${venueId}`);
        keysToDelete.push(`venue:layouts:${venueId}`);
      }

      const listKeys = await this.redis.keys("venues:list:*");
      keysToDelete.push(...listKeys);

      if (keysToDelete.length > 0) {
        await this.redis.del(...keysToDelete);
      }
    } catch (err) {
      this.logger.warn(`Redis invalidate error: ${(err as Error).message}`);
    }
  }
}
