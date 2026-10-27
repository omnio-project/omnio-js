import { DbQueryError } from "@omniojs/core";

/**
 * JSON 文字列を読み取ります。
 *
 * @param text JSON 文字列です。
 * @param operation 実行中の操作名です。
 *
 * @returns 読み取った値です。
 */
export function parseJson(text: string, operation: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (ex) {
    throw new DbQueryError({
      cause: ex,
      operation,
    });
  }
}

/**
 * 値を JSON 文字列に変換します。
 *
 * @param value 変換する値です。
 * @param operation 実行中の操作名です。
 *
 * @returns JSON 文字列です。
 */
export function stringifyJson(value: unknown, operation: string): string {
  try {
    return JSON.stringify(value);
  } catch (ex) {
    throw new DbQueryError({
      cause: ex,
      operation,
    });
  }
}
