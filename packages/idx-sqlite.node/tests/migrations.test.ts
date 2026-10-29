import { DatabaseSync } from "node:sqlite";

import { withMetadataFilter } from "@omniojs/idx-sql";
import { sql, Kysely } from "kysely";
import { Migrator, NO_MIGRATIONS } from "kysely/migration";
import { test, describe } from "vite-plus/test";

import { SqliteNodeDialect } from "../src/dialect.js";
import { SqliteNodeMigrationProvider } from "../src/migrations.js";
import type { SqliteNodeDatabase } from "../src/schema.js";

describe("マイグレーション", () => {
  test("002 で旧形式の日時を正規化する", async ({ expect }) => {
    // 準備：
    const db = new Kysely<SqliteNodeDatabase>({
      dialect: new SqliteNodeDialect(new DatabaseSync(":memory:")),
    });

    try {
      const migrator = new Migrator({
        db,
        provider: new SqliteNodeMigrationProvider(),
      });
      const first = await migrator.migrateTo("001_create_journal");
      expect(first.error).toBeUndefined();

      await sql`
        insert into journal (
          key,
          entity_id,
          record_type,
          record_timestamp,
          created_at,
          updated_at
        )
        values (
          'legacy',
          '00000000-0000-4000-8000-000000000001',
          'CREATE',
          '2026-01-03T09:00:00+0900',
          '2026-01-01T09:00:00+0900',
          '2026-01-02T09:00:00+09'
        )
      `.execute(db);
      const before = await db
        .selectFrom("journal")
        .select(["created_at", "updated_at", "record_timestamp"])
        .where("key", "=", "legacy")
        .executeTakeFirstOrThrow();

      // 実行：
      const latest = await migrator.migrateToLatest();

      // 検証：
      expect(latest.error).toBeUndefined();
      expect(before.created_at).toBe("2026-01-01T09:00:00+0900");
      expect(before.updated_at).toBe("2026-01-02T09:00:00+09");
      expect(before.record_timestamp).toBe("2026-01-03T09:00:00+0900");

      const after = await db
        .selectFrom("journal")
        .select(["created_at", "updated_at", "record_timestamp"])
        .where("key", "=", "legacy")
        .executeTakeFirstOrThrow();
      expect(after.created_at).toBe("2026-01-01T00:00:00.000Z");
      expect(after.updated_at).toBe("2026-01-02T00:00:00.000Z");
      expect(after.record_timestamp).toBe("2026-01-03T00:00:00.000Z");

      const matched = await withMetadataFilter(db.selectFrom("journal").select("key"), {
        createdAt: "2026-01-01T00:00:00.000Z",
      }).execute();
      expect(matched.map((row) => row.key)).toStrictEqual(["legacy"]);
    } finally {
      // 後始末：
      await db.destroy();
    }
  });

  test("NO_MIGRATIONS まで戻して再度最新まで適用できる", async ({ expect }) => {
    // 準備：
    const db = new Kysely<SqliteNodeDatabase>({
      dialect: new SqliteNodeDialect(new DatabaseSync(":memory:")),
    });

    try {
      const migrator = new Migrator({
        db,
        provider: new SqliteNodeMigrationProvider(),
      });
      const latest = await migrator.migrateToLatest();
      expect(latest.error).toBeUndefined();

      // 実行：
      const down = await migrator.migrateTo(NO_MIGRATIONS);
      const again = await migrator.migrateToLatest();

      // 検証：
      expect(down.error).toBeUndefined();
      expect(again.error).toBeUndefined();

      const tables = await sql<{ count: number }>`
        select count(*) as count
        from sqlite_master
        where type = 'table' and name = 'journal'
      `.execute(db);
      expect(tables.rows[0]?.count).toBe(1);
    } finally {
      // 後始末：
      await db.destroy();
    }
  });

  test("解釈できない旧データは保持したまま移行する", async ({ expect }) => {
    // 準備：
    const db = new Kysely<SqliteNodeDatabase>({
      dialect: new SqliteNodeDialect(new DatabaseSync(":memory:")),
    });

    try {
      const migrator = new Migrator({
        db,
        provider: new SqliteNodeMigrationProvider(),
      });
      const first = await migrator.migrateTo("001_create_journal");
      expect(first.error).toBeUndefined();

      await sql`
        insert into journal (
          key,
          entity_id,
          record_type,
          record_timestamp,
          created_at,
          updated_at
        )
        values
          (
            'valid',
            '00000000-0000-4000-8000-000000000001',
            'CREATE',
            '2026-01-03T09:00:00+0900',
            '2026-01-01T09:00:00+0900',
            '2026-01-02T09:00:00+09'
          ),
          (
            'invalid',
            '00000000-0000-4000-8000-000000000002',
            'CREATE',
            'not-a-date',
            'not-a-date',
            'not-a-date'
          )
      `.execute(db);

      // 実行：
      const latest = await migrator.migrateToLatest();

      // 検証：
      expect(latest.error).toBeUndefined();

      const valid = await db
        .selectFrom("journal")
        .select(["created_at", "updated_at", "record_timestamp"])
        .where("key", "=", "valid")
        .executeTakeFirstOrThrow();
      expect(valid.created_at).toBe("2026-01-01T00:00:00.000Z");
      expect(valid.updated_at).toBe("2026-01-02T00:00:00.000Z");
      expect(valid.record_timestamp).toBe("2026-01-03T00:00:00.000Z");

      const invalid = await db
        .selectFrom("journal")
        .select(["created_at", "updated_at", "record_timestamp"])
        .where("key", "=", "invalid")
        .executeTakeFirstOrThrow();
      expect(invalid.created_at).toBe("not-a-date");
      expect(invalid.updated_at).toBe("not-a-date");
      expect(invalid.record_timestamp).toBe("not-a-date");

      const recorded = await sql<{ count: number }>`
        select count(*) as count
        from kysely_migration
        where name = '002_normalize_journal_timestamps'
      `.execute(db);
      expect(recorded.rows[0]?.count).toBe(1);
    } finally {
      // 後始末：
      await db.destroy();
    }
  });
});
