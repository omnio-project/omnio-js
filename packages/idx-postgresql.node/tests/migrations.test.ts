import { sql, Kysely, PostgresDialect } from "kysely";
import type { Migration } from "kysely/migration";
import { Pool } from "pg";
import { test, describe, beforeEach } from "vite-plus/test";

import { MIGRATIONS } from "../src/migrations.js";
import type { PostgresqlDatabase } from "../src/schema.js";
import { resetTestSchema, MIGRATIONS_TEST_SCHEMA, getTestConnectionString } from "./database.js";

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

describe("マイグレーション", () => {
  beforeEach(async () => {
    await resetTestSchema(MIGRATIONS_TEST_SCHEMA);
  });

  test("journal スキーマを作成し、タグを外部キーで連動させる", async ({ expect }) => {
    // 準備：
    expect(Object.keys(MIGRATIONS)).toStrictEqual(["001_create_journal"]);

    const migration = requireMigration("001_create_journal");
    const pool = new Pool({
      connectionString: getTestConnectionString(MIGRATIONS_TEST_SCHEMA),
    });
    const db = new Kysely<PostgresqlDatabase>({
      dialect: new PostgresDialect({ pool }),
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
          hash_algorithm,
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
          'sha256',
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
        column_name: string;
        is_nullable: string;
      }>`
        select column_name, is_nullable
        from information_schema.columns
        where table_schema = ${MIGRATIONS_TEST_SCHEMA} and table_name = 'journal'
      `.execute(db);

      await db.deleteFrom("journal").where("key", "=", "k1").execute();
      const children = await sql<{ count: number }>`
        select count(*)::integer as count from object_tag
      `.execute(db);

      // 検証：
      expect(journal).toHaveLength(1);
      expect(journal[0]?.entity_id).toBe("00000000-0000-4000-8000-000000000001");
      expect(journal[0]?.record_type).toBe("CREATE");
      expect(journal[0]?.record_timestamp).toBe("2026-01-01T00:00:00Z");
      expect(journal[0]?.dirty).toBe(0);
      expect(journal[0]?.hash_algorithm).toBe("sha256");
      expect(tags).toStrictEqual([
        {
          key: "k1",
          tag: "red",
        },
      ]);

      const nullable = new Map(
        columns.rows.map((column) => [column.column_name, column.is_nullable]),
      );
      expect(nullable.get("key")).toBe("NO");
      expect(nullable.get("entity_id")).toBe("NO");
      expect(nullable.get("record_type")).toBe("NO");
      expect(nullable.get("record_timestamp")).toBe("NO");
      expect(nullable.get("dirty")).toBe("NO");
      expect(nullable.get("content_type")).toBe("YES");
      expect(nullable.get("size")).toBe("YES");
      expect(nullable.get("hash_algorithm")).toBe("YES");
      expect(nullable.get("user_metadata")).toBe("YES");
      expect(nullable.get("created_at")).toBe("YES");
      expect(nullable.get("updated_at")).toBe("YES");

      expect(children.rows[0]?.count).toBe(0);
    } finally {
      await db.destroy();
    }
  });

  test("down で journal と object_tag を削除する", async ({ expect }) => {
    // 準備：
    const migration = requireMigration("001_create_journal");
    const pool = new Pool({
      connectionString: getTestConnectionString(MIGRATIONS_TEST_SCHEMA),
    });
    const db = new Kysely<PostgresqlDatabase>({
      dialect: new PostgresDialect({ pool }),
    });

    try {
      await migration.up(db);

      // 実行：
      await migration.down?.(db);

      // 検証：
      const tables = await sql<{ count: number }>`
        select count(*)::integer as count
        from information_schema.tables
        where table_schema = ${MIGRATIONS_TEST_SCHEMA}
          and table_name in ('journal', 'object_tag')
      `.execute(db);
      expect(tables.rows[0]?.count).toBe(0);
    } finally {
      await db.destroy();
    }
  });
});
