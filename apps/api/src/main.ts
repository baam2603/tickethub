import type { FastifyRequest } from "fastify";
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
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger:
        env.NODE_ENV === "production"
          ? false
          : {
              serializers: {
                req(request: FastifyRequest) {
                  const path = request.url?.split("?", 1)[0];
                  const callback =
                    path === "/api/v1/payments/vnpay/ipn" ||
                    path === "/api/v1/internal/vnpay/ipn-preview";
                  return {
                    method: request.method,
                    url: callback ? path : request.url,
                    remoteAddress: request.ip,
                  };
                },
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
