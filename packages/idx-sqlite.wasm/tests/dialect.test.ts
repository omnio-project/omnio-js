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
  test("既存データを journal に移行し、記録メタデータと外部キーを維持する", async ({ expect }) => {
    // 準備：
    const migration001 = requireMigration("001_create_objects");
    const migration002 = requireMigration("002_rename_objects_to_journal");
    const migration003 = requireMigration("003_add_record_metadata");
    const sqlite3 = await initSqliteWasm();
    const db = new Kysely<SqliteWasmDatabase>({
      dialect: new SqliteWasmDialect(new sqlite3.oo1.DB(":memory:", "c")),
    });

    try {
      await migration001.up(db);
      await sql`
        insert into objects (
          key,
          content_type,
          size,
          user_metadata,
          created_at,
          updated_at
        )
        values ('k1', 'text/plain', 3, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
      `.execute(db);
      await sql`
        insert into object_tags (key, tag)
        values ('k1', 'red')
      `.execute(db);

      await migration002.up(db);
      await migration003.up(db);

      // 実行：
      const journal = await db.selectFrom("journal").selectAll().execute();
      const pragma = await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(db);

      await db.deleteFrom("journal").where("key", "=", "k1").execute();
      const children = await sql<{ count: number }>`
        select count(*) as count from object_tags
      `.execute(db);

      // 検証：
      expect(journal).toHaveLength(1);
      expect(journal[0]?.record_type).toBe("CREATE");
      expect(journal[0]?.record_timestamp).toBe("2026-01-01T00:00:00Z");
      expect(pragma.rows[0]?.foreign_keys).toBe(1);
      expect(children.rows[0]?.count).toBe(0);
    } finally {
      await db.destroy();
    }
  });
});
