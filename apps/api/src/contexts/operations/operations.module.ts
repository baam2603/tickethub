import { Module } from "@nestjs/common";
import Redis from "ioredis";
import { env } from "../../config/env.config";
import { IdentityModule } from "../identity/identity.module";
import { StaffService as DrizzleStaffService } from "./infrastructure/staff.service";
import { OperationsController } from "./interface/operations.controller";
import { ReportsController } from "./interface/reports.controller";
import {
  REPORT_REDIS,
  ReportsService as DrizzleReportsService,
} from "./infrastructure/reports.service";
import { StaffService, ReportsService } from "./application/operations.ports";

@Module({
  imports: [IdentityModule],
  controllers: [OperationsController, ReportsController],
  providers: [
    { provide: StaffService, useClass: DrizzleStaffService },
    { provide: ReportsService, useClass: DrizzleReportsService },
    {
      provide: REPORT_REDIS,
      useFactory: () =>
        new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 500,
          commandTimeout: 500,
        }),
    },
  ],
})
export class OperationsModule {}
