import { DatabaseSync } from "node:sqlite";

import { sql, Kysely } from "kysely";
import { Migrator, NO_MIGRATIONS } from "kysely/migration";
import { test, describe } from "vite-plus/test";

import { SqliteNodeDialect } from "../src/dialect.js";
import { SqliteNodeMigrationProvider } from "../src/migrations.js";
import type { SqliteNodeDatabase } from "../src/schema.js";

describe("マイグレーション", () => {
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

      const tables = await sql<{ name: string }>`
        select name
        from sqlite_master
        where type = 'table' and name in ('journal', 'object_tag', 'pending_purge')
        order by name
      `.execute(db);
      expect(tables.rows.map((row) => row.name)).toStrictEqual([
        "journal",
        "object_tag",
        "pending_purge",
      ]);
    } finally {
      // 後始末：
      await db.destroy();
    }
  });
});
