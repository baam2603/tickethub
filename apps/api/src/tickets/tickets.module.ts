import { Module } from "@nestjs/common";
import { TicketsController } from "./tickets.controller";
import { GateController } from "./gate.controller";
import { TicketsService } from "./tickets.service";
import { Ed25519Service } from "./crypto/ed25519.service";

@Module({
  controllers: [TicketsController, GateController],
  providers: [TicketsService, Ed25519Service],
  exports: [TicketsService, Ed25519Service],
})
export class TicketsModule {}
