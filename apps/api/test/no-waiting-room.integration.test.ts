import "reflect-metadata";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { Type } from "@nestjs/common";

import { AppModule } from "../src/app.module";
import { BookingService } from "../src/booking/booking.service";
import { CreateEventRequestSchema } from "@tickethub/shared";

// Hang cho ao (UC03) da bi loai bo hoan toan (AGENTS.md muc 1.3).
// Cac bai kiem tra nay khong can PostgreSQL hay Redis.

type ModuleRef = Type<unknown>;

function collectModules(root: ModuleRef): ModuleRef[] {
  const seen = new Set<ModuleRef>();
  const visit = (mod: ModuleRef) => {
    if (seen.has(mod)) return;
    seen.add(mod);
    const imports: ModuleRef[] =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) ?? [];
    for (const dep of imports) visit(dep);
  };
  visit(root);
  return [...seen];
}

describe("Hang cho ao (UC03) da bi loai bo", () => {
  it("Khong con module hay controller nao dang ky duong dan /waiting-room", () => {
    const controllerPaths = collectModules(AppModule).flatMap((mod) => {
      const controllers: ModuleRef[] =
        Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) ?? [];
      return controllers.map((c) =>
        String(Reflect.getMetadata(PATH_METADATA, c) ?? ""),
      );
    });

    assert.ok(controllerPaths.length > 0, "Phai doc duoc danh sach controller");
    assert.deepEqual(
      controllerPaths.filter((p) => /waiting/i.test(p)),
      [],
    );
  });

  it("holdSeats chi nhan userId va dto, khong nhan admissionToken", () => {
    assert.equal(BookingService.prototype.holdSeats.length, 2);
  });

  it("Schema tao su kien khong con truong hang cho ao", () => {
    const keys = Object.keys(CreateEventRequestSchema.shape);
    assert.equal(keys.includes("isWaitingRoomEnabled"), false);
    assert.equal(keys.includes("maxActiveUsers"), false);
  });
});
