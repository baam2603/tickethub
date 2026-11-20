import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../../identity/interface/decorators/current-user.decorator";
import { SettlementOperations } from "../application/settlement-operations";

@Injectable()
export class ActiveSettlementAdminGuard implements CanActivate {
  constructor(
    @Inject(SettlementOperations)
    private readonly service: SettlementOperations,
  ) {}
  async canActivate(context: ExecutionContext) {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    if (!(await this.service.isActiveAdmin(user.userId)))
      throw new ForbiddenException("ACTIVE_SETTLEMENT_ADMIN_REQUIRED");
    return true;
  }
}
