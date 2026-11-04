import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { env } from "../../config/env.config";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers["authorization"];

    if (!authHeader || typeof authHeader !== "string") {
      throw new UnauthorizedException({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Yêu cầu token xác thực Bearer",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const [bearer, token] = authHeader.split(" ");
    if (bearer !== "Bearer" || !token) {
      throw new UnauthorizedException({
        success: false,
        error: {
          code: "INVALID_TOKEN_FORMAT",
          message: "Định dạng token không hợp lệ",
          timestamp: new Date().toISOString(),
        },
      });
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: env.JWT_SECRET,
      });
      request.user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException({
        success: false,
        error: {
          code: "TOKEN_EXPIRED_OR_INVALID",
          message: "Token đã hết hạn hoặc không hợp lệ",
          timestamp: new Date().toISOString(),
        },
      });
    }
  }
}
