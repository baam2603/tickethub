import { Module } from "@nestjs/common";
import { VenuesController } from "./venues.controller";
import { AdminVenuesController } from "./admin-venues.controller";
import { VenuesService } from "./venues.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [VenuesController, AdminVenuesController],
  providers: [VenuesService],
  exports: [VenuesService],
})
export class VenuesModule {}
