import { DatabaseSync } from "node:sqlite";

import type { IObjectIndex } from "@omniojs/core";
import type { ScoredObjectKey, SqlIndexBackend } from "@omniojs/idx-sql";
import { SqlObjectIndex, encodeEmbedding, withMetadataFilter } from "@omniojs/idx-sql";
import { sql, Kysely } from "kysely";
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
   * sqlite-vec 拡張を読み込めたかを示します。
   */
  #vectorSearchAvailable = false;

  /**
   * @param options データベースの保存場所などの設定です。
   */
  public constructor(options: SqliteNodeIndexOptions = {}) {
    super();

    const parsed = v.parse(SqliteNodeIndexOptionsSchema, options);
    this.#location = parsed.location ?? ":memory:";
  }

  protected override async createBackend(): Promise<SqlIndexBackend> {
    const handle = new DatabaseSync(this.#location, {
      allowExtension: true,
    });

    try {
      const { load } = await import("sqlite-vec");
      load(handle);

      this.#vectorSearchAvailable = true;
    } catch {
      // sqlite-vec がない環境でも動くよう、JavaScript の総当たりにフォールバックします。
      this.#vectorSearchAvailable = false;
    }

    const kysely = new Kysely<SqliteNodeDatabase>({
      dialect: new SqliteNodeDialect(handle),
    });

    return {
      kysely,
      dispose: async () => {
        await kysely.destroy().catch(() => undefined);
        closeHandle(handle);
      },
    };
  }

  /**
   * sqlite-vec の距離関数を使えるかを確認します。
   *
   * @returns sqlite-vec を使う場合は true です。
   */
  protected override canSearchScoredKeys(): boolean {
    return this.#vectorSearchAvailable;
  }

  /**
   * sqlite-vec の距離関数を使って類似度の高い順にキーを取得します。
   *
   * @param kysely kysely のインスタンスです。
   * @param c 検索する操作のコンテキストです。
   *
   * @returns スコア付きのキー一覧です。
   */
  protected override async searchScoredKeys(
    kysely: Kysely<SqliteNodeDatabase>,
    c: IObjectIndex.SearchContext,
  ): Promise<ScoredObjectKey[]> {
    const metric = c.metric ?? "cosine";
    const query = encodeEmbedding(c.vector);
    const embedding = sql.ref("journal.embedding");
    const distance =
      metric === "cosine"
        ? sql<number>`vec_distance_cosine(${embedding}, ${query})`
        : sql<number>`vec_distance_l2(${embedding}, ${query})`;
    const score =
      metric === "cosine"
        ? sql<number>`case when ${distance} is null then 0 else 1 - ${distance} end`
        : sql<number>`-${distance}`;

    const candidates = withMetadataFilter(
      kysely.selectFrom("journal").select(["journal.key", score.as("score")]),
      c.filter,
      this.fullTextOperator,
    )
      .where("journal.dirty", "=", 0)
      .where("journal.embedding", "is not", null)
      .where("journal.embedding_dims", "=", c.vector.length)
      .where(sql<boolean>`length(${embedding}) = ${c.vector.length * 4}`);

    const filtered =
      c.embeddingModel === undefined
        ? candidates
        : candidates.where("journal.embedding_model", "=", c.embeddingModel);

    let scored = kysely
      .selectFrom(filtered.as("scored"))
      .select(["scored.key", "scored.score"])
      .orderBy("scored.score", "desc")
      .limit(c.topK);

    if (c.minScore !== undefined) {
      scored = scored.where("scored.score", ">=", c.minScore);
    }

    const rows = await scored.execute();

    return rows.map((row) => ({
      key: row.key,
      score: row.score,
    }));
  }

  protected override createMigrationProvider(): MigrationProvider {
    return new SqliteNodeMigrationProvider();
  }
}
