import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { AuthenticatedUser } from "../auth/decorators/current-user.decorator";
import { db } from "../database/db";
import { users } from "../database/schema";

@Injectable()
export class ActiveSettlementAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    const admin = await db.query.users.findFirst({
      columns: { id: true },
      where: and(
        eq(users.id, user.userId),
        eq(users.status, "ACTIVE"),
        eq(users.role, "ADMIN"),
      ),
    });
    if (!admin)
      throw new ForbiddenException("ACTIVE_SETTLEMENT_ADMIN_REQUIRED");
    return true;
  }
}
