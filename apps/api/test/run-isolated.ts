import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { env } from "../src/config/env.config";

// Dọn cả audit append-only bằng cách bỏ DB tạm, không DELETE log hay tắt trigger.
async function main() {
  if (!new URL(env.DATABASE_URL).pathname.endsWith("_test"))
    throw new Error("DATABASE_URL must point to a dedicated _test database");
  const name = `api_${randomUUID().replaceAll("-", "")}_test`;
  const url = new URL(env.DATABASE_URL);
  url.pathname = `/${name}`;
  const admin = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin`CREATE DATABASE ${admin(name)}`;
    await migrate(drizzle(client), {
      migrationsFolder: path.resolve("drizzle"),
    });
    const files = (await readdir("test", { recursive: true }))
      .filter((file) => file.endsWith(".test.ts"))
      .sort()
      .map((file) => path.join("test", file));
    async function run(args: string[]) {
      const child = spawn(process.execPath, ["--import", "tsx", ...args], {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          IPN_TEST_DB_NAME: name,
          NODE_ENV: "test",
        },
      });
      const stop = () => child.kill("SIGTERM");
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        return await new Promise<number>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code) => resolve(code ?? 1));
        });
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      }
    }
    if ((await run(["src/database/seed.ts"])) !== 0)
      throw new Error("Test seed failed");
    process.exitCode = await run(["--test", "--test-concurrency=1", ...files]);
  } finally {
    await client.end();
    await admin`DROP DATABASE IF EXISTS ${admin(name)} WITH (FORCE)`;
    await admin.end();
  }
}
void main().catch(() => {
  console.error(
    "ISOLATED_API_TEST_FAILED: kiểm tra quyền CREATE DATABASE và kết nối PostgreSQL/Redis",
  );
  process.exitCode = 1;
});
