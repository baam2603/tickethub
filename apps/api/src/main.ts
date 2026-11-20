import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import fastifyCookie from "@fastify/cookie";
import { AppModule } from "./app.module";
import { env } from "./config/env.config";
import { isAllowedIp, parseIpAllowlist } from "./config/ip-allowlist";
import { initializePaymentMonitoring } from "./monitoring/payment-monitoring";

async function bootstrap() {
  initializePaymentMonitoring();
  const trustedProxies = parseIpAllowlist(env.TRUSTED_PROXY_CIDRS);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: env.NODE_ENV !== "production",
      trustProxy: (address: string) => isAllowedIp(trustedProxies, address),
    }),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyCookie as any, {
    secret: env.JWT_SECRET,
  });

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  app.enableShutdownHooks();

  await app.listen(env.PORT, "0.0.0.0");
  console.log(`TicketHub API listening on http://0.0.0.0:${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
