import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  BadRequestException,
} from "@nestjs/common";
import { VenuesService } from "./venues.service";
import { VenueFilterQuerySchema } from "@tickethub/shared";

@Controller("api/v1/venues")
export class VenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  @Get()
  async getVenues(@Query() query: unknown) {
    const parseResult = VenueFilterQuerySchema.safeParse(query);
    if (!parseResult.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_QUERY_PARAMS",
          message: "Tham số tìm kiếm không hợp lệ",
          details: parseResult.error.format(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const data = await this.venuesService.getVenues(parseResult.data);
    return {
      success: true,
      data,
    };
  }

  @Get(":id")
  async getVenueById(@Param("id", ParseUUIDPipe) id: string) {
    const data = await this.venuesService.getVenueById(id);
    return {
      success: true,
      data,
    };
  }

  @Get(":id/layouts")
  async getVenueLayouts(@Param("id", ParseUUIDPipe) id: string) {
    const data = await this.venuesService.getVenueLayouts(id);
    return {
      success: true,
      data,
    };
  }
}
