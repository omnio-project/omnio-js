import { PGlite } from "@electric-sql/pglite";
import type { SqlIndexBackend } from "@omniojs/idx-sql";
import { SqlObjectIndex } from "@omniojs/idx-sql";
import { Kysely, PGliteDialect } from "kysely";
import type { MigrationProvider } from "kysely/migration";
import * as v from "valibot";

import { BYTEA_OID, parseBytea, serializeBytea } from "./bytea.js";
import { PGliteMigrationProvider } from "./migrations.js";
import type { PGliteDatabase } from "./schema.js";

/**
 * `PGliteIndex` のオプションです。
 */
export type PGliteIndexOptions = {
  /** データベースの保存場所です。既定値はメモリーです。 */
  readonly location?: string | undefined;
};

/**
 * `PGliteIndex` のコンストラクター引数を検証するスキーマです。
 */
const PGliteIndexOptionsSchema = v.object({
  location: v.optional(v.pipe(v.string(), v.minLength(1))),
});

/**
 * 開いている PGlite のインスタンスを閉じます。
 *
 * Kysely の `destroy()` はドライバーの初期化に失敗していると接続を破棄しないため、後始末のフォールバックとして使います。
 *
 * @param pglite 閉じる PGlite のインスタンスです。
 */
async function closePGlite(pglite: PGlite): Promise<void> {
  if (pglite.closed) {
    return;
  }

  try {
    await pglite.close();
  } catch {
    // 元のエラーを優先するため、後始末の失敗は無視します。
  }
}

/**
 * PGlite による `IObjectIndex` の実装です。
 */
export class PGliteIndex extends SqlObjectIndex {
  protected override readonly fullTextOperator = "ILIKE" as const;

  readonly #location: string;

  /**
   * @param options データベースの保存場所などの設定です。
   */
  public constructor(options: PGliteIndexOptions = {}) {
    super();

    const parsed = v.parse(PGliteIndexOptionsSchema, options);
    this.#location = parsed.location ?? "memory://";
  }

  protected override createBackend(): Promise<SqlIndexBackend> {
    const pglite = new PGlite(this.#location, {
      parsers: {
        [BYTEA_OID]: parseBytea,
      },
      serializers: {
        [BYTEA_OID]: serializeBytea,
      },
    });
    const kysely = new Kysely<PGliteDatabase>({
      dialect: new PGliteDialect({ pglite }),
    });

    return Promise.resolve({
      kysely,
      dispose: async () => {
        await kysely.destroy().catch(() => undefined);
        await closePGlite(pglite);
      },
    });
  }

  protected override createMigrationProvider(): MigrationProvider {
    return new PGliteMigrationProvider();
  }
}
