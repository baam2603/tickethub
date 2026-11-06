import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import argon2 from "argon2";
import { db } from "../database/db";
import {
  auditLog,
  eventStaff,
  gates,
  organizerStaff,
  users,
} from "../database/schema";
import { requireEvent, requireOrganizer } from "./access";
import type { Page, StaffCreate, StaffUpdate } from "./operations.schemas";
const publicStaff = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  phone: users.phone,
  status: users.status,
  createdAt: users.createdAt,
};
@Injectable()
export class StaffService {
  async create(userId: string, input: StaffCreate) {
    const profile = await requireOrganizer(userId);
    const passwordHash = await argon2.hash(input.password);
    try {
      return await db.transaction(async (tx) => {
        const [staff] = await tx
          .insert(users)
          .values({
            email: input.email,
            fullName: input.fullName,
            phone: input.phone ?? null,
            passwordHash,
            role: "GATE_STAFF",
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
          })
          .returning(publicStaff);
        await tx
          .insert(organizerStaff)
          .values({ userId: staff!.id, organizerId: profile.id });
        await tx.insert(auditLog).values({
          actorId: userId,
          actorRole: "ORGANIZER",
          action: "GATE_STAFF_CREATED",
          targetType: "USER",
          targetId: staff!.id,
          changes: { organizerId: profile.id },
        });
        return staff!;
      });
    } catch (error) {
      const cause =
        error && typeof error === "object" && "cause" in error
          ? error.cause
          : error;
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "23505"
      )
        throw new ConflictException("EMAIL_ALREADY_EXISTS");
      throw error;
    }
  }
  async list(userId: string, page: Page) {
    const profile = await requireOrganizer(userId);
    return db
      .select(publicStaff)
      .from(users)
      .innerJoin(organizerStaff, eq(organizerStaff.userId, users.id))
      .where(eq(organizerStaff.organizerId, profile.id))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(page.limit + 1)
      .offset((page.page - 1) * page.limit);
  }
  async update(userId: string, staffId: string, input: StaffUpdate) {
    const profile = await requireOrganizer(userId);
    return db.transaction(async (tx) => {
      const [staff] = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(organizerStaff, eq(organizerStaff.userId, users.id))
        .where(
          and(
            eq(users.id, staffId),
            eq(organizerStaff.organizerId, profile.id),
            eq(users.role, "GATE_STAFF"),
          ),
        )
        .for("update", { of: users });
      if (!staff) throw new NotFoundException("STAFF_NOT_FOUND");
      const [updated] = await tx
        .update(users)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(users.id, staffId))
        .returning(publicStaff);
      await tx.insert(auditLog).values({
        actorId: userId,
        actorRole: "ORGANIZER",
        action: "GATE_STAFF_UPDATED",
        targetType: "USER",
        targetId: staffId,
        changes: input,
      });
      return updated;
    });
  }
  async createGate(
    userId: string,
    eventId: string,
    input: { name: string; locationDesc?: string | undefined },
  ) {
    await requireEvent(userId, eventId);
    return db.transaction(async (tx) => {
      const [gate] = await tx
        .insert(gates)
        .values({ eventId, ...input })
        .returning();
      await tx.insert(auditLog).values({
        actorId: userId,
        actorRole: "ORGANIZER",
        action: "GATE_CREATED",
        targetType: "GATE",
        targetId: gate!.id,
        changes: { eventId },
      });
      return gate!;
    });
  }
  async listGates(userId: string, eventId: string, page: Page) {
    await requireEvent(userId, eventId);
    return db
      .select()
      .from(gates)
      .where(eq(gates.eventId, eventId))
      .orderBy(gates.name, gates.id)
      .limit(page.limit + 1)
      .offset((page.page - 1) * page.limit);
  }
  async assign(
    userId: string,
    eventId: string,
    input: { userId: string; gateId: string },
  ) {
    const { profile } = await requireEvent(userId, eventId);
    return db.transaction(async (tx) => {
      const [staff] = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(organizerStaff, eq(organizerStaff.userId, users.id))
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.role, "GATE_STAFF"),
            eq(users.status, "ACTIVE"),
            eq(organizerStaff.organizerId, profile.id),
          ),
        )
        .for("update", { of: users });
      if (!staff) throw new NotFoundException("STAFF_NOT_FOUND");
      const gate = await tx.query.gates.findFirst({
        where: and(eq(gates.id, input.gateId), eq(gates.eventId, eventId)),
      });
      if (!gate) throw new NotFoundException("GATE_NOT_FOUND");
      const [assignment] = await tx
        .insert(eventStaff)
        .values({
          eventId,
          userId: input.userId,
          gateId: input.gateId,
          staffRole: "GATE_SCANNER",
        })
        .onConflictDoUpdate({
          target: [eventStaff.eventId, eventStaff.userId],
          set: { gateId: input.gateId, staffRole: "GATE_SCANNER" },
        })
        .returning();
      await tx.insert(auditLog).values({
        actorId: userId,
        actorRole: "ORGANIZER",
        action: "GATE_STAFF_ASSIGNED",
        targetType: "EVENT",
        targetId: eventId,
        changes: input,
      });
      return assignment;
    });
  }
  async assignments(userId: string, eventId: string, page: Page) {
    await requireEvent(userId, eventId);
    return db
      .select({
        id: eventStaff.id,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        status: users.status,
        gateId: eventStaff.gateId,
      })
      .from(eventStaff)
      .innerJoin(users, eq(users.id, eventStaff.userId))
      .where(eq(eventStaff.eventId, eventId))
      .orderBy(users.fullName, users.id)
      .limit(page.limit + 1)
      .offset((page.page - 1) * page.limit);
  }
  async unassign(userId: string, eventId: string, staffId: string) {
    await requireEvent(userId, eventId);
    await db.transaction(async (tx) => {
      const removed = await tx
        .delete(eventStaff)
        .where(
          and(eq(eventStaff.eventId, eventId), eq(eventStaff.userId, staffId)),
        )
        .returning();
      if (!removed.length) throw new NotFoundException("ASSIGNMENT_NOT_FOUND");
      await tx.insert(auditLog).values({
        actorId: userId,
        actorRole: "ORGANIZER",
        action: "GATE_STAFF_UNASSIGNED",
        targetType: "EVENT",
        targetId: eventId,
        changes: { staffId },
      });
    });
    return { removed: true };
  }
}
