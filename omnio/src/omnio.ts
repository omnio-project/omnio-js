// oxlint-disable import/no-namespace
import {
  type IEmbedder,
  type EmbedSource,
  type OmnioObject,
  type IObjectIndex,
  type IndexedObject,
  type MetadataFilter,
  OmnioKey,
  TagsSchema,
  DbNotOpenError,
  TimestampSchema,
  ContentTypeSchema,
  DescriptionSchema,
  UserMetadataSchema,
  OperationAbortedError,
} from "@omniojs/core";
import { ChecksumSha256 } from "@unikvs/checksum";
import { asyncmux } from "asyncmux";
import { type IValueStream, KeyNotFoundError } from "unikvs";
import * as v from "valibot";

import type { IOmnioEntity, IOmnioEntityBuilder } from "./entity.js";

/** `open` と `close` の既定タイムアウトです。ミリ秒単位で表します。 */
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 30_000;

/**
 * ライフサイクル操作で使う中断シグナルを返します。
 *
 * @param signal 呼び出し側が指定した中断シグナルです。
 *
 * @returns 指定されたシグナル、省略時は既定タイムアウトのシグナルです。
 */
function withLifecycleTimeout(signal: AbortSignal | undefined): AbortSignal {
  return signal ?? AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS);
}

/**
 * `Omnio` の設定です。データベースと埋め込み、ストレージーの指定はすべて必須です。
 */
export type OmnioOptions = {
  /**
   * 実体を保存するストレージーのビルダーです。
   *
   * `persist()` まで構成した unikvs ビルダーを渡してください。
   * `Omnio` はコンストラクターで `build()` を実行します。
   */
  readonly entity: IOmnioEntityBuilder;

  /** メタデータとベクトルを保存するインデックスです。 */
  readonly index: IObjectIndex;

  /** 埋め込み推論器です。 */
  readonly embedder: IEmbedder;
};

/**
 * オブジェクト保存の入力です。
 */
export type PutObjectInput<TUserMetadata = Record<string, unknown>> = {
  /** オブジェクトキーまたはその文字列表現です。 */
  readonly key: OmnioKey | string;

  /** 保存するバイト列です。 */
  readonly data: Uint8Array | Blob | ReadableStream<Uint8Array>;

  /** コンテンツタイプです。 */
  readonly contentType: string;

  /** 任意のテキスト形式の説明文です。埋め込み対象にできます。 */
  readonly description?: string | undefined;

  /** 絞り込み用のタグ一覧です。 */
  readonly tags?: readonly string[] | undefined;

  /** 利用者が自由に付与するメタデータです。 */
  readonly userMetadata?: TUserMetadata | undefined;

  /** 事前に計算した埋め込みベクトルです。指定時は埋め込み器を使いません。 */
  readonly embedding?: Float32Array | undefined;

  /** 埋め込みを生成するかです。既定では説明文がある場合に生成します。 */
  readonly embed?: boolean | undefined;

  /** 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。 */
  readonly signal?: AbortSignal | undefined;
};

/**
 * 意味検索のクエリーです。
 */
export type ObjectSearchQuery =
  | {
      /** 自然言語のクエリー文です。 */
      readonly text: string;
    }
  | {
      /** 画像クエリーのバイト列です。 */
      readonly image: Uint8Array | Blob;

      /** 画像の MIME タイプです。 */
      readonly mimeType?: string | undefined;
    }
  | {
      /** 事前に計算した検索ベクトルです。 */
      readonly vector: Float32Array;
    };

/**
 * 意味検索の入力です。
 */
export type SearchObjectsInput = {
  /** 検索クエリーです。 */
  readonly query: ObjectSearchQuery;

  /** 取得する最大件数です。 */
  readonly topK?: number | undefined;

  /** 結果に含める最小スコアです。 */
  readonly minScore?: number | undefined;

  /** 類似度計算の前に適用する絞り込み条件です。 */
  readonly filter?: MetadataFilter | undefined;

  /** 埋め込みベクトルを結果に含めるかです。既定は含めます。 */
  readonly includeEmbedding?: boolean | undefined;

  /** 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。 */
  readonly signal?: AbortSignal | undefined;
};

/**
 * オブジェクトキーまたはその文字列表現を `OmnioKey` に変換します。
 *
 * @param key 変換するキーです。
 *
 * @returns `OmnioKey` インスタンスです。
 */
function toOmnioKey(key: OmnioKey | string): OmnioKey {
  return typeof key === "string" ? OmnioKey.parse(key) : key;
}

/**
 * バイト列を ArrayBuffer に裏打ちされた複製に変換します。
 *
 * @param data 変換するバイト列です。
 *
 * @returns ArrayBuffer に裏打ちされた複製です。
 */
function copiedBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);

  return bytes;
}

/**
 * 入力データをバイト列に変換します。
 *
 * @param data 変換するデータです。
 *
 * @returns ArrayBuffer に裏打ちされたバイト列の複製です。
 */
async function toBytes(
  data: Uint8Array | Blob | ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }

  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = data.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value !== undefined) {
        chunks.push(value);
        length += value.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

/**
 * キーが見つからない例外を null に変換します。
 *
 * @param load 実行する取得処理です。
 *
 * @returns 取得した値、キーが存在しない場合は null です。
 */
async function nullIfKeyNotFound<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (ex) {
    if (ex instanceof KeyNotFoundError) {
      return null;
    }

    throw ex;
  }
}

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
const OptionalAbortSignalSchema = v.optional(v.instance(AbortSignal));

/** オブジェクトキーのスキーマです。文字列の内容は OmnioKey で検証します。 */
const OmnioKeySchema = v.union([v.string(), v.instance(OmnioKey)]);

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
const IOmnioEntitySchema = v.custom<IOmnioEntity>((input) =>
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
      "get",
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
const OmnioOptionsSchema = v.object({
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
  userMetadata: v.optional(v.record(v.string(), v.unknown())),
  createdBefore: v.optional(TimestampSchema),
});

/** オブジェクト保存の入力を検証するスキーマです。 */
const PutObjectInputSchema = v.object({
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
const SearchObjectsInputSchema = v.object({
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
const OptionalListObjectsOptionsSchema = v.optional(ListObjectsOptionsSchema);

/**
 * オブジェクトストレージーのように動作する IO 層のファサードです。
 *
 * 実体の保存先に unikvs ビルダー、メタデータとベクトルの保存先に `IObjectIndex`、自然言語検索に `IEmbedder` を使います。
 *
 * すべての非同期メソッドは `asyncmux` によりインスタンス単位で排他します。
 * データの整合性のためではなく、`open` や `close` などのライフサイクルと操作が同時実行されないためです。
 *
 * `open` と `close` は、シグナルを省略した場合に 30 秒でタイムアウトします。指定した場合はそのシグナルに従います。
 * それ以外のメソッドは、呼び出し側のシグナルと `close` 時に中断されるライフサイクルシグナルを合成し、先に中断された方に従います。
 * シグナルを省略した場合はライフサイクルシグナルを使います。
 *
 * 公開メソッドの入力値は valibot により検証します。
 */
export class Omnio {
  readonly #entity: IOmnioEntity;

  readonly #index: IObjectIndex;

  readonly #embedder: IEmbedder;

  #deletionTask: Promise<void> | undefined;

  #lifecycle: AbortController;

  #opened: boolean;

  readonly #pendingDeletions = new Map<
    string,
    {
      key: OmnioKey;
      entityId: string;
    }
  >();

  #reindexTask: Promise<void> | undefined;

  /**
   * @param options データベースと埋め込み、ストレージーです。すべて必須です。
   */
  public constructor(options: OmnioOptions) {
    const parsed = v.parse(OmnioOptionsSchema, options);
    this.#entity = v.parse(
      IOmnioEntitySchema,
      parsed.entity.build({
        beforeAll: [new ChecksumSha256()],
      }),
    );
    this.#index = parsed.index;
    this.#embedder = parsed.embedder;

    this.#lifecycle = new AbortController();
    this.#opened = false;
  }

  /**
   * `Omnio` が現在開いているかを示します。
   */
  public get isOpen(): boolean {
    return this.#opened;
  }

  /**
   * 実体とインデックスを開きます。
   *
   * @param signal 処理を中断するための中断シグナルです。省略時は 30 秒でタイムアウトします。
   */
  public async open(signal?: AbortSignal): Promise<void> {
    const active = withLifecycleTimeout(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    if (this.#opened) {
      return;
    }

    await this.#entity.open({ signal: active });

    try {
      await this.#index.open({
        action: "open",
        signal: active,
      });
      await this.#index.markDirty({
        action: "markDirty",
        signal: active,
        embeddingModel: this.#embedder.info.name,
      });
    } catch (ex) {
      await Promise.resolve(
        this.#index.close({
          action: "close",
          signal: AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS),
        }),
      ).catch(() => undefined);
      await this.#entity
        .close({ signal: AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS) })
        .catch(() => undefined);
      throw ex;
    }

    this.#opened = true;
    this.#scheduleReindex();
  }

  /**
   * 実体とインデックスを閉じます。
   *
   * @param signal 処理を中断するための中断シグナルです。省略時は 30 秒でタイムアウトします。
   */
  public async close(signal?: AbortSignal): Promise<void> {
    const active = withLifecycleTimeout(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    while (this.#deletionTask !== undefined) {
      await this.#deletionTask;
      active.throwIfAborted();
    }

    if (this.#opened) {
      this.#lifecycle.abort(new OperationAbortedError());

      const reindexTask = this.#reindexTask;

      if (reindexTask !== undefined) {
        await reindexTask;
        active.throwIfAborted();
      }
    }

    using _lock = await asyncmux(this, active);

    if (!this.#opened) {
      return;
    }

    await this.#index.close({
      action: "close",
      signal: active,
    });
    await this.#entity.close({ signal: active });
    this.#opened = false;
    this.#lifecycle = new AbortController();
  }

  /**
   * オブジェクトを保存します。
   *
   * @param input 保存する入力です。
   *
   * @returns 保存したオブジェクトです。
   */
  public async putObject<TUserMetadata = Record<string, unknown>>(
    input: PutObjectInput<TUserMetadata>,
  ): Promise<OmnioObject<TUserMetadata>> {
    this.#requireOpen("putObject");

    const parsed = v.parse(PutObjectInputSchema, input);
    const active = this.#activeSignal(parsed.signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const key = toOmnioKey(parsed.key);
    const bytes = await toBytes(parsed.data);

    active.throwIfAborted();

    const existing = await this.#index.get<TUserMetadata>({
      key,
      action: "get",
      signal: active,
    });
    const now = new Date().toISOString();
    const entityId =
      existing === null || existing.entityId === "" ? crypto.randomUUID() : existing.entityId;
    let embedding: Float32Array | undefined;
    let embeddingModel: string | undefined;
    let embeddingSource: EmbedSource | undefined;

    if (parsed.embedding !== undefined) {
      embedding = parsed.embedding;
    } else if ((parsed.embed ?? true) && parsed.description !== undefined) {
      const embedded = await this.#embedDescription(parsed.description, active);
      embedding = embedded.embedding;
      embeddingModel = embedded.embeddingModel;
      embeddingSource = embedded.embeddingSource;
    }

    const previousBytes =
      existing === null
        ? undefined
        : ((await this.#readEntityBytes(existing, active)) ?? undefined);

    try {
      const hash = await this.#setEntity(entityId, bytes, active);
      const object: OmnioObject<TUserMetadata> = {
        key,
        tags: [...(parsed.tags ?? [])],
        system: {
          hash,
          size: bytes.byteLength,
          createdAt: existing?.system.createdAt ?? now,
          updatedAt: now,
          contentType: parsed.contentType,
        },
        entityId,
        embedding,
        description: parsed.description,
        userMetadata: (parsed.userMetadata ?? {}) as TUserMetadata,
        embeddingDims: embedding === undefined ? undefined : embedding.length,
        embeddingModel,
        embeddingSource,
      };
      await this.#index.upsert({
        action: "upsert",
        object,
        signal: active,
      });

      return object;
    } catch (ex) {
      await this.#restoreEntity(entityId, previousBytes).catch(() => undefined);
      throw ex;
    }
  }

  /**
   * 実体のバイト列を取得します。
   *
   * @param key 取得するキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns バイト列、存在しない場合は null です。
   */
  public async getObject(key: OmnioKey | string, signal?: AbortSignal): Promise<Uint8Array | null> {
    this.#requireOpen("getObject");

    const objectKey = toOmnioKey(v.parse(OmnioKeySchema, key));
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const object = await this.#index.get<unknown>({
      key: objectKey,
      action: "get",
      signal: active,
    });

    if (object === null) {
      return null;
    }

    return await this.#readEntityBytes(object, active);
  }

  /**
   * 実体をストリームで取得します。
   *
   * 取得したストリームは呼び出し側で破棄してください。
   *
   * @param key 取得するキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns バイト列のストリーム、存在しない場合は null です。
   */
  public async streamObject(
    key: OmnioKey | string,
    signal?: AbortSignal,
  ): Promise<IValueStream<Uint8Array> | null> {
    this.#requireOpen("streamObject");

    const objectKey = toOmnioKey(v.parse(OmnioKeySchema, key));
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const object = await this.#index.get<unknown>({
      key: objectKey,
      action: "get",
      signal: active,
    });

    if (object === null) {
      return null;
    }

    const stream = await nullIfKeyNotFound(() =>
      this.#entity.stream(object.entityId, { signal: active }),
    );

    if (stream !== null) {
      return stream;
    }

    const legacyKey = object.key.key;

    if (legacyKey === object.entityId) {
      return null;
    }

    return await nullIfKeyNotFound(() => this.#entity.stream(legacyKey, { signal: active }));
  }

  /**
   * メタデータを取得します。
   *
   * @param key 取得するキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns メタデータ、存在しない場合は null です。
   */
  public async headObject<TUserMetadata = Record<string, unknown>>(
    key: OmnioKey | string,
    signal?: AbortSignal,
  ): Promise<OmnioObject<TUserMetadata> | null> {
    this.#requireOpen("headObject");

    const objectKey = toOmnioKey(v.parse(OmnioKeySchema, key));
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    return await this.#index.get<TUserMetadata>({
      key: objectKey,
      action: "get",
      signal: active,
    });
  }

  /**
   * オブジェクトを削除します。
   *
   * @param key 削除するキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns 削除した場合は true、存在しなかった場合は false です。
   */
  public async deleteObject(key: OmnioKey | string, signal?: AbortSignal): Promise<boolean> {
    this.#requireOpen("deleteObject");

    const objectKey = toOmnioKey(v.parse(OmnioKeySchema, key));
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const object = await this.#index.get<unknown>({
      key: objectKey,
      action: "get",
      signal: active,
    });

    if (object === null) {
      return false;
    }

    const marked = await this.#index.delete({
      key: objectKey,
      action: "delete",
      signal: active,
    });

    if (marked) {
      this.#enqueueDeletion(object.key, object.entityId);
    }

    return marked;
  }

  /**
   * オブジェクトを一覧します。
   *
   * @param options 絞り込み条件とページ指定です。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns 一覧結果です。
   */
  public async listObjects<TUserMetadata = Record<string, unknown>>(
    options?: {
      limit?: number | undefined;
      cursor?: string | null | undefined;
      filter?: MetadataFilter | undefined;
    },
    signal?: AbortSignal,
  ): Promise<IObjectIndex.ListResult<TUserMetadata>> {
    this.#requireOpen("listObjects");

    const parsedOptions = v.parse(OptionalListObjectsOptionsSchema, options);
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    return await this.#index.list<TUserMetadata>({
      limit: parsedOptions?.limit,
      action: "list",
      cursor: parsedOptions?.cursor,
      filter: parsedOptions?.filter,
      signal: active,
    });
  }

  /**
   * 自然言語で意味検索します。
   *
   * @param input 検索クエリーです。
   *
   * @returns 類似度付きのオブジェクト一覧です。
   */
  public async searchObjects<TUserMetadata = Record<string, unknown>>(
    input: SearchObjectsInput,
  ): Promise<IndexedObject<TUserMetadata>[]> {
    this.#requireOpen("searchObjects");

    const parsed = v.parse(SearchObjectsInputSchema, input);
    const active = this.#activeSignal(parsed.signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const query = parsed.query;
    let vector: Float32Array;
    let embeddingModel: string | undefined;

    if ("text" in query) {
      vector = await this.#embedder.embedText({
        text: query.text,
        action: "embedText",
        signal: active,
      });
      embeddingModel = this.#embedder.info.name;
    } else if ("vector" in query) {
      vector = query.vector;
    } else {
      const image = query.image instanceof Uint8Array ? copiedBytes(query.image) : query.image;
      vector = await this.#embedder.embed({
        input: {
          data: image,
          kind: "image",
          mimeType: query.mimeType,
        },
        action: "embed",
        signal: active,
      });

      embeddingModel = this.#embedder.info.name;
    }

    const results = await this.#index.search<TUserMetadata>({
      topK: parsed.topK ?? 20,
      action: "search",
      filter: parsed.filter,
      signal: active,
      vector,
      minScore: parsed.minScore,
      embeddingModel,
    });

    if (parsed.includeEmbedding === false) {
      return results.map((item) => ({
        ...item,
        embedding: undefined,
      }));
    }

    return results;
  }

  /**
   * 既存オブジェクトの埋め込みを作り直します。
   *
   * @param key 作り直すキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns 更新したオブジェクト、存在しない場合は null です。
   */
  public async reindexObject<TUserMetadata = Record<string, unknown>>(
    key: OmnioKey | string,
    signal?: AbortSignal,
  ): Promise<OmnioObject<TUserMetadata> | null> {
    this.#requireOpen("reindexObject");

    const objectKey = toOmnioKey(v.parse(OmnioKeySchema, key));
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const object = await this.#index.get<TUserMetadata>({
      key: objectKey,
      action: "get",
      signal: active,
    });

    if (object === null) {
      return null;
    }

    return await this.#reindexStoredObject(object, active);
  }

  /**
   * 保存済みオブジェクトの埋め込みを作り直します。
   *
   * 説明文がない場合は何も変更せず、そのまま返します。
   *
   * @param object 埋め込みを作り直すオブジェクトです。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns 更新したオブジェクトです。
   */
  async #reindexStoredObject<TUserMetadata>(
    object: OmnioObject<TUserMetadata>,
    signal: AbortSignal,
  ): Promise<OmnioObject<TUserMetadata>> {
    if (object.description === undefined) {
      return object;
    }

    const embedded = await this.#embedDescription(object.description, signal);
    const reindexed: OmnioObject<TUserMetadata> = {
      ...object,
      embedding: embedded.embedding,
      embeddingDims: embedded.embedding.length,
      embeddingModel: embedded.embeddingModel,
      embeddingSource: embedded.embeddingSource,
      system: {
        ...object.system,
        updatedAt: new Date().toISOString(),
      },
    };
    await this.#index.upsert({
      action: "upsert",
      object: reindexed,
      signal,
    });

    return reindexed;
  }

  /**
   * 説明文の埋め込みと、その由来のメタデータを作ります。
   *
   * @param text 埋め込む説明文です。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns 埋め込みベクトルとモデル名、由来です。
   */
  async #embedDescription(
    text: string,
    signal: AbortSignal,
  ): Promise<{
    embedding: Float32Array;
    embeddingModel: string;
    embeddingSource: EmbedSource;
  }> {
    const embedding = await this.#embedder.embedText({
      text,
      action: "embedText",
      signal,
    });

    return {
      embedding,
      embeddingModel: this.#embedder.info.name,
      embeddingSource: {
        kind: "description",
        model: this.#embedder.info.name,
      },
    };
  }

  /**
   * dirty フラグが立ったオブジェクトの再インデックスを開始します。
   */
  #scheduleReindex(): void {
    if (this.#reindexTask !== undefined) {
      return;
    }

    this.#reindexTask = this.#runReindexSchedule();
  }

  /**
   * バックグラウンドの再インデックスを実行し、終了後にタスクを解放します。
   */
  async #runReindexSchedule(): Promise<void> {
    try {
      await this.#drainDirtyObjects();
    } catch {
      // 失敗したオブジェクトは dirty フラグを残し、次回の open に委ねます。
    } finally {
      this.#reindexTask = undefined;
    }
  }

  /**
   * dirty フラグが立ったオブジェクトを 1 件ずつ再インデックスします。
   *
   * 1 件ごとにロックを解放し、他の操作を妨げないようにします。
   */
  async #drainDirtyObjects(): Promise<void> {
    for (;;) {
      const signal = AbortSignal.any([
        this.#lifecycle.signal,
        AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS),
      ]);
      using _lock = await asyncmux(this, signal);

      if (!this.#opened) {
        return;
      }

      const dirty = await this.#index.listDirty<unknown>({
        limit: 1,
        action: "listDirty",
        signal,
      });
      const object = dirty[0];

      if (object === undefined || object.description === undefined) {
        return;
      }

      await this.#reindexStoredObject(object, signal);
    }
  }

  /**
   * 操作で使う中断シグナルを返します。
   *
   * @param signal 呼び出し側が指定した中断シグナルです。
   *
   * @returns 指定されたシグナルと close 時のライフサイクルシグナルを合成したシグナルです。指定がない場合はライフサイクルシグナルです。
   */
  #activeSignal(signal: AbortSignal | undefined): AbortSignal {
    return signal === undefined
      ? this.#lifecycle.signal
      : AbortSignal.any([signal, this.#lifecycle.signal]);
  }

  /**
   * 削除フラグが立ったオブジェクトの実体削除を予約します。
   *
   * @param key 削除するオブジェクトのキーです。
   * @param entityId 削除する実体 ID です。
   */
  #enqueueDeletion(key: OmnioKey, entityId: string): void {
    this.#pendingDeletions.set(entityId, {
      key,
      entityId,
    });
    this.#scheduleDeletion();
  }

  /**
   * 実体削除のバックグラウンド処理を開始します。
   */
  #scheduleDeletion(): void {
    if (this.#deletionTask !== undefined) {
      return;
    }

    this.#deletionTask = this.#runDeletionSchedule();
  }

  /**
   * 実体削除のバックグラウンド処理を実行し、終了後に次の予約を確認します。
   */
  async #runDeletionSchedule(): Promise<void> {
    try {
      await this.#drainDeletions();
    } catch {
      // バックグラウンド処理の失敗は削除フラグを残して次の機会に委ねます。
    } finally {
      this.#deletionTask = undefined;

      if (this.#pendingDeletions.size > 0) {
        this.#scheduleDeletion();
      }
    }
  }

  /**
   * 予約された実体削除を順番に実行します。
   */
  async #drainDeletions(): Promise<void> {
    while (this.#pendingDeletions.size > 0) {
      const entry = this.#pendingDeletions.entries().next().value;

      if (entry === undefined) {
        return;
      }

      const [entityId, task] = entry;
      this.#pendingDeletions.delete(entityId);

      try {
        const signal = AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS);
        using _lock = await asyncmux(this, signal);

        if (!this.#opened) {
          return;
        }

        await this.#purgeEntity(task.key, task.entityId, signal);
      } catch {
        // 失敗した場合は削除フラグを残し、後続の処理を継続します。
      }
    }
  }

  /**
   * オブジェクトの実体を削除し、ObjectIndex の削除フラグ付きレコードを物理削除します。
   *
   * @param key 削除するオブジェクトのキーです。
   * @param entityId 削除する実体 ID です。
   * @param signal 処理を中断するための中断シグナルです。
   */
  async #purgeEntity(key: OmnioKey, entityId: string, signal: AbortSignal): Promise<void> {
    const hasEntity = await this.#entity.has(entityId, { signal });

    if (hasEntity) {
      await this.#entity.delete(entityId, { signal });
    }

    const legacyKey = key.key;

    if (legacyKey !== entityId) {
      const hasLegacyEntity = await this.#entity.has(legacyKey, { signal });

      if (hasLegacyEntity) {
        await this.#entity.delete(legacyKey, { signal });
      }
    }

    await this.#index.purge({
      key,
      action: "purge",
      signal,
      entityId,
    });
  }

  /**
   * 実体のバイト列を取得します。
   *
   * 旧キーにのみ実体が存在する場合は、entityId のキーへ移行します。
   *
   * @param object 取得するオブジェクトです。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns バイト列、存在しない場合は null です。
   */
  async #readEntityBytes(
    object: Pick<OmnioObject<unknown>, "entityId" | "key">,
    signal: AbortSignal,
  ): Promise<Uint8Array | null> {
    const bytes = await nullIfKeyNotFound(() => this.#entity.get(object.entityId, { signal }));

    if (bytes !== null) {
      return bytes;
    }

    const legacyKey = object.key.key;

    if (legacyKey === object.entityId) {
      return null;
    }

    const legacyBytes = await nullIfKeyNotFound(() => this.#entity.get(legacyKey, { signal }));

    if (legacyBytes === null) {
      return null;
    }

    await this.#entity.set(object.entityId, legacyBytes, { signal });
    await this.#entity.delete(legacyKey, { signal }).catch(() => undefined);

    return legacyBytes;
  }

  /**
   * 実体を保存し、チェックサムを返します。
   *
   * チェックサムはビルド時に先頭へ挿入した `ChecksumSha256` が計算します。
   *
   * @param entityId 保存先の実体 ID です。
   * @param bytes 保存するバイト列です。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns SHA-256 の 16 進数 64 文字のハッシュ値です。
   */
  async #setEntity(
    entityId: string,
    bytes: Uint8Array<ArrayBuffer>,
    signal: AbortSignal,
  ): Promise<string> {
    let hash: string | undefined;
    await this.#entity.set(entityId, bytes, {
      vars: {
        [ChecksumSha256.CHECKSUM_ON_HASH_VAR_NAME]: (value: string) => {
          hash = value;
        },
      },
      signal,
    });

    if (hash === undefined) {
      throw new Error(
        "実体ストレージーの保存時に SHA-256 チェックサムを取得できませんでした。実体ビルダーが build オプションの beforeAll を適用しているか確認してください。",
      );
    }

    return hash;
  }

  /**
   * 失敗した保存の実体を元の状態に戻します。
   *
   * 保存前のバイト列があればそれを書き戻し、ない場合は削除します。
   * 補償処理には既定のタイムアウトを設定し、close 時の中断の影響を受けないようにします。
   *
   * @param entityId 復元する実体キーです。
   * @param previousBytes 保存前のバイト列です。存在しない場合もあります。
   */
  async #restoreEntity(entityId: string, previousBytes: Uint8Array | undefined): Promise<void> {
    const signal = AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS);

    if (previousBytes !== undefined) {
      await this.#entity.set(entityId, previousBytes, { signal });

      return;
    }

    await this.#entity.delete(entityId, { signal });
  }

  /**
   * 開いていることを確認して内部状態を返します。
   *
   * @param operation 実行中の操作名です。
   */
  #requireOpen(operation: string): void {
    if (!this.#opened) {
      throw new DbNotOpenError({ operation });
    }
  }
}
