import { parseIpAllowlist, isAllowedIp } from "./config/ip-allowlist";
import { initializePaymentMonitoring } from "./shared-kernel/payment-monitoring";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import fastifyCookie from "@fastify/cookie";
import { AppModule } from "./app.module";
import { env } from "./config/env.config";

async function bootstrap() {
  initializePaymentMonitoring();
  const trusted = parseIpAllowlist(env.TRUSTED_PROXY_CIDRS);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: (ip) => isAllowedIp(trusted, ip),
      logger: {
        serializers: {
          req: (request: { method?: string; url?: string; ip?: string }) => ({
            method: request.method ?? "",
            url: request.url?.split("?")[0] ?? "",
            remoteAddress: request.ip ?? "",
          }),
        },
      },
    }),
  );

  await app.register(fastifyCookie, {
    secret: env.JWT_SECRET,
  });

  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(env.PORT, "0.0.0.0");
  console.log(`TicketHub API listening on http://0.0.0.0:${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
