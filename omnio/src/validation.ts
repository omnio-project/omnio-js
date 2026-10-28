import {
  type IEmbedder,
  type IObjectIndex,
  OmnioKey,
  TagsSchema,
  TimestampSchema,
  ContentTypeSchema,
  DescriptionSchema,
  UserMetadataSchema,
} from "@omniojs/core";
import * as v from "valibot";

import type { IOmnioEntity, IOmnioEntityBuilder } from "./entity.js";

/**
 * 非 null のオブジェクトかを確認します。
 *
 * @param value 確認する値です。
 *
 * @returns 非 null のオブジェクトの場合は true、そうでない場合は false です。
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 指定したメソッドを持つオブジェクトかを確認します。
 *
 * @param value 確認する値です。
 * @param names メソッド名の一覧です。
 *
 * @returns すべてのメソッドを持つ場合は true、そうでない場合は false です。
 */
function hasFunctions(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && names.every((name) => typeof value[name] === "function");
}

/** 省略可能な中断シグナルのスキーマです。 */
export const OptionalAbortSignalSchema = v.optional(v.instance(AbortSignal));

/** オブジェクトキーのスキーマです。文字列の内容は OmnioKey で検証します。 */
export const OmnioKeySchema = v.union([v.string(), v.instance(OmnioKey)]);

/** バイト列のスキーマです。 */
const Uint8ArraySchema = v.instance(Uint8Array);

/** Blob のスキーマです。 */
const BlobSchema = v.instance(Blob);

/** ReadableStream のスキーマです。 */
const ReadableStreamSchema = v.custom<ReadableStream<Uint8Array>>(
  (input) => input instanceof ReadableStream,
);

/** 保存データのスキーマです。 */
const DataSchema = v.union([Uint8ArraySchema, BlobSchema, ReadableStreamSchema]);

/** 空でない埋め込みベクトルのスキーマです。 */
const EmbeddingSchema = v.pipe(
  v.instance(Float32Array),
  v.check((input) => input.length > 0),
);

/** 埋め込み器の能力情報を検証するスキーマです。 */
const EmbedderInfoSchema = v.object({
  dims: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  maxTokens: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
  modalities: v.array(v.string()),
  normalized: v.boolean(),
  multilingual: v.boolean(),
});

/** 実体ストレージーのスキーマです。 */
export const IOmnioEntitySchema = v.custom<IOmnioEntity>((input) =>
  hasFunctions(input, ["open", "close", "has", "get", "set", "delete", "stream"]),
);

/** 実体ストレージーのビルダーのスキーマです。 */
const IOmnioEntityBuilderSchema = v.custom<IOmnioEntityBuilder>((input) =>
  hasFunctions(input, ["build"]),
);

/** インデックスのスキーマです。 */
const IObjectIndexSchema = v.custom<IObjectIndex>((input) => {
  if (
    !hasFunctions(input, [
      "open",
      "close",
      "upsert",
      "updateMetadata",
      "rename",
      "get",
      "has",
      "delete",
      "list",
      "search",
      "purge",
      "listDirty",
      "markDirty",
    ])
  ) {
    return false;
  }

  return typeof input["isOpen"] === "boolean";
});

/** 埋め込み器のスキーマです。 */
const IEmbedderSchema = v.custom<IEmbedder>((input) => {
  if (!hasFunctions(input, ["embed", "embedMany", "embedText", "supports"])) {
    return false;
  }

  const info = v.safeParse(EmbedderInfoSchema, input["info"]);

  return info.success && info.output.modalities.includes("text");
});

/** `Omnio` のコンストラクター引数を検証するスキーマです。 */
export const OmnioOptionsSchema = v.object({
  index: IObjectIndexSchema,
  entity: IOmnioEntityBuilderSchema,
  embedder: IEmbedderSchema,
});

/** メタデータの絞り込み条件を検証するスキーマです。 */
const MetadataFilterSchema = v.object({
  tagsAll: v.optional(TagsSchema),
  tagsAny: v.optional(TagsSchema),
  fullText: v.optional(v.string()),
  contentTypes: v.optional(v.array(ContentTypeSchema)),
  createdAfter: v.optional(TimestampSchema),
  createdBefore: v.optional(TimestampSchema),
});

/** オブジェクト保存の入力を検証するスキーマです。 */
export const PutObjectInputSchema = v.object({
  key: OmnioKeySchema,
  data: DataSchema,
  tags: v.optional(TagsSchema),
  embed: v.optional(v.boolean()),
  signal: OptionalAbortSignalSchema,
  embedding: v.optional(EmbeddingSchema),
  contentType: ContentTypeSchema,
  description: v.optional(DescriptionSchema),
  userMetadata: v.optional(UserMetadataSchema),
});

/** 変更可能なメタデータの更新入力を検証するスキーマです。 */
export const UpdateObjectMetadataInputSchema = v.object({
  key: OmnioKeySchema,
  tags: v.optional(TagsSchema),
  signal: OptionalAbortSignalSchema,
  contentType: v.optional(ContentTypeSchema),
  description: v.optional(DescriptionSchema),
  userMetadata: v.optional(UserMetadataSchema),
});

/** 意味検索のクエリーを検証するスキーマです。 */
const ObjectSearchQuerySchema = v.union([
  v.object({
    text: v.pipe(v.string(), v.minLength(1)),
  }),
  v.object({
    image: v.union([Uint8ArraySchema, BlobSchema]),
    mimeType: v.optional(v.pipe(v.string(), v.minLength(1))),
  }),
  v.object({
    vector: EmbeddingSchema,
  }),
]);

/** 意味検索の入力を検証するスキーマです。 */
export const SearchObjectsInputSchema = v.object({
  topK: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
  query: ObjectSearchQuerySchema,
  filter: v.optional(MetadataFilterSchema),
  signal: OptionalAbortSignalSchema,
  minScore: v.optional(v.pipe(v.number(), v.finite())),
  includeEmbedding: v.optional(v.boolean()),
});

/** 一覧のオプションを検証するスキーマです。 */
const ListObjectsOptionsSchema = v.object({
  limit: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
  cursor: v.optional(v.nullable(v.string())),
  filter: v.optional(MetadataFilterSchema),
});

/** 省略可能な一覧オプションのスキーマです。 */
export const OptionalListObjectsOptionsSchema = v.optional(ListObjectsOptionsSchema);
