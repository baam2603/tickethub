import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Inject,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { UserRole } from "@tickethub/shared";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "FORBIDDEN_RESOURCE",
          message: "Không đủ quyền hạn truy cập tài nguyên",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const hasRole = requiredRoles.includes(user.role as UserRole);
    if (!hasRole) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "FORBIDDEN_RESOURCE",
          message: `Tài nguyên yêu cầu quyền: ${requiredRoles.join(", ")}`,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return true;
  }
}
