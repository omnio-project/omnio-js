import type { SqlIndexBackend } from "@omniojs/idx-sql";
import { SqlObjectIndex } from "@omniojs/idx-sql";
import { Kysely } from "kysely";
import type { MigrationProvider } from "kysely/migration";
import * as v from "valibot";

import { type SqliteWasmHandle, initSqliteWasm, SqliteWasmDialect } from "./dialect.js";
import { SqliteWasmMigrationProvider } from "./migrations.js";
import type { SqliteWasmDatabase } from "./schema.js";

/**
 * `SqliteWasmIndex` のオプションです。
 */
export type SqliteWasmIndexOptions = {
  /** データベースの保存場所です。既定値はメモリーです。 */
  readonly location?: string | undefined;
};

/**
 * `SqliteWasmIndex` のコンストラクター引数を検証するスキーマです。
 */
const SqliteWasmIndexOptionsSchema = v.object({
  location: v.optional(v.pipe(v.string(), v.minLength(1))),
});

/**
 * 開いているデータベースハンドルを閉じます。
 *
 * Kysely の `destroy()` はドライバーの初期化に失敗していると接続を破棄しないため、後始末のフォールバックとして使います。
 *
 * @param handle 閉じるデータベースハンドルです。
 */
function closeHandle(handle: SqliteWasmHandle): void {
  if (!handle.isOpen()) {
    return;
  }

  try {
    handle.close();
  } catch {
    // 元のエラーを優先するため、後始末の失敗は無視します。
  }
}

/**
 * WASM 版 SQLite による `IObjectIndex` の実装です。
 */
export class SqliteWasmIndex extends SqlObjectIndex {
  protected override readonly fullTextOperator = "LIKE" as const;

  readonly #location: string;

  /**
   * @param options データベースの保存場所などの設定です。
   */
  public constructor(options: SqliteWasmIndexOptions = {}) {
    super();

    const parsed = v.parse(SqliteWasmIndexOptionsSchema, options);
    this.#location = parsed.location ?? ":memory:";
  }

  protected override async createBackend(): Promise<SqlIndexBackend> {
    const sqlite3 = await initSqliteWasm();
    const handle = new sqlite3.oo1.DB(this.#location, "c");
    const kysely = new Kysely<SqliteWasmDatabase>({
      dialect: new SqliteWasmDialect(handle),
    });

    return {
      kysely,
      dispose: async () => {
        await kysely.destroy().catch(() => undefined);
        closeHandle(handle);
      },
    };
  }

  protected override createMigrationProvider(): MigrationProvider {
    return new SqliteWasmMigrationProvider();
  }
}
