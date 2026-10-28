import type { SqlIndexBackend } from "@omniojs/idx-sql";
import { PgVectorObjectIndex } from "@omniojs/idx-sql";
import { Kysely, PostgresDialect } from "kysely";
import type { MigrationProvider } from "kysely/migration";
import { Pool } from "pg";
import * as v from "valibot";

import { PostgresqlMigrationProvider } from "./migrations.js";
import type { PostgresqlDatabase } from "./schema.js";

/**
 * `PostgresqlIndex` のオプションです。
 */
export type PostgresqlIndexOptions = {
  /** PostgreSQL への接続文字列です。 */
  readonly connectionString: string;

  /** コネクションプールの最大接続数です。既定値は 10 です。 */
  readonly maxConnections?: number | undefined;
};

/**
 * `PostgresqlIndex` のコンストラクター引数を検証するスキーマです。
 */
const PostgresqlIndexOptionsSchema = v.object({
  maxConnections: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  connectionString: v.pipe(v.string(), v.minLength(1)),
});

/**
 * 開いているコネクションプールを閉じます。
 *
 * Kysely の `destroy()` はドライバーの初期化に失敗していると接続を破棄しないため、後始末のフォールバックとして使います。
 *
 * @param pool 閉じるコネクションプールです。
 */
async function closePool(pool: Pool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // 元のエラーを優先するため、後始末の失敗は無視します。
  }
}

/**
 * PostgreSQL による `IObjectIndex` の実装です。
 */
export class PostgresqlIndex extends PgVectorObjectIndex {
  protected override readonly fullTextOperator = "ILIKE" as const;

  readonly #connectionString: string;

  readonly #maxConnections: number | undefined;

  /**
   * @param options 接続文字列などの設定です。
   */
  public constructor(options: PostgresqlIndexOptions) {
    super();

    const parsed = v.parse(PostgresqlIndexOptionsSchema, options);
    this.#connectionString = parsed.connectionString;
    this.#maxConnections = parsed.maxConnections;
  }

  protected override createBackend(): Promise<SqlIndexBackend> {
    const pool = new Pool({
      max: this.#maxConnections,
      connectionString: this.#connectionString,
    });
    const kysely = new Kysely<PostgresqlDatabase>({
      dialect: new PostgresDialect({ pool }),
    });

    return Promise.resolve({
      kysely,
      dispose: async () => {
        await kysely.destroy().catch(() => undefined);
        await closePool(pool);
      },
    });
  }

  protected override createMigrationProvider(): MigrationProvider {
    return new PostgresqlMigrationProvider();
  }

  protected override toStoredSize(size: number): string {
    return String(size);
  }
}
