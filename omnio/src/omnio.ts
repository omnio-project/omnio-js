// oxlint-disable import/no-namespace
import {
  type IEmbedder,
  type EmbedSource,
  type OmnioObject,
  type IObjectIndex,
  type IndexedObject,
  type MetadataFilter,
  OmnioKey,
  DbNotOpenError,
  OperationAbortedError,
} from "@omniojs/core";
import { ChecksumSha256 } from "@unikvs/checksum";
import { asyncmux } from "asyncmux";
import { type IValueStream, KeyNotFoundError } from "unikvs";
import * as v from "valibot";

import { BackgroundTaskManager } from "./_background-task-manager.js";
import type { IOmnioEntity, IOmnioEntityBuilder } from "./entity.js";
import {
  OmnioKeySchema,
  IOmnioEntitySchema,
  OmnioOptionsSchema,
  PutObjectInputSchema,
  SearchObjectsInputSchema,
  OptionalAbortSignalSchema,
  UpdateObjectMetadataInputSchema,
  OptionalListObjectsOptionsSchema,
} from "./validation.js";

/** `open` と `close` の既定タイムアウトです。ミリ秒単位で表します。 */
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 30_000;

/**
 * 実体ストレージーの保存時に使うハッシュアルゴリズムの識別子です。
 *
 * `ChecksumSha256` が計算するハッシュの識別子と一致させます。
 */
const ENTITY_HASH_ALGORITHM = "sha256";

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
 * オブジェクトの変更可能なメタデータを更新する入力です。
 *
 * 実体のバイト列に由来するサイズやハッシュ、作成時刻、実体 ID は更新できません。
 */
export type UpdateObjectMetadataInput<TUserMetadata = Record<string, unknown>> = {
  /** オブジェクトキーまたはその文字列表現です。 */
  readonly key: OmnioKey | string;

  /** コンテンツタイプです。省略時は変更しません。 */
  readonly contentType?: string | undefined;

  /** 任意のテキスト形式の説明文です。省略時は変更しません。 */
  readonly description?: string | undefined;

  /** 絞り込み用のタグ一覧です。省略時は変更しません。空配列を指定するとすべて削除します。 */
  readonly tags?: readonly string[] | undefined;

  /** 利用者が自由に付与するメタデータです。省略時は変更しません。 */
  readonly userMetadata?: TUserMetadata | undefined;

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
 * オブジェクトストレージーのように動作する IO 層のファサードです。
 *
 * 実体の保存先に unikvs ビルダー、メタデータとベクトルの保存先に `IObjectIndex`、自然言語検索に `IEmbedder` を使います。
 *
 * `open` と `close` は `asyncmux` の排他ロックを、それ以外のメソッドは `asyncmux.readonly` の共有ロックを使います。
 * データの整合性のためではなく、`open` や `close` などのライフサイクルと操作が同時実行されないためです。
 * その他の操作同士は共有ロックのため並行して実行できます。
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

  readonly #deletions = new BackgroundTaskManager();

  #lifecycle: AbortController;

  #opened: boolean;

  readonly #reindex = new BackgroundTaskManager();

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
    this.#reindex.schedule("reindex", () => this.#drainDirtyObjects());
  }

  /**
   * 実体とインデックスを閉じます。
   *
   * @param signal 処理を中断するための中断シグナルです。省略時は 30 秒でタイムアウトします。
   */
  public async close(signal?: AbortSignal): Promise<void> {
    const active = withLifecycleTimeout(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    if (this.#deletions.isRunning) {
      await this.#deletions.wait();
      active.throwIfAborted();
    }

    if (this.#opened) {
      this.#lifecycle.abort(new OperationAbortedError());

      if (this.#reindex.isRunning) {
        await this.#reindex.wait();
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

    using _lock = await asyncmux.readonly(this, active);

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
        : ((await this.#readEntityBytes(existing.entityId, active)) ?? undefined);

    try {
      const hash = await this.#setEntity(entityId, bytes, active);
      const object: OmnioObject<TUserMetadata> = {
        key,
        hash,
        size: bytes.byteLength,
        tags: [...(parsed.tags ?? [])],
        entityId,
        createdAt: existing?.createdAt ?? now,
        embedding,
        updatedAt: now,
        contentType: parsed.contentType,
        description: parsed.description,
        userMetadata: (parsed.userMetadata ?? {}) as TUserMetadata,
        embeddingDims: embedding === undefined ? undefined : embedding.length,
        hashAlgorithm: ENTITY_HASH_ALGORITHM,
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
   * オブジェクトを複製します。
   *
   * 実体のバイト列とメタデータを複製先へコピーします。
   * 複製先が既に存在する場合は上書きし、元の作成時刻と実体 ID を引き継ぎます。
   * 同じキーを指定した場合は何もせず、元のオブジェクトを返します。
   *
   * @param sourceKey 複製元のキーです。
   * @param destinationKey 複製先のキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns 複製したオブジェクト、複製元が存在しない場合は null です。
   */
  public async copyObject<TUserMetadata = Record<string, unknown>>(
    sourceKey: OmnioKey | string,
    destinationKey: OmnioKey | string,
    signal?: AbortSignal,
  ): Promise<OmnioObject<TUserMetadata> | null> {
    this.#requireOpen("copyObject");

    const sourceObjectKey = toOmnioKey(v.parse(OmnioKeySchema, sourceKey));
    const destinationObjectKey = toOmnioKey(v.parse(OmnioKeySchema, destinationKey));
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux.readonly(this, active);

    const source = await this.#index.get<TUserMetadata>({
      key: sourceObjectKey,
      action: "get",
      signal: active,
    });

    if (source === null) {
      return null;
    }

    if (sourceObjectKey.key === destinationObjectKey.key) {
      return source;
    }

    const bytes = await this.#readEntityBytes(source.entityId, active);

    if (bytes === null) {
      return null;
    }

    const existing = await this.#index.get<TUserMetadata>({
      key: destinationObjectKey,
      action: "get",
      signal: active,
    });
    const now = new Date().toISOString();
    const entityId =
      existing === null || existing.entityId === "" ? crypto.randomUUID() : existing.entityId;
    const previousBytes =
      existing === null
        ? undefined
        : ((await this.#readEntityBytes(existing.entityId, active)) ?? undefined);

    try {
      await this.#entity.set(entityId, bytes, { signal: active });

      const object: OmnioObject<TUserMetadata> = {
        key: destinationObjectKey,
        hash: source.hash,
        size: bytes.byteLength,
        tags: [...source.tags],
        entityId,
        createdAt: existing?.createdAt ?? now,
        embedding: source.embedding,
        updatedAt: now,
        contentType: source.contentType,
        description: source.description,
        userMetadata: source.userMetadata,
        embeddingDims: source.embeddingDims,
        hashAlgorithm: source.hashAlgorithm,
        embeddingModel: source.embeddingModel,
        embeddingSource: source.embeddingSource,
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
   * オブジェクトのキーを変更します。
   *
   * 実体のバイト列は移動せず、同じ実体 ID を維持します。
   * 変更先が既に存在する場合は上書きし、変更先の実体はバックグラウンドで削除します。
   * 同じキーを指定した場合は何もせず、元のオブジェクトを返します。
   *
   * @param sourceKey 変更元のキーです。
   * @param destinationKey 変更先のキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns キーを変更したオブジェクト、変更元が存在しない場合は null です。
   */
  public async renameObject<TUserMetadata = Record<string, unknown>>(
    sourceKey: OmnioKey | string,
    destinationKey: OmnioKey | string,
    signal?: AbortSignal,
  ): Promise<OmnioObject<TUserMetadata> | null> {
    this.#requireOpen("renameObject");

    const sourceObjectKey = toOmnioKey(v.parse(OmnioKeySchema, sourceKey));
    const destinationObjectKey = toOmnioKey(v.parse(OmnioKeySchema, destinationKey));
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux.readonly(this, active);

    if (sourceObjectKey.key === destinationObjectKey.key) {
      return await this.#index.get<TUserMetadata>({
        key: sourceObjectKey,
        action: "get",
        signal: active,
      });
    }

    const renamed = await this.#index.rename<TUserMetadata>({
      action: "rename",
      signal: active,
      sourceKey: sourceObjectKey,
      updatedAt: new Date().toISOString(),
      destinationKey: destinationObjectKey,
    });

    if (renamed === null) {
      return null;
    }

    const replacedEntityId = renamed.replacedEntityId;

    if (replacedEntityId !== undefined && replacedEntityId !== renamed.object.entityId) {
      this.#enqueueDeletion(destinationObjectKey, replacedEntityId);
    }

    return renamed.object;
  }

  /**
   * オブジェクトの変更可能なメタデータだけを更新します。
   *
   * 実体ストレージーは変更しません。サイズ、ハッシュ、作成時刻、実体 ID は更新できません。
   * 説明文を変更しても埋め込みベクトルは作り直さないため、検索へ反映するには `reindexObject` を使ってください。
   *
   * @param input 更新する入力です。
   *
   * @returns 更新したオブジェクト、存在しない場合は null です。
   */
  public async updateObjectMetadata<TUserMetadata = Record<string, unknown>>(
    input: UpdateObjectMetadataInput<TUserMetadata>,
  ): Promise<OmnioObject<TUserMetadata> | null> {
    this.#requireOpen("updateObjectMetadata");

    const parsed = v.parse(UpdateObjectMetadataInputSchema, input);
    const active = this.#activeSignal(parsed.signal);
    active.throwIfAborted();

    using _lock = await asyncmux.readonly(this, active);

    const key = toOmnioKey(parsed.key);
    const updatedAt = new Date().toISOString();

    return await this.#index.updateMetadata<TUserMetadata>({
      key,
      action: "updateMetadata",
      signal: active,
      metadata: {
        tags: parsed.tags,
        updatedAt,
        contentType: parsed.contentType,
        description: parsed.description,
        userMetadata: parsed.userMetadata as TUserMetadata | undefined,
      },
    });
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

    using _lock = await asyncmux.readonly(this, active);

    const object = await this.#index.get<unknown>({
      key: objectKey,
      action: "get",
      signal: active,
    });

    if (object === null) {
      return null;
    }

    return await this.#readEntityBytes(object.entityId, active);
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

    using _lock = await asyncmux.readonly(this, active);

    const object = await this.#index.get<unknown>({
      key: objectKey,
      action: "get",
      signal: active,
    });

    if (object === null) {
      return null;
    }

    return await nullIfKeyNotFound(() => this.#entity.stream(object.entityId, { signal: active }));
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

    using _lock = await asyncmux.readonly(this, active);

    return await this.#index.get<TUserMetadata>({
      key: objectKey,
      action: "get",
      signal: active,
    });
  }

  /**
   * オブジェクトのメタデータが存在するかを確認します。
   *
   * 実体ストレージーは参照しません。削除フラグが立ったオブジェクトは存在しないものとして扱います。
   *
   * @param key 確認するキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns メタデータが存在する場合は true、存在しない場合は false です。
   */
  public async hasObject(key: OmnioKey | string, signal?: AbortSignal): Promise<boolean> {
    this.#requireOpen("hasObject");

    const objectKey = toOmnioKey(v.parse(OmnioKeySchema, key));
    const active = this.#activeSignal(v.parse(OptionalAbortSignalSchema, signal));
    active.throwIfAborted();

    using _lock = await asyncmux.readonly(this, active);

    return await this.#index.has({
      key: objectKey,
      action: "has",
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

    using _lock = await asyncmux.readonly(this, active);

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

    using _lock = await asyncmux.readonly(this, active);

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

    using _lock = await asyncmux.readonly(this, active);

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

    using _lock = await asyncmux.readonly(this, active);

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
      updatedAt: new Date().toISOString(),
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
      using _lock = await asyncmux.readonly(this, signal);

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
    this.#deletions.schedule(entityId, async () => {
      const signal = AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS);
      using _lock = await asyncmux.readonly(this, signal);

      if (!this.#opened) {
        return;
      }

      await this.#purgeEntity(key, entityId, signal);
    });
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
   * @param entityId 取得する実体 ID です。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns バイト列、存在しない場合は null です。
   */
  async #readEntityBytes(entityId: string, signal: AbortSignal): Promise<Uint8Array | null> {
    return nullIfKeyNotFound(() => this.#entity.get(entityId, { signal }));
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
