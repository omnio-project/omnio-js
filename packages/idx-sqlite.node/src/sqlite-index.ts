import { DatabaseSync } from "node:sqlite";

import type { SqlIndexBackend } from "@omniojs/idx-sql";
import { SqlObjectIndex } from "@omniojs/idx-sql";
import { Kysely } from "kysely";
import type { MigrationProvider } from "kysely/migration";
import * as v from "valibot";

import { type SqliteNodeHandle, SqliteNodeDialect } from "./dialect.js";
import { SqliteNodeMigrationProvider } from "./migrations.js";
import type { SqliteNodeDatabase } from "./schema.js";

/**
 * `SqliteNodeIndex` のオプションです。
 */
export type SqliteNodeIndexOptions = {
  /** データベースの保存場所です。既定値はメモリーです。 */
  readonly location?: string | undefined;
};

/**
 * `SqliteNodeIndex` のコンストラクター引数を検証するスキーマです。
 */
const SqliteNodeIndexOptionsSchema = v.object({
  location: v.optional(v.pipe(v.string(), v.minLength(1))),
});

/**
 * 開いているデータベースハンドルを閉じます。
 *
 * Kysely の `destroy()` はドライバーの初期化に失敗していると接続を破棄しないため、後始末のフォールバックとして使います。
 *
 * @param handle 閉じるデータベースハンドルです。
 */
function closeHandle(handle: SqliteNodeHandle): void {
  if (!handle.isOpen) {
    return;
  }

  try {
    handle.close();
  } catch {
    // 元のエラーを優先するため、後始末の失敗は無視します。
  }
}

/**
 * Node.js 標準の SQLite による `IObjectIndex` の実装です。
 */
export class SqliteNodeIndex extends SqlObjectIndex {
  protected override readonly fullTextOperator = "LIKE" as const;

  readonly #location: string;

  /**
   * @param options データベースの保存場所などの設定です。
   */
  public constructor(options: SqliteNodeIndexOptions = {}) {
    super();

    const parsed = v.parse(SqliteNodeIndexOptionsSchema, options);
    this.#location = parsed.location ?? ":memory:";
  }

  protected override createBackend(): Promise<SqlIndexBackend> {
    const handle = new DatabaseSync(this.#location);
    const kysely = new Kysely<SqliteNodeDatabase>({
      dialect: new SqliteNodeDialect(handle),
    });

    return Promise.resolve({
      kysely,
      dispose: async () => {
        await kysely.destroy().catch(() => undefined);
        closeHandle(handle);
      },
    });
  }

  protected override createMigrationProvider(): MigrationProvider {
    return new SqliteNodeMigrationProvider();
  }
}
