import { Module } from "@nestjs/common";
import Redis from "ioredis";
import { env } from "../config/env.config";
import { AuthModule } from "../auth/auth.module";
import { StaffService } from "../organizer-operations/staff.service";
import { OperationsController } from "../organizer-operations/operations.controller";
import { ReportsController } from "./reports.controller";
import { REPORT_REDIS, ReportsService } from "./reports.service";
@Module({
  imports: [AuthModule],
  controllers: [OperationsController, ReportsController],
  providers: [
    StaffService,
    ReportsService,
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
export class ReportingModule {}
