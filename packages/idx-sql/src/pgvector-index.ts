import type { IObjectIndex } from "@omniojs/core";
import { type Kysely, type RawBuilder, sql } from "kysely";

import { withMetadataFilter } from "./filter.js";
import type { SqlIndexDatabase } from "./schema.js";
import { type ScoredObjectKey, SqlObjectIndex } from "./sql-index.js";
import { formatVector } from "./vector.js";

/**
 * pgvector によるベクトル検索を行う `SqlObjectIndex` の共通実装です。
 *
 * 埋め込みを pgvector の `vector` 型で保存し、距離計算と並べ替えを PostgreSQL に任せます。
 */
export abstract class PgVectorObjectIndex extends SqlObjectIndex {
  protected override readonly embeddingFormat = "pgvector" as const;

  /**
   * pgvector の距離演算子を使えるかを確認します。
   *
   * @returns pgvector を使う場合は true です。
   */
  protected override canSearchScoredKeys(): boolean {
    return true;
  }

  /**
   * pgvector の距離演算子を使って類似度の高い順にキーを取得します。
   *
   * @param kysely kysely のインスタンスです。
   * @param c 検索する操作のコンテキストです。
   *
   * @returns スコア付きのキー一覧です。
   */
  protected override async searchScoredKeys(
    kysely: Kysely<SqlIndexDatabase>,
    c: IObjectIndex.SearchContext,
  ): Promise<ScoredObjectKey[]> {
    const metric = c.metric ?? "cosine";
    const query = sql`${formatVector(c.vector)}::vector`;
    const embedding = sql.ref("journal.embedding");
    let score: RawBuilder<number>;

    if (metric === "cosine") {
      score = sql<number>`case
        when vector_norm(${embedding}) = 0 or vector_norm(${query}) = 0 then 0
        else 1 - (${embedding} <=> ${query})
      end`;
    } else {
      score = sql<number>`-(${embedding} <-> ${query})`;
    }

    const candidates = withMetadataFilter(
      kysely.selectFrom("journal").select(["journal.key", score.as("score")]),
      c.filter,
      this.fullTextOperator,
    )
      .where("journal.dirty", "=", 0)
      .where("journal.embedding", "is not", null)
      .where("journal.embedding_dims", "=", c.vector.length);

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
}
