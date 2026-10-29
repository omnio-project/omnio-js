import { DbQueryError } from "@omniojs/core";
import { sql, Kysely, CompiledQuery } from "kysely";
import type { Migration } from "kysely/migration";
import { setGlobalConfig, deleteGlobalConfig } from "valibot";
import { test, describe } from "vite-plus/test";

import { initSqliteWasm, SqliteWasmDialect } from "../src/dialect.js";
import { SqliteWasmDialectError } from "../src/errors.js";
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

/**
 * メモリー上の SQLite WASM を使う kysely のインスタンスを作ります。
 *
 * スキーマーの検証とトランザクションの検証で使用します。
 *
 * @returns kysely のインスタンスです。
 */
async function createDatabase(): Promise<Kysely<SqliteWasmDatabase>> {
  const sqlite3 = await initSqliteWasm();

  return new Kysely<SqliteWasmDatabase>({
    dialect: new SqliteWasmDialect(new sqlite3.oo1.DB(":memory:", "c")),
  });
}

describe("SqliteWasmDialect", () => {
  test("単一のマイグレーションで journal スキーマを作成する", async ({ expect }) => {
    // 準備：
    expect(Object.keys(MIGRATIONS)).toStrictEqual([
      "001_create_journal",
      "002_normalize_journal_timestamps",
    ]);

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
      expect(journal[0]?.hash_algorithm).toBe("sha256");
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
      expect(notNull.get("hash_algorithm")).toBe(0);
      expect(notNull.get("user_metadata")).toBe(0);
      expect(notNull.get("created_at")).toBe(0);
      expect(notNull.get("updated_at")).toBe(0);

      expect(pragma.rows[0]?.foreign_keys).toBe(1);
      expect(children.rows[0]?.count).toBe(0);
    } finally {
      await db.destroy();
    }
  });

  test("down で journal と object_tag を削除する", async ({ expect }) => {
    // 準備：
    const migration = requireMigration("001_create_journal");
    const db = await createDatabase();

    try {
      await migration.up(db);

      // 実行：
      await migration.down?.(db);

      // 検証：
      const tables = await sql<{ count: number }>`
        select count(*) as count
        from sqlite_master
        where type = 'table' and name in ('journal', 'object_tag')
      `.execute(db);
      expect(tables.rows[0]?.count).toBe(0);
    } finally {
      await db.destroy();
    }
  });

  test("トランザクションをロールバックする", async ({ expect }) => {
    // 準備：
    const migration = requireMigration("001_create_journal");
    const db = await createDatabase();

    try {
      await migration.up(db);

      // 実行と検証：
      await expect(
        db.transaction().execute(async (transaction) => {
          await transaction
            .insertInto("journal")
            .values({
              key: "k1",
              dirty: 0,
              entity_id: "00000000-0000-4000-8000-000000000001",
              record_type: "CREATE",
              record_timestamp: "2026-01-01T00:00:00Z",
            })
            .execute();
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");

      const rows = await db.selectFrom("journal").selectAll().execute();
      expect(rows).toStrictEqual([]);
    } finally {
      await db.destroy();
    }
  });

  test("ブール値とバイナリ値をバインドできる", async ({ expect }) => {
    // 準備：
    const db = await createDatabase();
    const view = new Uint16Array([0x01_02]);

    try {
      // 実行：
      const booleans = await sql<{ value: number }>`select ${true} as value`.execute(db);
      const buffers = await sql<{ value: Uint8Array }>`
        select ${new Uint8Array([1, 2])} as value
      `.execute(db);
      const arrayBuffers = await sql<{ value: Uint8Array }>`
        select ${new ArrayBuffer(2)} as value
      `.execute(db);
      const views = await sql<{ value: Uint8Array }>`
        select ${view} as value
      `.execute(db);

      // 検証：
      expect(booleans.rows[0]?.value).toBe(1);
      expect(buffers.rows[0]?.value).toStrictEqual(new Uint8Array([1, 2]));
      expect(arrayBuffers.rows[0]?.value).toStrictEqual(new Uint8Array(2));
      expect(views.rows[0]?.value).toStrictEqual(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      );
    } finally {
      await db.destroy();
    }
  });

  test("未対応のバインド値は DbQueryError を投げる", async ({ expect }) => {
    // 準備：
    const db = await createDatabase();

    try {
      // 実行と検証：
      await expect(sql`select ${new Date()} as value`.execute(db)).rejects.toBeInstanceOf(
        DbQueryError,
      );
    } finally {
      await db.destroy();
    }
  });

  test("ストリームクエリーは SqliteWasmDialectError を投げる", async ({ expect }) => {
    // 準備：
    const sqlite3 = await initSqliteWasm();
    const driver = new SqliteWasmDialect(new sqlite3.oo1.DB(":memory:", "c")).createDriver();
    await driver.init();

    try {
      // 実行：
      const connection = await driver.acquireConnection();

      // 検証：
      expect(() => connection.streamQuery(CompiledQuery.raw("select 1"), 1)).toThrow(
        SqliteWasmDialectError,
      );
    } finally {
      await driver.destroy();
    }
  });

  test("既定のメッセージは英語である", ({ expect }) => {
    // 実行：
    const error = new SqliteWasmDialectError({ operation: "stream" });

    // 検証：
    expect(error.name).toBe("OmnioSqliteWasmDialectError");
    expect(error.message).toBe("Unsupported operation in the sqlite.wasm dialect: stream");
  });

  test("ja では日本語のメッセージを返す", ({ expect }) => {
    // 準備：
    setGlobalConfig({ lang: "ja" });

    try {
      // 実行：
      const error = new SqliteWasmDialectError({ operation: "stream" });

      // 検証：
      expect(error.message).toBe("sqlite.wasm dialect では対応していない処理です: stream");
    } finally {
      deleteGlobalConfig();
    }
  });
});
