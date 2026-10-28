// oxlint-disable import/no-namespace
import {
  type EmbedSource,
  type OmnioObject,
  type IObjectIndex,
  type IndexedObject,
  OmnioKey,
  DbQueryError,
  DbNotOpenError,
  VectorDimensionMismatchError,
} from "@omniojs/core";
import { asyncmux } from "asyncmux";
import type { Kysely } from "kysely";
import { type MigrationProvider, Migrator } from "kysely/migration";

import { type FullTextOperator, parseCursor, withMetadataFilter } from "./filter.js";
import { parseJson, stringifyJson } from "./json.js";
import type { SqlObjectRow, SqlIndexDatabase } from "./schema.js";
import {
  parseVector,
  scoreVector,
  formatVector,
  decodeEmbedding,
  encodeEmbedding,
  decodeEmbeddingInto,
} from "./vector.js";

/**
 * 検索で得られたキーとスコアの組です。
 */
export type ScoredObjectKey = {
  /** オブジェクトを一意に識別するキーです。 */
  readonly key: string;

  /** クエリーとの類似度です。 */
  readonly score: number;
};

/**
 * SQL インデックスのデータベース接続です。
 */
export type SqlIndexBackend = {
  /** kysely のインスタンスです。 */
  readonly kysely: Kysely<SqlIndexDatabase>;

  /**
   * データベース接続を破棄します。
   *
   * マイグレーションに失敗した場合の後始末にも使うため、失敗しても例外を投げないようにしてください。
   *
   * @returns 破棄処理の完了を示す Promise です。
   */
  dispose(): Promise<void>;
};

/**
 * SQL データベースによる `IObjectIndex` の共通実装です。
 *
 * メタデータ検索は kysely で組み立てた SQL で行います。
 * ベクトル検索は、派生クラスがデータベースネイティブの検索を提供しない場合は JavaScript で総当たり計算します。
 * データベースごとの接続方法とマイグレーションは派生クラスが用意します。
 *
 * すべての非同期メソッドは `asyncmux` によりインスタンス単位で排他します。
 * データの整合性のためではなく、`open` や `close` などのライフサイクルと操作が同時実行されないためです。
 */
export abstract class SqlObjectIndex implements IObjectIndex {
  /**
   * 全文検索で使う比較演算子です。
   *
   * SQLite は `LIKE`、PostgreSQL は `ILIKE` を使います。
   */
  protected abstract readonly fullTextOperator: FullTextOperator;

  /**
   * 埋め込みベクトルの保存形式です。
   *
   * PostgreSQL と PGlite は pgvector の `vector` 型を、それ以外はリトルエンディアンのバイト列を使います。
   */
  protected readonly embeddingFormat: "binary" | "pgvector" = "binary";

  #kysely: Kysely<SqlIndexDatabase> | undefined;

  /**
   * インデックスが現在開いているかを示します。
   */
  public get isOpen(): boolean {
    return this.#kysely !== undefined;
  }

  /**
   * インデックスを開き、マイグレーションを適用します。
   *
   * @param c 開く操作のコンテキストです。
   */
  public async open(c: IObjectIndex.OpenContext): Promise<void> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    if (this.#kysely !== undefined) {
      return;
    }

    const backend = await this.#createBackend();

    try {
      await this.#migrate(backend.kysely);
    } catch (ex) {
      await backend.dispose().catch(() => undefined);
      throw ex;
    }

    this.#kysely = backend.kysely;
  }

  /**
   * インデックスを閉じます。
   *
   * @param c 閉じる操作のコンテキストです。
   */
  public async close(c: IObjectIndex.CloseContext): Promise<void> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#kysely;

    this.#kysely = undefined;

    if (kysely !== undefined) {
      await kysely.destroy();
    }
  }

  /**
   * オブジェクトを保存します。
   *
   * @param c 保存する操作のコンテキストです。
   */
  public async upsert<TUserMetadata>(c: IObjectIndex.UpsertContext<TUserMetadata>): Promise<void> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("upsert");
    const object = c.object;
    const vector = object.embedding;
    let embedding: Uint8Array<ArrayBuffer> | string | null = null;
    let embeddingDims: number | null = null;
    let embeddingModel: string | null = null;
    let embeddingSource: string | null = null;

    if (vector !== undefined) {
      if (object.embeddingDims !== undefined && object.embeddingDims !== vector.length) {
        throw new VectorDimensionMismatchError({
          actual: vector.length,
          expected: object.embeddingDims,
        });
      }

      embedding =
        this.embeddingFormat === "pgvector" ? formatVector(vector) : encodeEmbedding(vector);
      embeddingDims = vector.length;
      embeddingModel = object.embeddingModel ?? null;

      if (object.embeddingSource !== undefined) {
        embeddingSource = stringifyJson(object.embeddingSource, "upsert");
      }
    }

    const key = object.key.key;
    const tags = [...new Set(object.tags)];
    await kysely.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom("journal")
        .select(["key", "record_type"])
        .where("key", "=", key)
        .executeTakeFirst();
      // S3 Metadata のジャーナルに合わせ、新規と削除済みからの復元は CREATE、既存の更新は UPDATE_METADATA とします。
      const recordType =
        existing === undefined || existing.record_type === "DELETE" ? "CREATE" : "UPDATE_METADATA";
      const row: SqlObjectRow = {
        key,
        hash: object.system.hash ?? null,
        size: this.toStoredSize(object.system.size),
        dirty: 0,
        embedding,
        entity_id: object.entityId,
        created_at: object.system.createdAt,
        updated_at: object.system.updatedAt,
        description: object.description ?? null,
        record_type: recordType,
        content_type: object.system.contentType,
        user_metadata: stringifyJson(object.userMetadata, "upsert"),
        embedding_dims: embeddingDims,
        hash_algorithm: object.system.hashAlgorithm ?? null,
        embedding_model: embeddingModel,
        embedding_source: embeddingSource,
        record_timestamp: object.system.updatedAt,
      };
      await transaction
        .insertInto("journal")
        .values(row)
        .onConflict((conflict) =>
          conflict.column("key").doUpdateSet({
            hash: row.hash,
            size: row.size,
            dirty: 0,
            embedding: row.embedding,
            entity_id: row.entity_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            description: row.description,
            record_type: row.record_type,
            content_type: row.content_type,
            user_metadata: row.user_metadata,
            embedding_dims: row.embedding_dims,
            hash_algorithm: row.hash_algorithm,
            embedding_model: row.embedding_model,
            embedding_source: row.embedding_source,
            record_timestamp: row.record_timestamp,
          }),
        )
        .execute();

      await transaction.deleteFrom("object_tag").where("key", "=", key).execute();

      if (tags.length > 0) {
        await transaction
          .insertInto("object_tag")
          .values(
            tags.map((tag) => ({
              key,
              tag,
            })),
          )
          .execute();
      }
    });
  }

  /**
   * オブジェクトの変更可能なメタデータだけを更新します。
   *
   * @param c メタデータを更新する操作のコンテキストです。
   *
   * @returns 更新したオブジェクト、存在しない場合は null です。
   */
  public async updateMetadata<TUserMetadata>(
    c: IObjectIndex.UpdateMetadataContext<TUserMetadata>,
  ): Promise<OmnioObject<TUserMetadata> | null> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("updateMetadata");
    const updated = await kysely.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom("journal")
        .select(["content_type", "description", "user_metadata"])
        .where("key", "=", c.key.key)
        .where("record_type", "!=", "DELETE")
        .executeTakeFirst();

      if (existing === undefined) {
        return false;
      }

      const contentType = c.metadata.contentType ?? existing.content_type;
      const description = c.metadata.description ?? existing.description;
      const userMetadata =
        c.metadata.userMetadata === undefined
          ? existing.user_metadata
          : stringifyJson(c.metadata.userMetadata, "updateMetadata");
      await transaction
        .updateTable("journal")
        .set({
          updated_at: c.metadata.updatedAt,
          description,
          record_type: "UPDATE_METADATA",
          content_type: contentType,
          user_metadata: userMetadata,
          record_timestamp: c.metadata.updatedAt,
        })
        .where("key", "=", c.key.key)
        .where("record_type", "!=", "DELETE")
        .execute();

      if (c.metadata.tags !== undefined) {
        const tags = [...new Set(c.metadata.tags)];

        await transaction.deleteFrom("object_tag").where("key", "=", c.key.key).execute();

        if (tags.length > 0) {
          await transaction
            .insertInto("object_tag")
            .values(
              tags.map((tag) => ({
                key: c.key.key,
                tag,
              })),
            )
            .execute();
        }
      }

      return true;
    });

    if (!updated) {
      return null;
    }

    const row = await kysely
      .selectFrom("journal")
      .selectAll()
      .where("key", "=", c.key.key)
      .where("record_type", "!=", "DELETE")
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    const tags = await this.#loadTags(kysely, [row.key]);

    return this.#toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "updateMetadata");
  }

  /**
   * オブジェクトのキーを変更します。
   *
   * @param c キーを変更する操作のコンテキストです。
   *
   * @returns キーを変更したオブジェクト、変更元が存在しない場合は null です。
   */
  public async rename<TUserMetadata>(
    c: IObjectIndex.RenameContext,
  ): Promise<IObjectIndex.RenameResult<TUserMetadata> | null> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("rename");

    return await kysely.transaction().execute(async (transaction) => {
      const sourceRow = await transaction
        .selectFrom("journal")
        .selectAll()
        .where("key", "=", c.sourceKey.key)
        .where("record_type", "!=", "DELETE")
        .executeTakeFirst();

      if (sourceRow === undefined) {
        return null;
      }

      const tagRows = await transaction
        .selectFrom("object_tag")
        .select("tag")
        .where("key", "=", c.sourceKey.key)
        .orderBy("tag")
        .execute();
      const tags = tagRows.map((row) => row.tag);

      if (c.sourceKey.key === c.destinationKey.key) {
        return {
          object: this.#toObject<TUserMetadata>(sourceRow, tags, "rename"),
        };
      }

      const destinationRow = await transaction
        .selectFrom("journal")
        .select(["key", "entity_id"])
        .where("key", "=", c.destinationKey.key)
        .executeTakeFirst();
      const renamedRow: SqlObjectRow = {
        ...sourceRow,
        key: c.destinationKey.key,
        record_type: "UPDATE_METADATA",
        record_timestamp: c.updatedAt,
        updated_at: c.updatedAt,
      };

      if (destinationRow !== undefined) {
        await transaction.deleteFrom("journal").where("key", "=", c.destinationKey.key).execute();
      }

      await transaction.deleteFrom("journal").where("key", "=", c.sourceKey.key).execute();
      await transaction.insertInto("journal").values(renamedRow).execute();

      if (tags.length > 0) {
        await transaction
          .insertInto("object_tag")
          .values(
            tags.map((tag) => ({
              key: c.destinationKey.key,
              tag,
            })),
          )
          .execute();
      }

      return {
        object: this.#toObject<TUserMetadata>(renamedRow, tags, "rename"),
        replacedEntityId: destinationRow?.entity_id,
      };
    });
  }

  /**
   * オブジェクトを取得します。
   *
   * @param c 取得する操作のコンテキストです。
   *
   * @returns 取得したオブジェクト、存在しない場合は null です。
   */
  public async get<TUserMetadata>(
    c: IObjectIndex.GetContext,
  ): Promise<OmnioObject<TUserMetadata> | null> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("get");
    const row = await kysely
      .selectFrom("journal")
      .selectAll()
      .where("key", "=", c.key.key)
      .where("record_type", "!=", "DELETE")
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    const tags = await this.#loadTags(kysely, [row.key]);

    return this.#toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "get");
  }

  /**
   * オブジェクトのメタデータが存在するかを確認します。
   *
   * @param c 存在確認する操作のコンテキストです。
   *
   * @returns 存在する場合は true、存在しない場合は false です。
   */
  public async has(c: IObjectIndex.HasContext): Promise<boolean> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("has");
    const row = await kysely
      .selectFrom("journal")
      .select("key")
      .where("key", "=", c.key.key)
      .where("record_type", "!=", "DELETE")
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * オブジェクトに削除フラグを立てます。
   *
   * @param c 削除する操作のコンテキストです。
   *
   * @returns 削除フラグを立てた場合は true、存在しなかった場合は false です。
   */
  public async delete(c: IObjectIndex.DeleteContext): Promise<boolean> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("delete");
    const recordTimestamp = new Date().toISOString();
    const updated = await kysely.transaction().execute(async (transaction) => {
      const result = await transaction
        .updateTable("journal")
        .set({
          hash: null,
          size: null,
          dirty: 0,
          embedding: null,
          created_at: null,
          updated_at: null,
          description: null,
          record_type: "DELETE",
          content_type: null,
          user_metadata: null,
          embedding_dims: null,
          hash_algorithm: null,
          embedding_model: null,
          embedding_source: null,
          record_timestamp: recordTimestamp,
        })
        .where("key", "=", c.key.key)
        .where("record_type", "!=", "DELETE")
        .executeTakeFirst();

      await transaction.deleteFrom("object_tag").where("key", "=", c.key.key).execute();

      return result.numUpdatedRows;
    });

    return typeof updated === "bigint" ? updated > 0n : updated > 0;
  }

  /**
   * 削除フラグが立ったオブジェクトを物理削除します。
   *
   * @param c 物理削除する操作のコンテキストです。
   *
   * @returns 物理削除した場合は true、対象が存在しなかった場合は false です。
   */
  public async purge(c: IObjectIndex.PurgeContext): Promise<boolean> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("purge");
    const result = await kysely
      .deleteFrom("journal")
      .where("key", "=", c.key.key)
      .where("entity_id", "=", c.entityId)
      .where("record_type", "=", "DELETE")
      .executeTakeFirst();
    const deleted = result.numDeletedRows;

    return typeof deleted === "bigint" ? deleted > 0n : (deleted ?? 0) > 0;
  }

  /**
   * オブジェクトを一覧します。
   *
   * @param c 一覧する操作のコンテキストです。
   *
   * @returns 一覧結果です。
   */
  public async list<TUserMetadata>(
    c: IObjectIndex.ListContext,
  ): Promise<IObjectIndex.ListResult<TUserMetadata>> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("list");
    const limit = c.limit ?? 100;

    if (limit <= 0) {
      return {
        items: [],
        nextCursor: null,
      };
    }

    const offset = parseCursor(c.cursor);
    const candidates = await withMetadataFilter(
      kysely.selectFrom("journal").selectAll(),
      c.filter,
      this.fullTextOperator,
    )
      .orderBy("key")
      .limit(limit + 1)
      .offset(offset)
      .execute();

    return await this.#toListResult<TUserMetadata>(kysely, candidates, limit, offset);
  }

  /**
   * 埋め込みモデルが変わったオブジェクトに dirty フラグを立てます。
   *
   * @param c dirty フラグを立てる操作のコンテキストです。
   *
   * @returns dirty フラグを立てた件数です。
   */
  public async markDirty(c: IObjectIndex.MarkDirtyContext): Promise<number> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("markDirty");
    const result = await kysely
      .updateTable("journal")
      .set({ dirty: 1 })
      .where("record_type", "!=", "DELETE")
      .where("description", "is not", null)
      .where("embedding_model", "is not", null)
      .where("embedding_model", "!=", c.embeddingModel)
      .executeTakeFirst();
    const updated = result.numUpdatedRows;

    return typeof updated === "bigint" ? Number(updated) : updated;
  }

  /**
   * dirty フラグが立ったオブジェクトを一覧します。
   *
   * @param c dirty フラグが立ったオブジェクトを一覧する操作のコンテキストです。
   *
   * @returns dirty フラグが立ったオブジェクト一覧です。
   */
  public async listDirty<TUserMetadata>(
    c: IObjectIndex.ListDirtyContext,
  ): Promise<OmnioObject<TUserMetadata>[]> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("listDirty");
    const limit = c.limit ?? 100;

    if (limit <= 0) {
      return [];
    }

    const rows = await kysely
      .selectFrom("journal")
      .selectAll()
      .where("dirty", "=", 1)
      .where("record_type", "!=", "DELETE")
      .where("description", "is not", null)
      .orderBy("key")
      .limit(limit)
      .execute();
    const tags = await this.#loadTags(
      kysely,
      rows.map((row) => row.key),
    );

    return rows.map((row) =>
      this.#toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "listDirty"),
    );
  }

  /**
   * ベクトル検索します。
   *
   * @param c 検索する操作のコンテキストです。
   *
   * @returns 類似度付きのオブジェクト一覧です。
   */
  public async search<TUserMetadata>(
    c: IObjectIndex.SearchContext,
  ): Promise<IndexedObject<TUserMetadata>[]> {
    c.signal.throwIfAborted();

    using _lock = await asyncmux(this, c.signal);

    const kysely = this.#requireOpen("search");

    if (c.topK <= 0 || c.vector.length === 0) {
      return [];
    }

    if (this.canSearchScoredKeys(c)) {
      return await this.#toSearchResults<TUserMetadata>(
        kysely,
        await this.searchScoredKeys(kysely, c),
      );
    }

    const candidates = withMetadataFilter(
      kysely
        .selectFrom("journal")
        .select(["key", "embedding", "embedding_dims", "embedding_model"]),
      c.filter,
      this.fullTextOperator,
    )
      .where("journal.dirty", "=", 0)
      .where("journal.embedding", "is not", null);
    const rows = await (
      c.embeddingModel === undefined
        ? candidates
        : candidates.where("journal.embedding_model", "=", c.embeddingModel)
    ).execute();
    const metric = c.metric ?? "cosine";
    const scored: (ScoredObjectKey & { row: (typeof rows)[number] })[] = [];
    // 行ごとにベクトルを確保すると GC が増えるため、検索中は作業用のベクトルを使い回します。
    const scratch = new Float32Array(c.vector.length);

    for (const row of rows) {
      const stored = row.embedding;

      if (stored === null) {
        continue;
      }

      if (c.embeddingModel !== undefined && row.embedding_model !== c.embeddingModel) {
        continue;
      }

      let vector: Float32Array;

      if (typeof stored === "string") {
        vector = parseVector(stored);
      } else {
        const length = stored.byteLength / 4;

        if (!Number.isInteger(length)) {
          // 不正なバイト長は、通常の復号と同じエラーにします。
          decodeEmbedding(stored);

          continue;
        }

        if (row.embedding_dims !== null && row.embedding_dims !== length) {
          throw new VectorDimensionMismatchError({
            actual: length,
            expected: row.embedding_dims,
          });
        }

        if (length !== c.vector.length) {
          continue;
        }

        decodeEmbeddingInto(stored, scratch);
        vector = scratch;
      }

      if (row.embedding_dims !== null && row.embedding_dims !== vector.length) {
        throw new VectorDimensionMismatchError({
          actual: vector.length,
          expected: row.embedding_dims,
        });
      }

      if (vector.length !== c.vector.length) {
        continue;
      }

      const score = scoreVector(metric, c.vector, vector);

      if (c.minScore !== undefined && score < c.minScore) {
        continue;
      }

      scored.push({
        key: row.key,
        row,
        score,
      });
    }

    scored.sort((left, right) => right.score - left.score);

    return await this.#toSearchResults<TUserMetadata>(
      kysely,
      scored.slice(0, c.topK).map(({ key, score }) => ({
        key,
        score,
      })),
    );
  }

  /**
   * データベースネイティブのベクトル検索を使えるかを確認します。
   *
   * @param _c 検索する操作のコンテキストです。
   *
   * @returns ネイティブ検索を使う場合は true です。
   */
  protected canSearchScoredKeys(_c: IObjectIndex.SearchContext): boolean {
    return false;
  }

  /**
   * データベースネイティブのベクトル検索を行います。
   *
   * @param _kysely kysely のインスタンスです。
   * @param _c 検索する操作のコンテキストです。
   *
   * @returns スコア付きのキー一覧です。
   */
  protected searchScoredKeys(
    _kysely: Kysely<SqlIndexDatabase>,
    _c: IObjectIndex.SearchContext,
  ): Promise<ScoredObjectKey[]> {
    return Promise.reject(new Error("Native vector search is not implemented"));
  }

  /**
   * データベース接続を生成します。
   *
   * @returns 生成したデータベース接続を解決する Promise です。
   */
  protected abstract createBackend(): Promise<SqlIndexBackend>;

  /**
   * マイグレーションの提供器を生成します。
   *
   * @returns マイグレーションの提供器です。
   */
  protected abstract createMigrationProvider(): MigrationProvider;

  /**
   * サイズをデータベースに保存する値に変換します。
   *
   * PostgreSQL の bigint は文字列で渡す必要があるため、派生クラスで上書きします。
   *
   * @param size バイト単位のサイズです。
   *
   * @returns データベースに保存する値です。
   */
  protected toStoredSize(size: number): number | string {
    return size;
  }

  /**
   * データベース接続を生成し、生成時の失敗を `DbQueryError` に変換します。
   *
   * @returns 生成したデータベース接続を解決する Promise です。
   */
  async #createBackend(): Promise<SqlIndexBackend> {
    try {
      return await this.createBackend();
    } catch (ex) {
      if (ex instanceof DbQueryError) {
        throw ex;
      }

      throw new DbQueryError({
        cause: ex,
        operation: "open",
      });
    }
  }

  /**
   * 最新のマイグレーションを適用します。
   *
   * @param kysely kysely のインスタンスです。
   */
  async #migrate(kysely: Kysely<SqlIndexDatabase>): Promise<void> {
    let migrationFailed = false;
    let migrationError: unknown;

    try {
      const { error, results } = await new Migrator({
        db: kysely,
        provider: this.createMigrationProvider(),
      }).migrateToLatest();
      migrationError = error;
      migrationFailed =
        error !== undefined || results?.some((result) => result.status === "Error") === true;
    } catch (ex) {
      // `undefined` を throw するマイグレーションでも失敗として扱います。
      migrationFailed = true;
      migrationError = ex;
    }

    if (migrationFailed) {
      throw new DbQueryError({
        cause: migrationError ?? new Error("Migration failed"),
        operation: "open",
      });
    }
  }

  /**
   * 開いている kysely インスタンスを返します。
   *
   * @param operation 実行中の操作名です。
   *
   * @returns kysely のインスタンスです。
   */
  #requireOpen(operation: string): Kysely<SqlIndexDatabase> {
    const kysely = this.#kysely;

    if (kysely === undefined) {
      throw new DbNotOpenError({ operation });
    }

    return kysely;
  }

  /**
   * 指定したキーのタグを読み取ります。
   *
   * @param kysely kysely のインスタンスです。
   * @param keys 読み取るキーの一覧です。
   *
   * @returns キーからタグ一覧への対応表です。
   */
  async #loadTags(
    kysely: Kysely<SqlIndexDatabase>,
    keys: readonly string[],
  ): Promise<Map<string, string[]>> {
    const tags = new Map<string, string[]>();

    if (keys.length === 0) {
      return tags;
    }

    const rows = await kysely
      .selectFrom("object_tag")
      .select(["key", "tag"])
      .where("key", "in", [...keys])
      .orderBy("key")
      .orderBy("tag")
      .execute();

    for (const row of rows) {
      const list = tags.get(row.key) ?? [];
      list.push(row.tag);
      tags.set(row.key, list);
    }

    return tags;
  }

  /**
   * 候補行を一覧結果に変換します。
   *
   * @param kysely kysely のインスタンスです。
   * @param candidates 現在位置以降の候補行です。
   * @param limit 取得する最大件数です。
   * @param offset 先頭からの件数です。
   *
   * @returns 一覧結果です。
   */
  async #toListResult<TUserMetadata>(
    kysely: Kysely<SqlIndexDatabase>,
    candidates: readonly SqlObjectRow[],
    limit: number,
    offset: number,
  ): Promise<IObjectIndex.ListResult<TUserMetadata>> {
    const page = candidates.slice(0, limit);
    const tags = await this.#loadTags(
      kysely,
      page.map((row) => row.key),
    );

    return {
      items: page.map((row) => this.#toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "list")),
      nextCursor: candidates.length > limit ? String(offset + page.length) : null,
    };
  }

  /**
   * スコア付きのキー一覧を検索結果に変換します。
   *
   * @param kysely kysely のインスタンスです。
   * @param scored スコア付きのキー一覧です。スコアの降順で並んでいる必要があります。
   *
   * @returns 類似度付きのオブジェクト一覧です。
   */
  async #toSearchResults<TUserMetadata>(
    kysely: Kysely<SqlIndexDatabase>,
    scored: readonly ScoredObjectKey[],
  ): Promise<IndexedObject<TUserMetadata>[]> {
    if (scored.length === 0) {
      return [];
    }

    const keys = scored.map(({ key }) => key);
    const fullRows = await kysely
      .selectFrom("journal")
      .selectAll()
      .where("key", "in", keys)
      .execute();
    const rowsByKey = new Map(fullRows.map((row) => [row.key, row]));
    const tags = await this.#loadTags(kysely, keys);

    return scored.map(({ key, score }) => {
      const full = rowsByKey.get(key);

      if (full === undefined) {
        throw new DbQueryError({
          cause: new Error("Search result row disappeared"),
          operation: "search",
        });
      }

      const vector = this.#decodeRowEmbedding(full);

      return {
        ...this.#toObject<TUserMetadata>(full, tags.get(full.key) ?? [], "search", vector),
        score,
      };
    });
  }

  /**
   * 行の埋め込みを復号し、次元数を検証します。
   *
   * @param row `journal` テーブルの行です。
   *
   * @returns 復号した埋め込みベクトル、埋め込みがない場合は undefined です。
   */
  #decodeRowEmbedding(row: SqlObjectRow): Float32Array | undefined {
    let embedding: Float32Array | undefined;

    if (row.embedding !== null) {
      embedding =
        typeof row.embedding === "string"
          ? parseVector(row.embedding)
          : decodeEmbedding(row.embedding);
    }

    if (
      embedding !== undefined &&
      row.embedding_dims !== null &&
      row.embedding_dims !== embedding.length
    ) {
      throw new VectorDimensionMismatchError({
        actual: embedding.length,
        expected: row.embedding_dims,
      });
    }

    return embedding;
  }

  /**
   * 行をオブジェクトに変換します。
   *
   * @param row `journal` テーブルの行です。
   * @param tags タグの一覧です。
   * @param operation 実行中の操作名です。
   * @param embedding 事前に復号した埋め込みベクトルです。省略時は行から復号します。
   *
   * @returns 変換したオブジェクトです。
   */
  #toObject<TUserMetadata>(
    row: SqlObjectRow,
    tags: readonly string[],
    operation: string,
    embedding?: Float32Array,
  ): OmnioObject<TUserMetadata> {
    const decoded = embedding ?? this.#decodeRowEmbedding(row);

    if (
      row.content_type === null ||
      row.size === null ||
      row.created_at === null ||
      row.updated_at === null ||
      row.user_metadata === null
    ) {
      throw new DbQueryError({
        cause: new Error("Active journal row has null data columns"),
        operation,
      });
    }

    return {
      key: OmnioKey.parse(row.key),
      tags: [...tags],
      system: {
        hash: row.hash ?? undefined,
        // node-postgres は bigint を文字列で返すため、数値に変換します。
        size: Number(row.size),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        contentType: row.content_type,
        hashAlgorithm: row.hash_algorithm ?? undefined,
      },
      entityId: row.entity_id,
      embedding: decoded,
      description: row.description ?? undefined,
      userMetadata: parseJson(row.user_metadata, operation) as TUserMetadata,
      embeddingDims: row.embedding_dims ?? undefined,
      embeddingModel: row.embedding_model ?? undefined,
      embeddingSource:
        row.embedding_source === null
          ? undefined
          : (parseJson(row.embedding_source, operation) as EmbedSource),
    };
  }
}
