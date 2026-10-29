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
import { type Checksum, type ChecksumOnHash, ChecksumSha256 } from "@unikvs/checksum";
import { type AsyncmuxLock, Asyncmux, asyncmux } from "asyncmux";
import { type IValueStream, KeyNotFoundError } from "unikvs";
import * as v from "valibot";

import { BackgroundTaskManager } from "./_background-task-manager.js";
import type { IOmnioEntity, IOmnioEntityBuilder } from "./entity.js";
import {
  OmnioKeySchema,
  IOmnioEntitySchema,
  OmnioOptionsSchema,
  PutObjectInputSchema,
  HeadObjectOptionsSchema,
  SearchObjectsInputSchema,
  OptionalAbortSignalSchema,
  UpdateObjectMetadataInputSchema,
  OptionalListObjectsOptionsSchema,
} from "./validation.js";

/** `open` と `close` の既定タイムアウトです。ミリ秒単位で表します。 */
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 30_000;

/** dirty 再インデックスの 1 回の走査で処理する最大件数です。 */
const DIRTY_BATCH_SIZE = 10;

/** 進捗のない dirty 走査を、古いスナップショットだけを理由に再試行する回数です。 */
const DIRTY_STALE_RETRY_LIMIT = 1;

/**
 * キー付き排他ロックの解放をまとめたハンドルです。
 */
type KeyLockHandle = {
  [Symbol.dispose](): void;
};

/**
 * dirty オブジェクト 1 件の再インデックス結果です。
 */
type ReindexOutcome = "applied" | "stale" | "failed";

/**
 * 実体ストレージーの保存時に使うハッシュアルゴリズムの識別子です。
 *
 * `ChecksumSha256` が計算するハッシュの識別子と一致させます。
 */
const ENTITY_HASH_ALGORITHM = "sha256";

/**
 * Omnio 専用の SHA-256 チェックサムです。
 *
 * 利用者が実体ビルダーに追加した `ChecksumSha256` と同じ変数名を使うと、読み取り時に利用者側のインスタンスが先に検証してしまいます。
 * そのため、専用の変数名に分けます。
 */
class OmnioChecksum extends ChecksumSha256 {
  public static override readonly CHECKSUM_VAR_NAME = "@omniojs/entity:checksum";
}

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
 * Promise の完了を中断シグナルと競争させて待ちます。
 *
 * @param task 待つ処理です。
 * @param signal 処理を中断するための中断シグナルです。
 */
async function waitForAbortable(task: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();

  const aborted = Promise.withResolvers<never>();
  const onAbort = (): void => {
    aborted.reject(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal.aborted) {
      aborted.reject(signal.reason);
    }

    await Promise.race([task, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
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
 * `headObject` で取得するメタデータの項目です。
 */
export type HeadObjectField = keyof OmnioObject;

/**
 * `headObject` で取得するメタデータの選択です。
 *
 * `true` を指定した項目だけを取得します。`false` を指定した項目や省略した項目は取得しません。
 */
export type HeadObjectSelect = Readonly<Partial<Record<HeadObjectField, boolean | undefined>>>;

/**
 * すべてのメタデータを選択する型です。
 */
type HeadObjectSelectAll = Readonly<Record<HeadObjectField, true>>;

/**
 * 選択した項目の型を求めます。
 *
 * @template TSelect メタデータの選択です。
 */
type SelectedHeadObjectField<TSelect extends HeadObjectSelect> = keyof TSelect extends never
  ? never
  : HeadObjectSelect extends TSelect
    ? HeadObjectField
    : {
        [TField in keyof TSelect]: TSelect[TField] extends true ? TField : never;
      }[keyof TSelect] &
        HeadObjectField;

/**
 * `headObject` のオプションです。
 */
export type HeadObjectOptions<TSelect extends HeadObjectSelect = HeadObjectSelect> = {
  /** 取得するメタデータの項目です。`true` を指定した項目だけを取得します。`select` 自体を省略した場合はすべての項目を取得します。 */
  readonly select?: TSelect | undefined;

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
 * オブジェクトから指定した項目だけを選択します。
 *
 * @param source 選択元のオブジェクトです。
 * @param fields 選択する項目です。
 *
 * @returns 選択した項目だけを持つオブジェクトです。
 */
function selectFields<T extends object, TField extends keyof T>(
  source: T,
  fields: readonly TField[],
): Pick<T, TField> {
  return Object.fromEntries(fields.map((field) => [field, source[field]])) as Pick<T, TField>;
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
 * @param signal 処理を中断するための中断シグナルです。
 *
 * @returns ArrayBuffer に裏打ちされたバイト列の複製です。
 */
async function toBytes(
  data: Uint8Array | Blob | ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();

  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }

  if (data instanceof Blob) {
    const bytes = new Uint8Array(await data.arrayBuffer());

    signal.throwIfAborted();

    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = data.getReader();
  const cancelReader = async (): Promise<void> => {
    try {
      await reader.cancel(signal.reason);
    } catch {
      // 中断後のキャンセル失敗は無視します。
    }
  };
  const onAbort = (): void => {
    void cancelReader();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      signal.throwIfAborted();

      const { done, value } = await reader.read();

      signal.throwIfAborted();

      if (done) {
        break;
      }

      if (value !== undefined) {
        chunks.push(value);
        length += value.byteLength;
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
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
 * チェックサム検証に使う実行時変数を作ります。
 *
 * @param hash インデックスに保存されたハッシュ値です。
 * @param hashAlgorithm ハッシュアルゴリズムの識別子です。
 *
 * @returns 検証に使う実行時変数、検証できない場合は undefined です。
 */
function checksumVars(
  hash: string | undefined,
  hashAlgorithm: string | undefined,
): Record<string, string> | undefined {
  return hash === undefined || hashAlgorithm !== ENTITY_HASH_ALGORITHM
    ? undefined
    : {
        [OmnioChecksum.CHECKSUM_VAR_NAME]: hash,
      };
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
 * 読み取りはバックグラウンドの埋め込み計算を待ちません。
 * ベクトル検索は、その時点で完了している行だけを対象にし、dirty や削除済みの行は除外します。
 * 取得・存在確認・一覧は削除済みの行だけを除外し、再インデックス待ちの行も最新のメタデータとして返します。
 * 同梱の SQL インデックス実装では読み取り共有・書き込み排他のロックを使うため、複数の読み取りはロック待ちになりません。
 *
 * 同じキーへの書き込み系の操作とバックグラウンドの削除は、キー単位の排他ロックで直列化します。
 * キーをまたぐ操作は、キーを並べ替えて取得することでデッドロックを防ぎます。
 *
 * `open` と `close` は、シグナルを省略した場合に 30 秒でタイムアウトします。指定した場合はそのシグナルに従います。
 * それ以外のメソッドは、呼び出し側のシグナルと `close` 時に中断されるライフサイクルシグナルを合成し、先に中断された方に従います。
 * シグナルを省略した場合はライフサイクルシグナルを使います。
 *
 * 公開メソッドの入力値は valibot により検証します。
 */
export class Omnio {
  readonly #checksum: OmnioChecksum;

  readonly #entity: IOmnioEntity;

  readonly #index: IObjectIndex;

  readonly #embedder: IEmbedder;

  readonly #keyLocks = new Asyncmux({ preventReentrancy: true });

  readonly #deletions = new BackgroundTaskManager();

  #closingCount = 0;

  #entityOpen: boolean;

  #indexOpen: boolean;

  #lifecycle: AbortController;

  #opened: boolean;

  readonly #reindex = new BackgroundTaskManager();

  /**
   * @param options データベースと埋め込み、ストレージーです。すべて必須です。
   */
  public constructor(options: OmnioOptions) {
    const parsed = v.parse(OmnioOptionsSchema, options);
    const checksum = new OmnioChecksum();
    this.#checksum = checksum;
    this.#entity = v.parse(
      IOmnioEntitySchema,
      parsed.entity.build({
        beforeAll: [checksum],
      }),
    );
    this.#index = parsed.index;
    this.#embedder = parsed.embedder;

    this.#lifecycle = new AbortController();
    this.#entityOpen = false;
    this.#indexOpen = false;
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

    try {
      if (!this.#entityOpen) {
        await this.#entity.open({ signal: active });
        this.#entityOpen = true;
      }

      if (!this.#indexOpen || !this.#index.isOpen) {
        await this.#index.open({
          action: "open",
          signal: active,
        });
        this.#indexOpen = true;
        await this.#index.markDirty({
          action: "markDirty",
          signal: active,
          embeddingDims: this.#embedder.info.dims,
          embeddingModel: this.#embedder.info.name,
        });
      }
    } catch (ex) {
      if (this.#indexOpen) {
        try {
          await Promise.resolve().then(() =>
            this.#index.close({
              action: "close",
              signal: AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS),
            }),
          );
          this.#indexOpen = this.#index.isOpen;
        } catch {
          this.#indexOpen = true;
        }
      }

      if (this.#entityOpen) {
        try {
          await Promise.resolve().then(() =>
            this.#entity.close({ signal: AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS) }),
          );
          this.#entityOpen = false;
        } catch {
          this.#entityOpen = true;
        }
      }

      this.#opened = false;

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

    this.#closingCount++;

    try {
      if (this.#indexOpen || this.#entityOpen) {
        this.#lifecycle.abort(new OperationAbortedError());
      }

      if (this.#reindex.isRunning) {
        await waitForAbortable(this.#reindex.wait(), active);
      }

      for (;;) {
        while (this.#deletions.isRunning) {
          await waitForAbortable(this.#deletions.wait(), active);
        }

        using _lock = await asyncmux(this, active);

        if (this.#deletions.isRunning) {
          continue;
        }

        if (!this.#indexOpen && !this.#entityOpen) {
          return;
        }

        active.throwIfAborted();

        let failed = false;
        let firstError: unknown;

        if (this.#indexOpen) {
          try {
            await this.#index.close({
              action: "close",
              signal: active,
            });
            this.#indexOpen = false;
          } catch (ex) {
            failed = true;
            firstError = ex;
            this.#indexOpen = this.#index.isOpen;
          }
        }

        if (this.#entityOpen) {
          try {
            await this.#entity.close({ signal: active });
            this.#entityOpen = false;
          } catch (ex) {
            if (!failed) {
              failed = true;
              firstError = ex;
            }
          }
        }

        this.#opened = this.#indexOpen && this.#entityOpen;

        if (failed) {
          throw firstError;
        }

        return;
      }
    } finally {
      this.#closingCount--;

      if (
        this.#closingCount === 0 &&
        (this.#indexOpen || this.#entityOpen || this.#lifecycle.signal.aborted)
      ) {
        this.#lifecycle = new AbortController();
      }
    }
  }

  /**
   * オブジェクトを保存します。
   *
   * 上書き時も既存の実体 ID は再利用せず、新しい実体として保存します。
   * これにより、保存済みの実体のバイト列は不変になります。
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
    const bytes = await toBytes(parsed.data, active);
    let embedding: Float32Array | undefined;
    let embeddingModel: string | undefined;
    let embeddingSource: EmbedSource | undefined;

    active.throwIfAborted();

    if (parsed.embedding !== undefined) {
      embedding = parsed.embedding;
    } else if ((parsed.embed ?? true) && parsed.description !== undefined) {
      const embedded = await this.#embedDescription(parsed.description, active);
      embedding = embedded.embedding;
      embeddingModel = embedded.embeddingModel;
      embeddingSource = embedded.embeddingSource;
    }

    using _keyLock = await this.#lockKeys(active, [key]);

    const existing = await this.#index.get<TUserMetadata>({
      key,
      action: "get",
      signal: active,
    });
    const now = new Date().toISOString();
    // 実体は不変であるため、上書きでも既存の entityId を再利用しません。
    const entityId = crypto.randomUUID();

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

      if (existing !== null && existing.entityId !== entityId) {
        this.#enqueueDiscardedEntity(key, existing.entityId);
      }

      return object;
    } catch (ex) {
      await this.#deleteUnreferencedEntity(
        key,
        entityId,
        AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS),
      ).catch(() => undefined);
      throw ex;
    }
  }

  /**
   * オブジェクトを複製します。
   *
   * 実体のバイト列とメタデータを複製先へコピーします。
   * 複製先が既に存在する場合は上書きし、複製先の作成時刻を引き継ぎます。
   * 実体は不変であるため、複製先の実体 ID は書き込みごとに新しく発行します。
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
    using _keys = await this.#lockKeys(active, [sourceObjectKey, destinationObjectKey]);

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

    const existing = await this.#index.get<TUserMetadata>({
      key: destinationObjectKey,
      action: "get",
      signal: active,
    });
    const now = new Date().toISOString();
    // 実体は不変であるため、上書きでも複製先の entityId を再利用しません。
    const entityId = crypto.randomUUID();
    let copied = false;

    try {
      await this.#entity.copy(source.entityId, entityId, { signal: active });
      copied = true;

      const object: OmnioObject<TUserMetadata> = {
        key: destinationObjectKey,
        hash: source.hash,
        size: source.size,
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

      if (existing !== null && existing.entityId !== entityId) {
        this.#enqueueDiscardedEntity(destinationObjectKey, existing.entityId);
      }

      return object;
    } catch (ex) {
      if (!copied && ex instanceof KeyNotFoundError) {
        return null;
      }

      await this.#deleteUnreferencedEntity(
        destinationObjectKey,
        entityId,
        AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS),
      ).catch(() => undefined);
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
    using _keys = await this.#lockKeys(active, [sourceObjectKey, destinationObjectKey]);

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
      this.#enqueueDiscardedEntity(destinationObjectKey, replacedEntityId);
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

    using _keyLock = await this.#lockKeys(active, [key]);

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
   * インデックスの `hashAlgorithm` が `sha256` の場合、返却前に実体のチェックサムを検証します。
   * 検証に失敗した場合は `ChecksumMismatchError` を投げます。
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

    return await this.#readEntityBytes(object.entityId, active, object.hash, object.hashAlgorithm);
  }

  /**
   * 実体をストリームで取得します。
   *
   * インデックスの `hashAlgorithm` が `sha256` の場合、ストリームの終端でチェックサムを検証します。
   * 検証に失敗した場合は `ChecksumMismatchError` を投げます。
   * ストリームの性質上、検証はデータの一部が消費された後になります。
   * 途中でキャンセルしたり、最後まで読み取らなかった場合は検証されません。
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

    return await nullIfKeyNotFound(() =>
      this.#entity.stream(object.entityId, {
        vars: checksumVars(object.hash, object.hashAlgorithm),
        signal: active,
      }),
    );
  }

  /**
   * メタデータを取得します。
   *
   * `select` で取得する項目を選択できます。省略時はすべての項目を取得します。
   *
   * @param key 取得するキーです。
   * @param signal 処理を中断するための中断シグナルです。close 時に中断されるシグナルと合成され、先に中断された方に従います。
   *
   * @returns メタデータ、存在しない場合は null です。
   */
  public async headObject<TUserMetadata = Record<string, unknown>>(
    key: OmnioKey | string,
    signal?: AbortSignal,
  ): Promise<OmnioObject<TUserMetadata> | null>;
  /**
   * メタデータを取得します。
   *
   * @param key 取得するキーです。
   * @param options 取得する項目と中断シグナルです。
   *
   * @returns 選択したメタデータ、存在しない場合は null です。
   */
  public async headObject<
    TUserMetadata = Record<string, unknown>,
    const TSelect extends HeadObjectSelect = HeadObjectSelectAll,
  >(
    key: OmnioKey | string,
    options: HeadObjectOptions<TSelect>,
  ): Promise<Pick<OmnioObject<TUserMetadata>, SelectedHeadObjectField<TSelect>> | null>;
  public async headObject<TUserMetadata = Record<string, unknown>>(
    key: OmnioKey | string,
    optionsOrSignal?: AbortSignal | HeadObjectOptions,
  ): Promise<Partial<OmnioObject<TUserMetadata>> | null> {
    this.#requireOpen("headObject");

    const objectKey = toOmnioKey(v.parse(OmnioKeySchema, key));
    const options =
      optionsOrSignal instanceof AbortSignal ? { signal: optionsOrSignal } : optionsOrSignal;
    const parsed = v.parse(HeadObjectOptionsSchema, options ?? {});
    const selectedFields =
      parsed.select === undefined
        ? undefined
        : Object.entries(parsed.select)
            .filter(([, enabled]) => enabled === true)
            .map(([field]) => field as HeadObjectField);
    const active = this.#activeSignal(parsed.signal);
    active.throwIfAborted();

    using _lock = await asyncmux.readonly(this, active);

    const object = await this.#index.get<TUserMetadata>({
      key: objectKey,
      action: "get",
      signal: active,
    });

    if (object === null || selectedFields === undefined) {
      return object;
    }

    return selectFields(object, selectedFields);
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
    using _keyLock = await this.#lockKeys(active, [objectKey]);

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
    using _keyLock = await this.#lockKeys(active, [objectKey]);

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
   * 呼び出し側はキー付き排他ロックを保持し、最新のオブジェクトを渡してください。
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

    signal.throwIfAborted();

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
   * dirty フラグが立ったオブジェクトをキー順に少数ずつ再インデックスします。
   *
   * ページ内に失敗があっても次のページへ進み、後ろのキーが永久に取り残されないようにします。
   * 失敗した行は dirty のまま残し、次の走査や次の open で再試行します。
   * 古いスナップショットだけの走査は、上限付きで 1 回だけ先頭から追加の走査をします。
   */
  async #drainDirtyObjects(): Promise<void> {
    let staleRetries = 0;

    for (;;) {
      let applied = 0;
      let afterKey: string | undefined;
      let scanned = false;
      const seenAnchors = new Set<string>();
      let stale = 0;

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
          limit: DIRTY_BATCH_SIZE,
          action: "listDirty",
          signal,
          afterKey,
        });

        if (dirty.length === 0) {
          break;
        }

        const nextAfterKey = dirty.at(-1)?.key.key;

        // インデックスが afterKey を無視した場合に同じページを繰り返さないようにします。
        // キーの順序はデータベースの照合順序に依存するため、JS の大小比較は使いません。
        if (nextAfterKey === undefined || seenAnchors.has(nextAfterKey)) {
          break;
        }

        seenAnchors.add(nextAfterKey);
        scanned = true;
        afterKey = nextAfterKey;

        for (const snapshot of dirty) {
          const itemSignal = AbortSignal.any([
            this.#lifecycle.signal,
            AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS),
          ]);

          try {
            const outcome = await this.#reindexDirtyObject(snapshot, itemSignal);

            if (outcome === "applied") {
              applied++;
            } else if (outcome === "stale") {
              stale++;
            }
          } catch (ex) {
            if (this.#lifecycle.signal.aborted) {
              throw ex;
            }

            // 失敗した行は dirty のまま残し、後続のオブジェクトの処理を続けます。
            // 1 件のタイムアウトでは走査全体を止めません。
          }
        }

        if (dirty.length < DIRTY_BATCH_SIZE) {
          break;
        }
      }

      if (!scanned) {
        return;
      }

      if (applied > 0) {
        staleRetries = 0;

        continue;
      }

      if (stale > 0 && staleRetries < DIRTY_STALE_RETRY_LIMIT) {
        staleRetries++;

        continue;
      }

      return;
    }
  }

  /**
   * dirty のスナップショットから埋め込みを作り、現在のオブジェクトにだけ反映します。
   *
   * 埋め込みの計算中にオブジェクトが更新または削除された場合は、古いスナップショットを書き戻さずに諦めます。
   * 説明文が変わっていなければ、更新時刻だけが変わったメタデータ更新には追随します。
   * 明示的な埋め込みや埋め込みなしへ変更された場合も、作り直しで上書きしません。
   *
   * @param snapshot 走査時に取得したオブジェクトです。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns 反映した場合は `applied`、古いスナップショットだった場合は `stale`、失敗した場合は `failed` です。
   */
  async #reindexDirtyObject<TUserMetadata>(
    snapshot: OmnioObject<TUserMetadata>,
    signal: AbortSignal,
  ): Promise<ReindexOutcome> {
    if (snapshot.description === undefined) {
      return "stale";
    }

    try {
      const embedded = await this.#embedDescription(snapshot.description, signal);

      signal.throwIfAborted();

      using _keyLock = await this.#lockKeys(signal, [snapshot.key]);

      const current = await this.#index.get<TUserMetadata>({
        key: snapshot.key,
        action: "get",
        signal,
      });

      if (
        current === null ||
        current.entityId !== snapshot.entityId ||
        current.description !== snapshot.description ||
        current.embeddingModel !== snapshot.embeddingModel
      ) {
        return "stale";
      }

      const reindexed: OmnioObject<TUserMetadata> = {
        ...current,
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

      return "applied";
    } catch (ex) {
      if (this.#lifecycle.signal.aborted) {
        throw ex;
      }

      return "failed";
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
   * 指定したキーの排他ロックを取得します。
   *
   * キーは重複を除いて昇順に並べ、複数キーの操作でもデッドロックしないようにします。
   *
   * @param signal 処理を中断するための中断シグナルです。
   * @param keys 取得するキーです。
   *
   * @returns 解放用のハンドルです。`using` でスコープを抜けると解放されます。
   */
  async #lockKeys(signal: AbortSignal, keys: readonly OmnioKey[]): Promise<KeyLockHandle> {
    const names = [...new Set(keys.map((key) => key.key))].sort();
    const locks: AsyncmuxLock[] = [];

    try {
      for (const key of names) {
        const lock = await this.#keyLocks.lock({
          key,
          signal,
        });
        locks.push(lock);
      }
    } catch (ex) {
      for (let index = locks.length - 1; index >= 0; index--) {
        locks[index]?.release();
      }

      throw ex;
    }

    return {
      [Symbol.dispose](): void {
        for (let index = locks.length - 1; index >= 0; index--) {
          locks[index]?.release();
        }
      },
    };
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
   * キー変更で置き換えられた実体の削除を予約します。
   *
   * 置き換えられたレコードは索引から削除され、削除フラグ付きレコードを持ちません。
   * そのため、同じキーが現在も同じ実体を参照していないことを確認してから実体だけを削除します。
   *
   * @param key 置き換えられたオブジェクトのキーです。
   * @param entityId 削除する実体 ID です。
   */
  #enqueueDiscardedEntity(key: OmnioKey, entityId: string): void {
    this.#deletions.schedule(entityId, async () => {
      const signal = AbortSignal.timeout(DEFAULT_LIFECYCLE_TIMEOUT_MS);
      using _lock = await asyncmux.readonly(this, signal);

      if (!this.#opened) {
        return;
      }

      await this.#discardEntity(key, entityId, signal);
    });
  }

  /**
   * 索引から参照されなくなった実体を削除します。
   *
   * 呼び出し側はキー付き排他ロックを保持してください。
   *
   * @param key 実体を参照していたキーです。
   * @param entityId 削除する実体 ID です。
   * @param signal 処理を中断するための中断シグナルです。
   */
  async #deleteUnreferencedEntity(
    key: OmnioKey,
    entityId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const current = await this.#index.get<unknown>({
      key,
      action: "get",
      signal,
    });

    if (current !== null && current.entityId === entityId) {
      return;
    }

    const hasEntity = await this.#entity.has(entityId, { signal });

    if (hasEntity) {
      await this.#entity.delete(entityId, { signal });
    }
  }

  /**
   * キー変更で置き換えられた実体を削除します。
   *
   * @param key 実体を参照していたキーです。
   * @param entityId 削除する実体 ID です。
   * @param signal 処理を中断するための中断シグナルです。
   */
  async #discardEntity(key: OmnioKey, entityId: string, signal: AbortSignal): Promise<void> {
    using _keyLock = await this.#lockKeys(signal, [key]);

    await this.#deleteUnreferencedEntity(key, entityId, signal);
  }

  /**
   * オブジェクトの実体を削除し、ObjectIndex の削除フラグ付きレコードを物理削除します。
   *
   * @param key 削除するオブジェクトのキーです。
   * @param entityId 削除する実体 ID です。
   * @param signal 処理を中断するための中断シグナルです。
   */
  async #purgeEntity(key: OmnioKey, entityId: string, signal: AbortSignal): Promise<void> {
    using _keyLock = await this.#lockKeys(signal, [key]);

    const purged = await this.#index.purge({
      key,
      action: "purge",
      signal,
      entityId,
    });

    if (!purged) {
      await this.#deleteUnreferencedEntity(key, entityId, signal);

      return;
    }

    const hasEntity = await this.#entity.has(entityId, { signal });

    if (hasEntity) {
      await this.#entity.delete(entityId, { signal });
    }
  }

  /**
   * 実体のバイト列を取得します。
   *
   * インデックスに保存されたハッシュがある場合は、実体ストレージーのチェックサム検証に使います。
   *
   * @param entityId 取得する実体 ID です。
   * @param signal 処理を中断するための中断シグナルです。
   * @param hash インデックスに保存されたハッシュ値です。
   * @param hashAlgorithm ハッシュアルゴリズムの識別子です。
   *
   * @returns バイト列、存在しない場合は null です。
   */
  async #readEntityBytes(
    entityId: string,
    signal: AbortSignal,
    hash?: string,
    hashAlgorithm?: string,
  ): Promise<Uint8Array | null> {
    return nullIfKeyNotFound(() =>
      this.#entity.get(entityId, {
        vars: checksumVars(hash, hashAlgorithm),
        signal,
      }),
    );
  }

  /**
   * 実体を保存し、チェックサムを返します。
   *
   * チェックサムはビルド時に先頭へ挿入した `ChecksumSha256` が計算します。
   * 実体ビルダーに別の `ChecksumSha256` が含まれていても、`Omnio` が挿入したインスタンスの結果だけを使います。
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
    const checksum = this.#checksum;

    function onHash(this: Checksum, _context: Parameters<ChecksumOnHash>[0], value: string): void {
      if (this === checksum) {
        hash ??= value;
      }
    }

    await this.#entity.set(entityId, bytes, {
      vars: {
        [OmnioChecksum.CHECKSUM_ON_HASH_VAR_NAME]: onHash,
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
