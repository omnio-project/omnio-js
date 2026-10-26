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
import { asyncmux } from "asyncmux";
import { type IValueStream, KeyNotFoundError } from "unikvs";

import type { IOmnioEntity } from "./entity.js";

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
  /** 実体を保存するストレージーです。 */
  readonly entity: IOmnioEntity;

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
 * バイト列の SHA-256 ハッシュ値を求めます。
 *
 * @param data ハッシュ化するバイト列です。
 *
 * @returns 16 進数 64 文字のハッシュ値です。
 */
async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
 * 実体の保存先に unikvs、メタデータとベクトルの保存先に `IObjectIndex`、自然言語検索に `IEmbedder` を使います。
 *
 * すべての非同期メソッドは `asyncmux` によりインスタンス単位で排他します。
 * データの整合性のためではなく、`open` や `close` などのライフサイクルと操作が同時実行されないためです。
 *
 * `open` と `close` は、シグナルを省略した場合に 30 秒でタイムアウトします。指定した場合はそのシグナルに従います。
 * それ以外のメソッドは、呼び出し側のシグナルと `close` 時に中断されるライフサイクルシグナルを合成し、先に中断された方に従います。
 * シグナルを省略した場合はライフサイクルシグナルを使います。
 */
export class Omnio {
  readonly #entity: IOmnioEntity;

  readonly #index: IObjectIndex;

  readonly #embedder: IEmbedder;

  #lifecycle: AbortController;

  #opened: boolean;

  /**
   * @param options データベースと埋め込み、ストレージーです。すべて必須です。
   */
  public constructor(options: OmnioOptions) {
    this.#entity = options.entity;
    this.#index = options.index;
    this.#embedder = options.embedder;
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
    const active = withLifecycleTimeout(signal);
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
    } catch (ex) {
      await this.#entity
        .close({ signal: AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS) })
        .catch(() => undefined);
      throw ex;
    }

    this.#opened = true;
  }

  /**
   * 実体とインデックスを閉じます。
   *
   * @param signal 処理を中断するための中断シグナルです。省略時は 30 秒でタイムアウトします。
   */
  public async close(signal?: AbortSignal): Promise<void> {
    const active = withLifecycleTimeout(signal);
    active.throwIfAborted();

    if (this.#opened) {
      this.#lifecycle.abort(new OperationAbortedError());
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

    const active = this.#activeSignal(input.signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const key = toOmnioKey(input.key);
    const keyString = key.key;
    const bytes = await toBytes(input.data);

    active.throwIfAborted();

    const existing = await this.#index.get<TUserMetadata>({
      key,
      action: "get",
      signal: active,
    });
    const now = new Date().toISOString();
    let embedding: Float32Array | undefined;
    let embeddingModel: string | undefined;
    let embeddingSource: EmbedSource | undefined;

    if (input.embedding !== undefined) {
      embedding = input.embedding;
    } else if ((input.embed ?? true) && input.description !== undefined) {
      const embedded = await this.#embedDescription(input.description, active);
      embedding = embedded.embedding;
      embeddingModel = embedded.embeddingModel;
      embeddingSource = embedded.embeddingSource;
    }

    const object: OmnioObject<TUserMetadata> = {
      key,
      tags: [...(input.tags ?? [])],
      system: {
        hash: await sha256Hex(bytes),
        size: bytes.byteLength,
        createdAt: existing?.system.createdAt ?? now,
        updatedAt: now,
        contentType: input.contentType,
      },
      embedding,
      description: input.description,
      userMetadata: input.userMetadata ?? ({} as TUserMetadata),
      embeddingDims: embedding === undefined ? undefined : embedding.length,
      embeddingModel,
      embeddingSource,
    };
    const previousBytes =
      (await nullIfKeyNotFound(() => this.#entity.get(keyString, { signal: active }))) ?? undefined;

    try {
      await this.#entity.set(keyString, bytes, { signal: active });
      await this.#index.upsert({
        action: "upsert",
        object,
        signal: active,
      });
    } catch (ex) {
      await this.#restoreEntity(keyString, previousBytes).catch(() => undefined);
      throw ex;
    }

    return object;
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

    const active = this.#activeSignal(signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    return await nullIfKeyNotFound(() => this.#entity.get(toOmnioKey(key).key, { signal: active }));
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

    const active = this.#activeSignal(signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    return await nullIfKeyNotFound(() =>
      this.#entity.stream(toOmnioKey(key).key, { signal: active }),
    );
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

    const active = this.#activeSignal(signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    return await this.#index.get<TUserMetadata>({
      key: toOmnioKey(key),
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

    const active = this.#activeSignal(signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const objectKey = toOmnioKey(key);
    const existed = await this.#entity.has(objectKey.key, { signal: active });
    await this.#entity.delete(objectKey.key, { signal: active });

    const indexDeleted = await this.#index.delete({
      key: objectKey,
      action: "delete",
      signal: active,
    });

    return existed || indexDeleted;
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

    const active = this.#activeSignal(signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    return await this.#index.list<TUserMetadata>({
      limit: options?.limit,
      action: "list",
      cursor: options?.cursor,
      filter: options?.filter,
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

    const active = this.#activeSignal(input.signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const query = input.query;
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
      topK: input.topK ?? 20,
      action: "search",
      filter: input.filter,
      signal: active,
      vector,
      minScore: input.minScore,
      embeddingModel,
    });

    if (input.includeEmbedding === false) {
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

    const active = this.#activeSignal(signal);
    active.throwIfAborted();

    using _lock = await asyncmux(this, active);

    const objectKey = toOmnioKey(key);
    const object = await this.#index.get<TUserMetadata>({
      key: objectKey,
      action: "get",
      signal: active,
    });

    if (object === null || object.description === undefined) {
      return object;
    }

    const embedded = await this.#embedDescription(object.description, active);
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
      signal: active,
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
   * 失敗した保存の実体を元の状態に戻します。
   *
   * 保存前のバイト列があればそれを書き戻し、ない場合は削除します。
   * 補償処理には既定のタイムアウトを設定し、close 時の中断の影響を受けないようにします。
   *
   * @param key 復元するキーです。
   * @param previousBytes 保存前のバイト列です。存在しない場合もあります。
   */
  async #restoreEntity(key: string, previousBytes: Uint8Array | undefined): Promise<void> {
    const signal = AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS);

    if (previousBytes !== undefined) {
      await this.#entity.set(key, previousBytes, { signal });

      return;
    }

    await this.#entity.delete(key, { signal });
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
