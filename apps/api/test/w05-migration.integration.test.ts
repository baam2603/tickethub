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

it("Nang cap W05 da chay migration 0006 cu: them nhom refund, giu staff/export/log bat bien va MV", async () => {
  assert.match(new URL(env.DATABASE_URL).pathname, /_test$/);
  const admin = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const name = `w05_${randomUUID().replaceAll("-", "")}_test`;
  const url = new URL(env.DATABASE_URL);
  url.pathname = `/${name}`;
  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const folder = await mkdtemp(path.join(tmpdir(), "w05-published-"));
  try {
    await admin`CREATE DATABASE ${admin(name)}`;
    const source = path.resolve("drizzle");
    const journal = JSON.parse(
      await readFile(path.join(source, "meta/_journal.json"), "utf8"),
    );
    const prefix = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 6,
    );
    const legacy = {
      idx: 6,
      version: "7",
      when: 1793955716399,
      tag: "0006_w05-staff-reporting",
      breakpoints: true,
    };
    await mkdir(path.join(folder, "meta"));
    await writeFile(
      path.join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: [...prefix, legacy] }),
    );
    for (const entry of prefix)
      await copyFile(
        path.join(source, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      );
    await copyFile(
      path.resolve("test/fixtures/w05-published-staff-reporting.sql"),
      path.join(folder, `${legacy.tag}.sql`),
    );
    await migrate(drizzle(client), { migrationsFolder: folder });
    const [user] =
      await client`INSERT INTO users(email,password_hash,full_name,role) VALUES (${`${name}@example.com`},'fixture-only','Organizer','ORGANIZER') RETURNING id`;
    const [staff] =
      await client`INSERT INTO users(email,password_hash,full_name,role) VALUES (${`staff-${name}@example.com`},'fixture-only','Staff','GATE_STAFF') RETURNING id`;
    const [org] =
      await client`INSERT INTO organizer_profiles(user_id,organization_name,representative_name,tax_code,business_license_url) VALUES (${user!.id},'Migration','Migration',${randomUUID()},'https://example.com/license') RETURNING id`;
    const [event] =
      await client`INSERT INTO events(organizer_id,title,slug,description,category,city,venue_name,venue_address,banner_url,start_time,end_time,gate_opening_time) VALUES (${org!.id},'Migration',${name},'Fixture','CONCERT','HCM','Venue','HCM','https://example.com/banner',now(),now()+interval '1 day',now()) RETURNING id`;
    const [order] =
      await client`INSERT INTO orders(user_id,event_id,order_code,total_amount,final_amount,status,expires_at,paid_at) VALUES (${user!.id},${event!.id},${randomUUID().replaceAll("-", "")},300000,300000,'PAID',now(),now()) RETURNING id`;
    await client`INSERT INTO organizer_staff(user_id,organizer_id) VALUES (${staff!.id},${org!.id})`;
    await client`INSERT INTO report_exports(requested_by,organizer_id,event_id,format) VALUES (${user!.id},${org!.id},${event!.id},'csv')`;
    await client`INSERT INTO gate_checkin_logs(event_id,staff_id,method,outcome) VALUES (${event!.id},${staff!.id},'QR','SUCCESS')`;
    await client`INSERT INTO refunds(order_id,amount,reason,status,idempotency_key,provider_request_id) VALUES (${order!.id},100000,'Legacy refund','PROCESSING',${randomUUID()},${randomUUID().replaceAll("-", "")})`;
    await client`REFRESH MATERIALIZED VIEW mv_event_sales_summary`;
    const before = {
      staff: await client`SELECT * FROM organizer_staff`,
      exports: await client`SELECT * FROM report_exports`,
      logs: await client`SELECT * FROM gate_checkin_logs`,
      refunds:
        await client`SELECT id,amount,status,provider_request_id FROM refunds`,
      summary:
        await client`SELECT paid_revenue,total_refunded_amount,net_revenue FROM mv_event_sales_summary`,
      indexes:
        await client`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'mv_event_%' ORDER BY indexname`,
    };
    await migrate(drizzle(client), { migrationsFolder: source });
    assert.deepEqual(await client`SELECT * FROM organizer_staff`, before.staff);
    assert.deepEqual(
      await client`SELECT * FROM report_exports`,
      before.exports,
    );
    assert.deepEqual(
      await client`SELECT * FROM gate_checkin_logs`,
      before.logs,
    );
    assert.deepEqual(
      await client`SELECT id,amount,status,provider_request_id FROM refunds`,
      before.refunds,
    );
    assert.deepEqual(
      await client`SELECT paid_revenue,total_refunded_amount,net_revenue FROM mv_event_sales_summary`,
      before.summary,
    );
    assert.deepEqual(
      await client`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'mv_event_%' ORDER BY indexname`,
      before.indexes,
    );
    assert.equal(
      (await client`SELECT provider_group_id,provider_amount FROM refunds`)[0]!
        .provider_group_id,
      null,
    );
    assert.equal(
      (
        await client`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
      )[0]!.n,
      21,
    );
    await assert.rejects(client`DELETE FROM gate_checkin_logs`, /append-only/);
    await migrate(drizzle(client), { migrationsFolder: source });
    assert.deepEqual(
      await client`SELECT * FROM gate_checkin_logs`,
      before.logs,
    );
  } finally {
    await client.end();
    await admin`DROP DATABASE IF EXISTS ${admin(name)}`;
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  }
});
