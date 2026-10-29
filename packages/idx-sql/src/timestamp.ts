import { DbQueryError } from "@omniojs/core";

/**
 * 数値の UTC オフセットを持つ ISO 8601 日時を、コロン付きのオフセットに分解する正規表現です。
 */
const TIMESTAMP_OFFSET_PATTERN =
  /^(?<timestamp>\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?) ?(?<sign>[+-])(?<hours>\d{2})(?::?(?<minutes>\d{2}))?$/u;

/**
 * 日時の文字列の数値オフセットを `+HH:MM` 形式に揃えます。
 *
 * @param value 変換する日時の文字列です。
 *
 * @returns オフセットを揃えた日時の文字列です。
 */
function normalizeOffset(value: string): string {
  const match = TIMESTAMP_OFFSET_PATTERN.exec(value);

  if (match === null) {
    return value;
  }

  const { sign = "", hours = "", minutes = "", timestamp = "" } = match.groups ?? {};

  return `${timestamp}${sign}${hours}:${minutes === "" ? "00" : minutes}`;
}

/**
 * 日時をミリ秒付きの UTC 表記に変換します。
 *
 * @param value 変換する日時です。
 * @param operation 実行中の操作名です。
 *
 * @returns ミリ秒付きの UTC 表記の日時です。
 */
export function normalizeTimestamp(value: string | Date, operation: string): string {
  try {
    return new Date(typeof value === "string" ? normalizeOffset(value) : value).toISOString();
  } catch (ex) {
    throw new DbQueryError({
      cause: ex,
      operation,
    });
  }
}
