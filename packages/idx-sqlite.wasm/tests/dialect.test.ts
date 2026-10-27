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
  test("単一のマイグレーションで journal スキーマを作成する", async ({ expect }) => {
    // 準備：
    expect(Object.keys(MIGRATIONS)).toStrictEqual(["001_create_journal"]);

    const migration = requireMigration("001_create_journal");
    const sqlite3 = await initSqliteWasm();
    const db = new Kysely<SqliteWasmDatabase>({
      dialect: new SqliteWasmDialect(new sqlite3.oo1.DB(":memory:", "c")),
    });

    try {
      await migration.up(db);
      await sql`
        insert into journal (
          key,
          entity_id,
          record_type,
          record_timestamp,
          content_type,
          size,
          user_metadata,
          created_at,
          updated_at
        )
        values (
          'k1',
          '00000000-0000-4000-8000-000000000001',
          'CREATE',
          '2026-01-01T00:00:00Z',
          'text/plain',
          3,
          '{}',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z'
        )
      `.execute(db);
      await sql`
        insert into object_tag (key, tag)
        values ('k1', 'red')
      `.execute(db);

      // 実行：
      const journal = await db.selectFrom("journal").selectAll().execute();
      const tags = await db.selectFrom("object_tag").selectAll().execute();
      const columns = await sql<{
        name: string;
        notnull: number;
      }>`
        pragma table_info(journal)
      `.execute(db);
      const pragma = await sql<{ foreign_keys: number }>`pragma foreign_keys`.execute(db);

      await db.deleteFrom("journal").where("key", "=", "k1").execute();
      const children = await sql<{ count: number }>`
        select count(*) as count from object_tag
      `.execute(db);

      // 検証：
      expect(journal).toHaveLength(1);
      expect(journal[0]?.entity_id).toBe("00000000-0000-4000-8000-000000000001");
      expect(journal[0]?.record_type).toBe("CREATE");
      expect(journal[0]?.record_timestamp).toBe("2026-01-01T00:00:00Z");
      expect(journal[0]?.dirty).toBe(0);
      expect(tags).toStrictEqual([
        {
          key: "k1",
          tag: "red",
        },
      ]);

      const notNull = new Map(columns.rows.map((column) => [column.name, column.notnull]));
      expect(notNull.get("key")).toBe(1);
      expect(notNull.get("entity_id")).toBe(1);
      expect(notNull.get("record_type")).toBe(1);
      expect(notNull.get("record_timestamp")).toBe(1);
      expect(notNull.get("dirty")).toBe(1);
      expect(notNull.get("content_type")).toBe(0);
      expect(notNull.get("size")).toBe(0);
      expect(notNull.get("user_metadata")).toBe(0);
      expect(notNull.get("created_at")).toBe(0);
      expect(notNull.get("updated_at")).toBe(0);

      expect(pragma.rows[0]?.foreign_keys).toBe(1);
      expect(children.rows[0]?.count).toBe(0);
    } finally {
      await db.destroy();
    }
  });
});
