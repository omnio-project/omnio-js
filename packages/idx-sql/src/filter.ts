import type { RecordType, MetadataFilter } from "@omniojs/core";
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
 * LIKE 検索のパターンを組み立てます。
 *
 * @param value 検索する文字列です。
 * @param position 一致させる位置です。
 *
 * @returns LIKE 検索のパターンです。
 */
function toLikePattern(value: string, position: "contains" | "endsWith" | "startsWith"): string {
  const escaped = escapeLikePattern(value);

  if (position === "contains") {
    return `%${escaped}%`;
  }

  if (position === "endsWith") {
    return `%${escaped}`;
  }

  return `${escaped}%`;
}

/**
 * コンテンツタイプの条件をクエリーに適用します。
 *
 * @param query 絞り込む前のクエリーです。
 * @param condition コンテンツタイプの条件です。
 *
 * @returns 絞り込んだクエリーです。
 */
function withContentTypeFilter<T>(
  query: SelectQueryBuilder<SqlIndexDatabase, "journal", T>,
  condition: NonNullable<MetadataFilter["contentType"]>,
): SelectQueryBuilder<SqlIndexDatabase, "journal", T> {
  if (typeof condition === "string") {
    return query.where("journal.content_type", "=", condition);
  }

  let filtered = query;

  if (condition.contains !== undefined) {
    const pattern = toLikePattern(condition.contains, "contains");
    filtered = filtered.where(sql<boolean>`${sql.ref("content_type")} LIKE ${pattern} ESCAPE '\\'`);
  }

  if (condition.endsWith !== undefined) {
    const pattern = toLikePattern(condition.endsWith, "endsWith");
    filtered = filtered.where(sql<boolean>`${sql.ref("content_type")} LIKE ${pattern} ESCAPE '\\'`);
  }

  if (condition.equals !== undefined) {
    filtered = filtered.where("journal.content_type", "=", condition.equals);
  }

  if (condition.in !== undefined && condition.in.length > 0) {
    filtered = filtered.where("journal.content_type", "in", [...condition.in]);
  }

  if (condition.not !== undefined) {
    filtered = filtered.where("journal.content_type", "!=", condition.not);
  }

  if (condition.notIn !== undefined && condition.notIn.length > 0) {
    filtered = filtered.where("journal.content_type", "not in", [...condition.notIn]);
  }

  if (condition.startsWith !== undefined) {
    const pattern = toLikePattern(condition.startsWith, "startsWith");
    filtered = filtered.where(sql<boolean>`${sql.ref("content_type")} LIKE ${pattern} ESCAPE '\\'`);
  }

  return filtered;
}

/**
 * レコードタイプの条件に使う値の一覧に変換します。
 *
 * @param value 変換するレコードタイプまたはレコードタイプの一覧です。
 *
 * @returns レコードタイプの一覧です。
 */
function toRecordTypes(value: RecordType | readonly RecordType[]): readonly RecordType[] {
  return typeof value === "string" ? [value] : value;
}

/**
 * レコードタイプの条件をクエリーに適用します。
 *
 * @param query 絞り込む前のクエリーです。
 * @param condition レコードタイプの条件です。
 *
 * @returns 絞り込んだクエリーです。
 */
function withRecordTypeFilter<T>(
  query: SelectQueryBuilder<SqlIndexDatabase, "journal", T>,
  condition: NonNullable<MetadataFilter["recordType"]>,
): SelectQueryBuilder<SqlIndexDatabase, "journal", T> {
  if (typeof condition === "string") {
    return query.where("journal.record_type", "=", condition);
  }

  let filtered = query;

  if (condition.in !== undefined) {
    const values = toRecordTypes(condition.in);

    if (values.length > 0) {
      filtered = filtered.where("journal.record_type", "in", [...values]);
    }
  }

  if (condition.not !== undefined) {
    const values = toRecordTypes(condition.not);

    if (values.length > 0) {
      filtered = filtered.where("journal.record_type", "not in", [...values]);
    }
  }

  return filtered;
}

/**
 * 日時の条件に使う値を ISO 8601 文字列に変換します。
 *
 * @param value 変換する日時です。
 *
 * @returns ISO 8601 文字列です。
 */
function toTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * 日時の条件に使う値の一覧を ISO 8601 文字列に変換します。
 *
 * @param value 変換する日時または日時の一覧です。
 *
 * @returns ISO 8601 文字列の一覧です。
 */
function toTimestamps(value: string | Date | readonly (string | Date)[]): string[] {
  if (typeof value === "string" || value instanceof Date) {
    return [toTimestamp(value)];
  }

  return value.map((item) => toTimestamp(item));
}

/**
 * 日時の条件をクエリーに適用します。
 *
 * @param query 絞り込む前のクエリーです。
 * @param column 日時を保存する列です。
 * @param condition 日時の条件です。
 *
 * @returns 絞り込んだクエリーです。
 */
function withDateFilter<T>(
  query: SelectQueryBuilder<SqlIndexDatabase, "journal", T>,
  column: "created_at" | "record_timestamp" | "updated_at",
  condition: NonNullable<MetadataFilter["createdAt"]>,
): SelectQueryBuilder<SqlIndexDatabase, "journal", T> {
  if (typeof condition === "string" || condition instanceof Date) {
    return query.where(`journal.${column}`, "=", toTimestamp(condition));
  }

  let filtered = query;

  if (condition.equals !== undefined) {
    filtered = filtered.where(`journal.${column}`, "=", toTimestamp(condition.equals));
  }

  if (condition.gt !== undefined) {
    filtered = filtered.where(`journal.${column}`, ">", toTimestamp(condition.gt));
  }

  if (condition.gte !== undefined) {
    filtered = filtered.where(`journal.${column}`, ">=", toTimestamp(condition.gte));
  }

  if (condition.in !== undefined) {
    const values = toTimestamps(condition.in);

    if (values.length > 0) {
      filtered = filtered.where(`journal.${column}`, "in", values);
    }
  }

  if (condition.lt !== undefined) {
    filtered = filtered.where(`journal.${column}`, "<", toTimestamp(condition.lt));
  }

  if (condition.lte !== undefined) {
    filtered = filtered.where(`journal.${column}`, "<=", toTimestamp(condition.lte));
  }

  if (condition.not !== undefined) {
    filtered = filtered.where(`journal.${column}`, "!=", toTimestamp(condition.not));
  }

  if (condition.notIn !== undefined) {
    const values = toTimestamps(condition.notIn);

    if (values.length > 0) {
      filtered = filtered.where(`journal.${column}`, "not in", values);
    }
  }

  return filtered;
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

  if (filter?.contentType !== undefined) {
    filtered = withContentTypeFilter(filtered, filter.contentType);
  }

  if (filter?.createdAt !== undefined) {
    filtered = withDateFilter(filtered, "created_at", filter.createdAt);
  }

  if (filter?.fullText !== undefined && filter.fullText !== "") {
    const pattern = `%${escapeLikePattern(filter.fullText)}%`;
    filtered = filtered.where(
      sql<boolean>`(coalesce(${sql.ref("description")}, '') || ' ' || ${sql.ref("key")}) ${sql.raw(fullTextOperator)} ${pattern} ESCAPE '\\'`,
    );
  }

  if (filter?.recordTimestamp !== undefined) {
    filtered = withDateFilter(filtered, "record_timestamp", filter.recordTimestamp);
  }

  if (filter?.recordType !== undefined) {
    filtered = withRecordTypeFilter(filtered, filter.recordType);
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

  if (filter?.updatedAt !== undefined) {
    filtered = withDateFilter(filtered, "updated_at", filter.updatedAt);
  }

  return filtered;
}
