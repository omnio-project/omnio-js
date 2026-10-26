import { sql, Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import { test, describe } from "vite-plus/test";

import { initSqliteWasm, SqliteWasmDialect } from "../src/dialect.js";
import { MIGRATIONS } from "../src/migrations.js";
import type { SqliteWasmDatabase } from "../src/schema.js";

/**
 * 指定した名前のマイグレーションを取得します。
 *
 * @param name マイグレーションの名前です。
 *
 * @returns マイグレーションです。
 */
function requireMigration(name: string): Migration {
  const migration = MIGRATIONS[name];

  if (migration === undefined) {
    throw new Error(`マイグレーション ${name} が見つかりません。`);
  }

  return migration;
}

describe("SqliteWasmDialect", () => {
  test("外部キーを有効にし、親の削除で子をカスケード削除する", async ({ expect }) => {
    // 準備：
    const migration = requireMigration("001_create_objects");
    const sqlite3 = await initSqliteWasm();
    const db = new Kysely<SqliteWasmDatabase>({
      dialect: new SqliteWasmDialect(new sqlite3.oo1.DB(":memory:", "c")),
    });

    try {
      await migration.up(db);
      await db
        .insertInto("objects")
        .values({
          key: "k1",
          hash: null,
          size: 3,
          embedding: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          description: null,
          content_type: "text/plain",
          user_metadata: "{}",
          embedding_dims: null,
          embedding_model: null,
          embedding_source: null,
        })
        .execute();
      await db
        .insertInto("object_tags")
        .values({
          key: "k1",
          tag: "red",
        })
        .execute();

      // 実行：
      const pragma = await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(db);

      await db.deleteFrom("objects").where("key", "=", "k1").execute();
      const children = await sql<{ count: number }>`
        select count(*) as count from object_tags
      `.execute(db);

      // 検証：
      expect(pragma.rows[0]?.foreign_keys).toBe(1);
      expect(children.rows[0]?.count).toBe(0);
    } finally {
      await db.destroy();
    }
  });
});
