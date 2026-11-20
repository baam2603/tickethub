import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { sqlClient } from "../src/database/db";
import { env } from "../src/config/env.config";

test("W04 migration preserves legacy report views and rolls back on unknown dependencies", async () => {
  assert.match(new URL(env.DATABASE_URL).pathname, /^\/[a-z][a-z0-9_]*_test$/);
  const rollback = new Error("Rollback legacy migration fixture");
  const script = await readFile("drizzle/0005_goofy_ken_ellis.sql", "utf8");
  const statements = script.split("--> statement-breakpoint");
  try {
    await assert.rejects(
      sqlClient.begin(async (tx) => {
        await tx`ALTER TABLE orders ALTER COLUMN status TYPE varchar(35)`;
        const names = [
          "mv_event_sales_summary",
          "mv_event_ticket_sales",
          "mv_event_report_daily",
          "mv_event_report_facts",
        ];
        for (const name of names) {
          await tx`CREATE MATERIALIZED VIEW ${tx(name)} AS
            SELECT id, status FROM orders`;
          await tx`CREATE UNIQUE INDEX ${tx(name + "_fixture_idx")} ON ${tx(name)} (id)`;
        }
        await tx`GRANT SELECT ON mv_event_sales_summary TO PUBLIC`;

        await tx`CREATE VIEW w04_unknown_dependency AS SELECT * FROM mv_event_sales_summary`;
        await assert.rejects(
          tx.savepoint(async (sp) => {
            await sp.unsafe(statements[0]!);
          }),
          /depend/,
        );
        await tx`DROP VIEW w04_unknown_dependency`;

        const snapshot = async () => tx`
          SELECT c.relname, c.relacl::text, c.relispopulated,
            ARRAY(SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i WHERE i.indrelid = c.oid) AS indexes
          FROM pg_class c WHERE c.relname IN ${tx(names)} ORDER BY c.relname
        `;
        const before = await snapshot();
        for (const statement of statements) await tx.unsafe(statement);
        assert.deepEqual([...(await snapshot())], [...before]);
        const [row] = await tx`
          SELECT character_maximum_length AS length
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'status'
        `;
        assert.equal(row?.length, 40);
        throw rollback;
      }),
      (error: unknown) => error === rollback,
    );
  } finally {
    await sqlClient.end();
  }
});
