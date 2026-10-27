import { types } from "@electric-sql/pglite";

/** PostgreSQL の `bytea` 型の OID です。 */
export const BYTEA_OID = 17;

/** 16 進数の文字コードから値を引くための表です。 */
const HEX_VALUES = new Uint8Array(128);

for (let value = 0; value < 10; value += 1) {
  HEX_VALUES[48 + value] = value;
}

for (let value = 0; value < 6; value += 1) {
  HEX_VALUES[97 + value] = 10 + value;
  HEX_VALUES[65 + value] = 10 + value;
}

/** PGlite の既定の `bytea` パーサーです。 */
const DEFAULT_BYTEA_PARSER = types.parsers[BYTEA_OID];

/** 16 進数の 2 文字表記の一覧です。 */
const HEX_PAIRS = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));

/**
 * PostgreSQL の `bytea` の 16 進数表記をバイト列に変換します。
 *
 * PGlite の既定のパーサーは 1 バイトごとに `parseInt` を呼びます。
 * 埋め込みベクトルのように大きな `bytea` を多数読み取ると遅くなるため、文字コードから直接値を引いて高速化します。
 *
 * @param text PostgreSQL が返した `bytea` の文字列表現です。
 *
 * @returns 変換したバイト列です。
 */
export function parseBytea(text: string): Uint8Array {
  if (!text.startsWith("\\x")) {
    if (DEFAULT_BYTEA_PARSER === undefined) {
      throw new Error("PGlite の bytea パーサーが見つかりません");
    }

    return DEFAULT_BYTEA_PARSER(text) as Uint8Array;
  }

  const hex = text.slice(2);
  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    const high = HEX_VALUES[hex.charCodeAt(index * 2)] ?? 0;
    const low = HEX_VALUES[hex.charCodeAt(index * 2 + 1)] ?? 0;
    bytes[index] = (high << 4) | low;
  }

  return bytes;
}

/**
 * バイト列を PostgreSQL の `bytea` の 16 進数表記に変換します。
 *
 * PGlite の既定のシリアライザーは 1 バイトずつ 16 進数へ変換するため遅くなります。
 * 2 文字表記の一覧を用意し、文字列連結で組み立てることで高速化します。
 *
 * @param value 変換するバイト列です。
 *
 * @returns PostgreSQL が解釈できる `bytea` の文字列表現です。
 */
export function serializeBytea(value: Uint8Array): string {
  let text = "\\x";

  for (let index = 0; index < value.length; index += 1) {
    text += HEX_PAIRS[value[index] ?? 0] ?? "";
  }

  return text;
}
