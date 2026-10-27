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
 * 非 null のオブジェクトかを確認します。
 *
 * @param value 確認する値です。
 *
 * @returns 非 null のオブジェクトの場合は true、そうでない場合は false です。
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 2 つの値が深く等しいかを確認します。
 *
 * @param left 比較する値です。
 * @param right 比較する値です。
 *
 * @returns 深く等しい場合は true、そうでない場合は false です。
 */
function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    );
  }

  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([name, value]) =>
        Object.hasOwn(right, name) && deepEqual(value, (right as Record<string, unknown>)[name]),
    )
  );
}

/**
 * 利用者メタデータが条件に一致するかを確認します。
 *
 * @param record レコードの利用者メタデータです。
 * @param filter 絞り込み条件の利用者メタデータです。
 *
 * @returns 一致する場合は true、そうでない場合は false です。
 */
export function matchesUserMetadata(record: unknown, filter: unknown): boolean {
  if (filter === undefined) {
    return true;
  }

  if (!isObjectRecord(filter)) {
    return false;
  }

  if (Object.keys(filter).length === 0) {
    return true;
  }

  if (!isObjectRecord(record)) {
    return false;
  }

  return Object.entries(filter).every(([name, expected]) => deepEqual(record[name], expected));
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
 * メタデータの絞り込み条件を適用します。利用者メタデータは含みません。
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
