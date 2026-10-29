import {
  type IEmbedder,
  type OmnioObject,
  type IObjectIndex,
  OmnioKey,
  TagSchema,
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

/**
 * `headObject` で選択できるメタデータの項目です。
 *
 * `OmnioObject` のキーと一致させます。
 */
const HEAD_OBJECT_FIELD_FLAGS = {
  key: true,
  hash: true,
  size: true,
  tags: true,
  entityId: true,
  createdAt: true,
  embedding: true,
  updatedAt: true,
  contentType: true,
  description: true,
  userMetadata: true,
  embeddingDims: true,
  hashAlgorithm: true,
  embeddingModel: true,
  embeddingSource: true,
} as const satisfies Record<keyof OmnioObject, true>;

/**
 * `headObject` の選択の入力を表します。
 */
type HeadObjectSelectInput = Readonly<Record<string, boolean | undefined>>;

/**
 * `headObject` で取得するメタデータの選択を検証するスキーマです。
 *
 * 既知の項目だけを真偽値で指定できます。
 */
const HeadObjectSelectSchema = v.custom<HeadObjectSelectInput>((input) => {
  if (!isObject(input) || Array.isArray(input)) {
    return false;
  }

  return Object.entries(input).every(
    ([field, enabled]) =>
      Object.hasOwn(HEAD_OBJECT_FIELD_FLAGS, field) && typeof enabled === "boolean",
  );
});

/** `headObject` のオプションを検証するスキーマです。 */
export const HeadObjectOptionsSchema = v.object({
  select: v.optional(HeadObjectSelectSchema),
  signal: OptionalAbortSignalSchema,
});

/** バイト列のスキーマです。 */
const Uint8ArraySchema = v.instance(Uint8Array);

/** Blob のスキーマです。 */
const BlobSchema = v.instance(Blob);

/**
 * ReadableStream のスキーマです。
 *
 * ReadableStream のインターフェースを満たすオブジェクトを受け付けます。
 */
const ReadableStreamSchema = v.custom<ReadableStream<Uint8Array>>(
  (input) =>
    isObject(input) &&
    typeof input["locked"] === "boolean" &&
    hasFunctions(input, ["cancel", "getReader", "pipeThrough", "pipeTo", "tee"]),
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
  hasFunctions(input, ["open", "close", "has", "get", "set", "copy", "delete", "stream"]),
);

/** 実体ストレージーのビルダーのスキーマです。 */
const IOmnioEntityBuilderSchema = v.custom<IOmnioEntityBuilder>((input) =>
  hasFunctions(input, ["build"]),
);

/** インデックスのスキーマです。 */
const IObjectIndexSchema = v.custom<IObjectIndex>((input) => {
  if (
    !hasFunctions(input, [
      "addPendingPurge",
      "open",
      "close",
      "upsert",
      "updateMetadata",
      "rename",
      "get",
      "has",
      "delete",
      "hasDeleted",
      "hasEntity",
      "list",
      "listDeleted",
      "listPendingPurges",
      "removePendingPurge",
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
  purgeGracePeriodMs: v.optional(
    v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(2_147_483_647)),
  ),
});

/** メタデータの文字列に対する絞り込み条件を検証するスキーマです。 */
const MetadataFilterConditionSchema = v.object({
  in: v.optional(v.array(ContentTypeSchema)),
  not: v.optional(ContentTypeSchema),
  notIn: v.optional(v.array(ContentTypeSchema)),
  equals: v.optional(ContentTypeSchema),
  contains: v.optional(ContentTypeSchema),
  endsWith: v.optional(ContentTypeSchema),
  startsWith: v.optional(ContentTypeSchema),
});

/** レコードタイプを検証するスキーマです。 */
const RecordTypeSchema = v.picklist(["CREATE", "UPDATE_METADATA", "DELETE"]);

/** サイズの条件に使う値を検証するスキーマです。 */
const SizeValueSchema = v.union([v.number(), v.bigint()]);

/** メタデータのサイズに対する絞り込み条件を検証するスキーマです。 */
const MetadataFilterSizeConditionSchema = v.object({
  gt: v.optional(SizeValueSchema),
  in: v.optional(v.union([SizeValueSchema, v.array(SizeValueSchema)])),
  lt: v.optional(SizeValueSchema),
  gte: v.optional(SizeValueSchema),
  lte: v.optional(SizeValueSchema),
  not: v.optional(v.union([SizeValueSchema, v.array(SizeValueSchema)])),
  notIn: v.optional(v.array(SizeValueSchema)),
  equals: v.optional(SizeValueSchema),
});

/** メタデータのレコードタイプに対する絞り込み条件を検証するスキーマです。 */
const MetadataFilterRecordTypeConditionSchema = v.object({
  in: v.optional(v.union([RecordTypeSchema, v.array(RecordTypeSchema)])),
  not: v.optional(v.union([RecordTypeSchema, v.array(RecordTypeSchema)])),
});

/** メタデータのタグに対する絞り込み条件を検証するスキーマです。 */
const MetadataFilterTagsConditionSchema = v.object({
  has: v.optional(TagSchema),
  equals: v.optional(TagsSchema),
  hasSome: v.optional(TagsSchema),
  isEmpty: v.optional(v.boolean()),
  hasEvery: v.optional(TagsSchema),
});

/** 日時の条件に使う値を検証するスキーマです。ISO 8601 文字列または有効な Date を受け付けます。 */
const TimestampOrDateSchema = v.union([
  TimestampSchema,
  v.custom<Date>((input) => input instanceof Date && !Number.isNaN(input.getTime())),
]);

/** メタデータの日時に対する絞り込み条件を検証するスキーマです。 */
const MetadataFilterDateConditionSchema = v.object({
  gt: v.optional(TimestampOrDateSchema),
  in: v.optional(v.union([TimestampOrDateSchema, v.array(TimestampOrDateSchema)])),
  lt: v.optional(TimestampOrDateSchema),
  gte: v.optional(TimestampOrDateSchema),
  lte: v.optional(TimestampOrDateSchema),
  not: v.optional(TimestampOrDateSchema),
  notIn: v.optional(v.union([TimestampOrDateSchema, v.array(TimestampOrDateSchema)])),
  equals: v.optional(TimestampOrDateSchema),
});

/** メタデータの絞り込み条件を検証するスキーマです。 */
const MetadataFilterSchema = v.object({
  hash: v.optional(v.union([v.string(), MetadataFilterConditionSchema])),
  size: v.optional(v.union([SizeValueSchema, MetadataFilterSizeConditionSchema])),
  tags: v.optional(v.union([TagSchema, MetadataFilterTagsConditionSchema])),
  fullText: v.optional(v.string()),
  createdAt: v.optional(v.union([TimestampOrDateSchema, MetadataFilterDateConditionSchema])),
  updatedAt: v.optional(v.union([TimestampOrDateSchema, MetadataFilterDateConditionSchema])),
  recordType: v.optional(v.union([RecordTypeSchema, MetadataFilterRecordTypeConditionSchema])),
  contentType: v.optional(v.union([ContentTypeSchema, MetadataFilterConditionSchema])),
  recordTimestamp: v.optional(v.union([TimestampOrDateSchema, MetadataFilterDateConditionSchema])),
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
