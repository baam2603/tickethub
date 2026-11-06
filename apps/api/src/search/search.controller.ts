import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SearchQuerySchema } from "@tickethub/shared";

import { SearchService } from "./search.service";
import { SearchRateLimitGuard } from "./guards/search-rate-limit.guard";

@Controller("api/v1/search")
@UseGuards(SearchRateLimitGuard)
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly searchService: SearchService,
  ) {}

  @Get("events")
  async searchEvents(@Query() query: unknown) {
    const parsed = SearchQuerySchema.safeParse(query);

    if (!parsed.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Bo loc tim kiem khong hop le",
          details: parsed.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await this.searchService.searchEvents(parsed.data);

    return {
      success: true,
      data,
    };
  }
}
