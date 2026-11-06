import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { env } from "../src/config/env.config";

it("Migration W04: DB legacy co du 4 MV, du lieu/index duoc giu; ACL va dependency la rollback an toan", async () => {
  assert.match(new URL(env.DATABASE_URL).pathname, /_test$/);
  const admin = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const database = `w04_migration_${randomUUID().replaceAll("-", "")}_test`;
  const url = new URL(env.DATABASE_URL);
  url.pathname = `/${database}`;
  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const folder = await mkdtemp(path.join(tmpdir(), "tickethub-migrations-"));
  try {
    await admin`CREATE DATABASE ${admin(database)}`;
    const source = path.resolve("drizzle");
    const journal = JSON.parse(
      await readFile(path.join(source, "meta/_journal.json"), "utf8"),
    );
    await mkdir(path.join(folder, "meta"));
    const prefix = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 5,
    );
    await writeFile(
      path.join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: prefix }),
    );
    for (const entry of prefix)
      await copyFile(
        path.join(source, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      );
    await migrate(drizzle(client), { migrationsFolder: folder });
    const [user] =
      await client`INSERT INTO users(email,password_hash,full_name,role) VALUES (${`${database}@example.com`},'fixture-only','Buyer','BUYER') RETURNING id`;
    const [org] =
      await client`INSERT INTO organizer_profiles(user_id,organization_name,representative_name,tax_code,business_license_url) VALUES (${user!.id},'Migration','Migration',${randomUUID()},'https://example.com/license') RETURNING id`;
    const [event] =
      await client`INSERT INTO events(organizer_id,title,slug,description,category,city,venue_name,venue_address,banner_url,start_time,end_time,gate_opening_time) VALUES (${org!.id},'Migration',${database},'Fixture','CONCERT','HCM','Venue','HCM','https://example.com/banner',now(),now()+interval '1 day',now()) RETURNING id`;
    const [type] =
      await client`INSERT INTO ticket_types(event_id,name,price,capacity,sale_start_time,sale_end_time) VALUES (${event!.id},'GA',100000,3,now(),now()+interval '1 day') RETURNING id`;
    const [order] =
      await client`INSERT INTO orders(user_id,event_id,order_code,total_amount,final_amount,status,expires_at,paid_at) VALUES (${user!.id},${event!.id},${randomUUID().replaceAll("-", "")},300000,300000,'PAID',now(),now()) RETURNING id`;
    await client`INSERT INTO order_items(order_id,ticket_type_id,quantity,unit_price,subtotal) VALUES (${order!.id},${type!.id},3,100000,300000)`;
    await client`INSERT INTO tickets(order_id,user_id,event_id,ticket_type_id,ticket_code,status) SELECT ${order!.id},${user!.id},${event!.id},${type!.id},'MIGRATION-'||n,'SOLD' FROM generate_series(1,3) n`;
    await client.unsafe(
      await readFile(
        path.resolve("test/fixtures/w04-legacy-report-views.sql"),
        "utf8",
      ),
    );
    const definitions =
      await client`SELECT matviewname,definition FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname`;
    const indexes =
      await client`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'mv_event_%' ORDER BY indexname`;
    assert.equal(definitions.length, 4);
    assert.equal(indexes.length, 5);
    const contents = async () =>
      Promise.all(
        definitions.map(async ({ matviewname }) => {
          const rows =
            await client`SELECT to_jsonb(v)-'refreshed_at' AS value FROM ${client(matviewname)} v ORDER BY 1`;
          return rows.map((row) => row.value);
        }),
      );
    const before = await contents();
    await client`GRANT SELECT ON mv_event_sales_summary TO PUBLIC`;
    await assert.rejects(
      migrate(drizzle(client), { migrationsFolder: source }),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        /Custom report MV ownership\/grants/.test(error.cause.message),
    );
    assert.equal(
      (
        await client`SELECT character_maximum_length AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='status'`
      )[0]!.n,
      20,
    );
    assert.deepEqual(await contents(), before);
    await client`REVOKE SELECT ON mv_event_sales_summary FROM PUBLIC`;
    // REVOKE vẫn giữ ACL tường minh. Tạo lại MV fixture với quyền mặc định trong DB tạm, không sửa system catalog.
    const summary = definitions.find(
      (row) => row.matviewname === "mv_event_sales_summary",
    )!;
    await client`DROP MATERIALIZED VIEW mv_event_sales_summary`;
    await client.unsafe(
      `CREATE MATERIALIZED VIEW mv_event_sales_summary AS ${summary.definition}`,
    );
    for (const index of indexes.filter(
      (row) => row.indexname === "idx_mv_event_sales_id",
    ))
      await client.unsafe(index.indexdef);
    await client`CREATE VIEW custom_report_dependency AS SELECT * FROM mv_event_sales_summary`;
    await assert.rejects(
      migrate(drizzle(client), { migrationsFolder: source }),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        /depend/.test(error.cause.message),
    );
    assert.deepEqual(await contents(), before);
    await client`DROP VIEW custom_report_dependency`;
    await migrate(drizzle(client), { migrationsFolder: source });
    assert.equal(
      (
        await client`SELECT character_maximum_length AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='status'`
      )[0]!.n,
      32,
    );
    assert.deepEqual(await contents(), before);
    assert.deepEqual(
      (
        await client`SELECT matviewname FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname`
      ).map((row) => row.matviewname),
      definitions.map((row) => row.matviewname),
    );
    // pg_get_viewdef có thể chuẩn hóa lại cast/ARRAY sau khi parse; so sánh kết quả SQL gốc.
    for (const status of [
      "REFUNDED",
      "EXPIRED",
      "PAYMENT_EXPIRED_REFUND_PENDING",
    ]) {
      await client`UPDATE orders SET status=${status} WHERE id=${order!.id}`;
      for (const view of definitions) {
        await client`REFRESH MATERIALIZED VIEW ${client(view.matviewname)}`;
        const expected = await client.unsafe(
          `SELECT to_jsonb(v)-'refreshed_at' AS value FROM (${view.definition.replace(/;\s*$/, "")}) v ORDER BY 1`,
        );
        const actual =
          await client`SELECT to_jsonb(v)-'refreshed_at' AS value FROM ${client(view.matviewname)} v ORDER BY 1`;
        assert.deepEqual(actual, expected);
      }
    }
    await client`UPDATE orders SET status='PAID' WHERE id=${order!.id}`;
    assert.deepEqual(
      await client`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'mv_event_%' ORDER BY indexname`,
      indexes,
    );
    for (const view of definitions)
      await client`REFRESH MATERIALIZED VIEW CONCURRENTLY ${client(view.matviewname)}`;
    await migrate(drizzle(client), { migrationsFolder: source });
    assert.deepEqual(await contents(), before);
    assert.equal(
      (
        await client`SELECT count(*)::int AS n FROM tickets WHERE order_id=${order!.id}`
      )[0]!.n,
      3,
    );
  } finally {
    await client.end();
    await admin`DROP DATABASE IF EXISTS ${admin(database)}`;
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  }
});
