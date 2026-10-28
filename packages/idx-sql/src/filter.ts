import type { MetadataFilter } from "@omniojs/core";
import { type SelectQueryBuilder, sql } from "kysely";

import type { SqlIndexDatabase } from "./schema.js";

/**
 * 全文検索で使う比較演算子です。
 */
export type FullTextOperator = "ILIKE" | "LIKE";

/**
 * LIKE 検索用にパターンを escapes します。
 *
 * @param value escapes する文字列です。
 *
 * @returns escapes した文字列です。
 */
function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * カーソルを offset に変換します。
 *
 * @param cursor 一覧の続きを示すカーソルです。
 *
 * @returns 先頭からの件数です。不正な値は 0 とします。
 */
export function parseCursor(cursor: string | null | undefined): number {
  if (cursor === null || cursor === undefined || cursor === "") {
    return 0;
  }

  const offset = Number.parseInt(cursor, 10);

  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}

/**
 * メタデータの絞り込み条件を適用します。
 *
 * @param query 絞り込む前のクエリーです。
 * @param filter 絞り込み条件です。
 * @param fullTextOperator 全文検索で使う比較演算子です。
 *
 * @returns 絞り込んだクエリーです。
 */
export function withMetadataFilter<T>(
  query: SelectQueryBuilder<SqlIndexDatabase, "journal", T>,
  filter: MetadataFilter | undefined,
  fullTextOperator: FullTextOperator,
): SelectQueryBuilder<SqlIndexDatabase, "journal", T> {
  let filtered = query.where("journal.record_type", "!=", "DELETE");

  if (filter?.contentTypes !== undefined && filter.contentTypes.length > 0) {
    filtered = filtered.where("journal.content_type", "in", [...filter.contentTypes]);
  }

  if (filter?.createdAfter !== undefined) {
    filtered = filtered.where("journal.created_at", ">=", filter.createdAfter);
  }

  if (filter?.createdBefore !== undefined) {
    filtered = filtered.where("journal.created_at", "<=", filter.createdBefore);
  }

  if (filter?.fullText !== undefined && filter.fullText !== "") {
    const pattern = `%${escapeLikePattern(filter.fullText)}%`;
    filtered = filtered.where(
      sql<boolean>`(coalesce(${sql.ref("description")}, '') || ' ' || ${sql.ref("key")}) ${sql.raw(fullTextOperator)} ${pattern} ESCAPE '\\'`,
    );
  }

  if (filter?.tagsAll !== undefined && filter.tagsAll.length > 0) {
    const tags = [...new Set(filter.tagsAll)];
    filtered = filtered.where("journal.key", "in", (inner) =>
      inner
        .selectFrom("object_tag")
        .select("object_tag.key")
        .where("object_tag.tag", "in", tags)
        .groupBy("object_tag.key")
        .having(sql<boolean>`count(*) = ${tags.length}`),
    );
  }

  if (filter?.tagsAny !== undefined && filter.tagsAny.length > 0) {
    const tags = [...new Set(filter.tagsAny)];
    filtered = filtered.where("journal.key", "in", (inner) =>
      inner.selectFrom("object_tag").select("object_tag.key").where("object_tag.tag", "in", tags),
    );
  }

  return filtered;
}
