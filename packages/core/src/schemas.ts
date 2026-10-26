import {
  pipe,
  array,
  brand,
  check,
  regex,
  number,
  string,
  unknown as unknownSchema,
  maxValue,
  minValue,
  maxLength,
  minLength,
  safeInteger,
  toLowerCase,
  isoTimestamp,
} from "valibot";
import type { Brand, GenericSchema } from "valibot";

import utf8 from "./utf8.js";

/** オブジェクトキーの最大文字数です。 */
export const MAX_OBJECT_KEY_LENGTH = 1024;

/** オブジェクトキーの最大バイト数です。 */
export const MAX_OBJECT_KEY_BYTES = 1024;

/** タグの最大文字数です。S3 のタグキー制限を参考にしています。 */
export const MAX_TAG_LENGTH = 128;

/** タグの最大バイト数です。 */
export const MAX_TAG_BYTES = 128;

/** オブジェクトに付けられるタグの最大数です。S3 の制限を参考にしています。 */
export const MAX_TAGS = 10;

/** オブジェクトの最大サイズです。バイト単位で表します。S3 の上限である 5 TiB です。 */
export const MAX_OBJECT_SIZE = 5_497_558_138_880;

/**
 * 文字列の UTF-8 バイト数を数えます。
 *
 * @param input 数える文字列です。
 *
 * @returns UTF-8 バイト数です。
 */
function getUtf8ByteLength(input: string): number {
  return utf8.countBytes(input);
}

/**
 * 文字列が正しい UTF-8 であるかを確認します。
 *
 * @param input 確認する文字列です。
 *
 * @returns 正しい UTF-8 である場合は true、そうでない場合は false です。
 */
function isWellFormedUtf8(input: string): boolean {
  return utf8.decode(utf8.encode(input)) === input;
}

/** オブジェクトキーの文字列表現の入力型です。 */
export type ObjectKeyLike = string;

/** 検証済みのオブジェクトキーの文字列表現です。 */
export type ObjectKey = string & Brand<"ObjectKey">;

/**
 * オブジェクトキーの文字列表現を検証するスキーマです。
 *
 * @example
 * ```
 * import { ObjectKeySchema } from "@omniojs/core";
 *
 * v.parse(ObjectKeySchema, "foo/bar"); // => "foo/bar"
 * ```
 */
export const ObjectKeySchema: GenericSchema<ObjectKeyLike, ObjectKey> = pipe(
  string(),
  minLength(1),
  maxLength(MAX_OBJECT_KEY_LENGTH),
  check(isWellFormedUtf8),
  check((input) => getUtf8ByteLength(input) <= MAX_OBJECT_KEY_BYTES),
  brand("ObjectKey"),
);

/** タグの入力型です。 */
export type TagLike = string;

/** 検証済みのタグです。 */
export type Tag = string & Brand<"Tag">;

/**
 * タグを検証するスキーマです。
 *
 * @example
 * ```
 * import { TagSchema } from "@omniojs/core";
 *
 * v.parse(TagSchema, "important"); // => "important"
 * ```
 */
export const TagSchema: GenericSchema<TagLike, Tag> = pipe(
  string(),
  minLength(1),
  maxLength(MAX_TAG_LENGTH),
  check(isWellFormedUtf8),
  check((input) => getUtf8ByteLength(input) <= MAX_TAG_BYTES),
  brand("Tag"),
);

/** タグ配列の入力型です。 */
export type TagsLike = TagLike[];

/** 検証済みのタグ配列です。 */
export type Tags = Tag[];

/**
 * タグ配列を検証するスキーマです。
 *
 * @example
 * ```
 * import { TagsSchema } from "@omniojs/core";
 *
 * v.parse(TagsSchema, ["a", "b"]); // => ["a", "b"]
 * ```
 */
export const TagsSchema: GenericSchema<TagsLike, Tags> = pipe(
  array(TagSchema),
  maxLength(MAX_TAGS),
  brand("Tags"),
);

/** 説明文の入力型です。 */
export type DescriptionLike = string;

/** 検証済みの説明文です。 */
export type Description = string & Brand<"Description">;

/**
 * 説明文を検証するスキーマです。
 *
 * @example
 * ```
 * import { DescriptionSchema } from "@omniojs/core";
 *
 * v.parse(DescriptionSchema, "これはサンプルです。"); // => "これはサンプルです。"
 * ```
 */
export const DescriptionSchema: GenericSchema<DescriptionLike, Description> = pipe(
  string(),
  check(isWellFormedUtf8),
  brand("Description"),
);

/** コンテンツタイプの入力型です。 */
export type ContentTypeLike = string;

/** 検証済みのコンテンツタイプです。小文字に正規化します。 */
export type ContentType = string & Brand<"ContentType">;

/**
 * コンテンツタイプを検証するスキーマです。
 *
 * @example
 * ```
 * import { ContentTypeSchema } from "@omniojs/core";
 *
 * v.parse(ContentTypeSchema, "Text/Plain"); // => "text/plain"
 * ```
 */
export const ContentTypeSchema: GenericSchema<ContentTypeLike, ContentType> = pipe(
  string(),
  toLowerCase(),
  brand("ContentType"),
);

/** SHA-256 ハッシュの正規表現です。 */
// oxlint-disable-next-line no-inferrable-types
export const SHA256_HEX_REGEX: RegExp = /^[0-9a-f]{64}$/u;

/** ハッシュ値の入力型です。 */
export type HashLike = string;

/** 検証済みのハッシュ値です。SHA-256 の 16 進数表記です。 */
export type Hash = string & Brand<"Hash">;

/**
 * ハッシュ値を検証するスキーマです。
 *
 * @example
 * ```
 * import { HashSchema } from "@omniojs/core";
 *
 * v.parse(HashSchema, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
 * ```
 */
export const HashSchema: GenericSchema<HashLike, Hash> = pipe(
  string(),
  regex(SHA256_HEX_REGEX),
  brand("Hash"),
);

/** サイズの入力型です。 */
export type SizeLike = number;

/** 検証済みのサイズです。バイト単位で表します。 */
export type Size = number & Brand<"Size">;

/**
 * サイズを検証するスキーマです。
 *
 * @example
 * ```
 * import { SizeSchema } from "@omniojs/core";
 *
 * v.parse(SizeSchema, 1024); // => 1024
 * ```
 */
export const SizeSchema: GenericSchema<SizeLike, Size> = pipe(
  number(),
  safeInteger(),
  minValue(0),
  maxValue(MAX_OBJECT_SIZE),
  brand("Size"),
);

/** 時刻の入力型です。 */
export type TimestampLike = string;

/** 検証済みの時刻です。ISO 8601 文字列で表します。 */
export type Timestamp = string & Brand<"Timestamp">;

/**
 * 時刻を検証するスキーマです。
 *
 * @example
 * ```
 * import { TimestampSchema } from "@omniojs/core";
 *
 * v.parse(TimestampSchema, "2026-01-01T00:00:00Z"); // => "2026-01-01T00:00:00Z"
 * ```
 */
export const TimestampSchema: GenericSchema<TimestampLike, Timestamp> = pipe(
  string(),
  isoTimestamp(),
  brand("Timestamp"),
);

/** 埋め込み次元数の入力型です。 */
export type EmbeddingDimsLike = number;

/** 検証済みの埋め込み次元数です。 */
export type EmbeddingDims = number & Brand<"EmbeddingDims">;

/**
 * 埋め込み次元数を検証するスキーマです。
 *
 * @example
 * ```
 * import { EmbeddingDimsSchema } from "@omniojs/core";
 *
 * v.parse(EmbeddingDimsSchema, 768); // => 768
 * ```
 */
export const EmbeddingDimsSchema: GenericSchema<EmbeddingDimsLike, EmbeddingDims> = pipe(
  number(),
  safeInteger(),
  minValue(1),
  brand("EmbeddingDims"),
);

/** 埋め込みモデル名の入力型です。 */
export type EmbeddingModelLike = string;

/** 検証済みの埋め込みモデル名です。 */
export type EmbeddingModel = string & Brand<"EmbeddingModel">;

/**
 * 埋め込みモデル名を検証するスキーマです。
 *
 * @example
 * ```
 * import { EmbeddingModelSchema } from "@omniojs/core";
 *
 * v.parse(EmbeddingModelSchema, "embeddinggemma-2"); // => "embeddinggemma-2"
 * ```
 */
export const EmbeddingModelSchema: GenericSchema<EmbeddingModelLike, EmbeddingModel> = pipe(
  string(),
  minLength(1),
  brand("EmbeddingModel"),
);

/** 利用者メタデータの入力型です。 */
export type UserMetadataLike = unknown;

/** 検証済みの利用者メタデータです。あらゆる値を受け付けます。 */
export type UserMetadata = unknown;

/**
 * 利用者メタデータを検証するスキーマです。あらゆる値を受け付けます。
 *
 * @example
 * ```
 * import { UserMetadataSchema } from "@omniojs/core";
 *
 * v.parse(UserMetadataSchema, { genre: "test" }); // => { genre: "test" }
 * ```
 */
export const UserMetadataSchema: GenericSchema<UserMetadataLike, UserMetadata> = unknownSchema();
