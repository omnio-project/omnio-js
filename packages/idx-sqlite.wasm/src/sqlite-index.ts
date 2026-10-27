// oxlint-disable import/no-namespace
import {
  type EmbedSource,
  type OmnioObject,
  type IObjectIndex,
  type IndexedObject,
  type MetadataFilter,
  OmnioKey,
  DbQueryError,
  DbNotOpenError,
  VectorDimensionMismatchError,
} from "@omniojs/core";
import { asyncmux } from "asyncmux";
import { type SelectQueryBuilder, sql, Kysely } from "kysely";
import { Migrator } from "kysely/migration";
import * as v from "valibot";

import { type SqliteWasmHandle, initSqliteWasm, SqliteWasmDialect } from "./dialect.js";
import { SqliteWasmMigrationProvider } from "./migrations.js";
import type { ObjectRow, SqliteWasmDatabase } from "./schema.js";
import { scoreVector, decodeEmbedding, encodeEmbedding } from "./vector.js";

/**
 * `SqliteWasmIndex` のオプションです。
 */
export type SqliteWasmIndexOptions = {
  /** データベースの保存場所です。既定値はメモリーです。 */
  readonly location?: string | undefined;
};

/**
 * `SqliteWasmIndex` のコンストラクター引数を検証するスキーマです。
 */
const SqliteWasmIndexOptionsSchema = v.object({
  location: v.optional(v.pipe(v.string(), v.minLength(1))),
});

/**
 * JSON 文字列を読み取ります。
 *
 * @param text JSON 文字列です。
 * @param operation 実行中の操作名です。
 *
 * @returns 読み取った値です。
 */
function parseJson(text: string, operation: string): unknown {
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
function stringifyJson(value: unknown, operation: string): string {
  try {
    return JSON.stringify(value);
  } catch (ex) {
    throw new DbQueryError({
      cause: ex,
      operation,
    });
  }
}

/**
 * LIKE 検索用にパターンを escapes します。
 *
 * @param value escapes する文字列です。
 *
 * @returns escapes した文字列です。
 */
function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * 開いているデータベースハンドルを閉じます。
 *
 * Kysely の `destroy()` はドライバーの初期化に失敗していると接続を破棄しないため、後始末のフォールバックとして使います。
 *
 * @param handle 閉じるデータベースハンドルです。
 */
function closeHandle(handle: SqliteWasmHandle): void {
  if (!handle.isOpen()) {
    return;
  }

  try {
    handle.close();
  } catch {
    // 元のエラーを優先するため、後始末の失敗は無視します。
  }
}

/**
 * 非 null のオブジェクトかを確認します。
 *
 * @param value 確認する値です。
 *
 * @returns 非 null のオブジェクトの場合は true、そうでない場合は false です。
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 2 つの値が深く等しいかを確認します。
 *
 * @param left 比較する値です。
 * @param right 比較する値です。
 *
 * @returns 深く等しい場合は true、そうでない場合は false です。
 */
function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    );
  }

  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([name, value]) =>
        Object.hasOwn(right, name) && deepEqual(value, (right as Record<string, unknown>)[name]),
    )
  );
}

/**
 * 利用者メタデータが条件に一致するかを確認します。
 *
 * @param record レコードの利用者メタデータです。
 * @param filter 絞り込み条件の利用者メタデータです。
 *
 * @returns 一致する場合は true、そうでない場合は false です。
 */
function matchesUserMetadata(record: unknown, filter: unknown): boolean {
  if (filter === undefined) {
    return true;
  }

  if (!isObjectRecord(filter)) {
    return false;
  }

  if (Object.keys(filter).length === 0) {
    return true;
  }

  if (!isObjectRecord(record)) {
    return false;
  }

  return Object.entries(filter).every(([name, expected]) => deepEqual(record[name], expected));
}

/**
 * カーソルを offset に変換します。
 *
 * @param cursor 一覧の続きを示すカーソルです。
 *
 * @returns 先頭からの件数です。不正な値は 0 とします。
 */
function parseCursor(cursor: string | null | undefined): number {
  if (cursor === null || cursor === undefined || cursor === "") {
    return 0;
  }

  const offset = Number.parseInt(cursor, 10);

  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}

/**
 * メタデータの絞り込み条件を適用します。利用者メタデータは含みません。
 *
 * @param query 絞り込む前のクエリーです。
 * @param filter 絞り込み条件です。
 *
 * @returns 絞り込んだクエリーです。
 */
function withMetadataFilter(
  query: SelectQueryBuilder<SqliteWasmDatabase, "journal", ObjectRow>,
  filter: MetadataFilter | undefined,
): SelectQueryBuilder<SqliteWasmDatabase, "journal", ObjectRow> {
  let filtered = query.where("journal.record_type", "is not", "DELETE");

  if (filter?.contentTypes !== undefined && filter.contentTypes.length > 0) {
    filtered = filtered.where("journal.content_type", "in", [...filter.contentTypes]);
  }

  if (filter?.createdAfter !== undefined) {
    filtered = filtered.where("journal.created_at", ">=", filter.createdAfter);
  }

  if (filter?.createdBefore !== undefined) {
    filtered = filtered.where("journal.created_at", "<=", filter.createdBefore);
  }

  if (filter?.fullText !== undefined && filter.fullText !== "") {
    const pattern = `%${escapeLikePattern(filter.fullText)}%`;
    filtered = filtered.where(
      sql<boolean>`(coalesce(${sql.ref("description")}, '') || ' ' || ${sql.ref("key")}) LIKE ${pattern} ESCAPE '\\'`,
    );
  }

  if (filter?.tagsAll !== undefined && filter.tagsAll.length > 0) {
    const tags = [...new Set(filter.tagsAll)];
    filtered = filtered.where("journal.key", "in", (inner) =>
      inner
        .selectFrom("object_tag")
        .select("object_tag.key")
        .where("object_tag.tag", "in", tags)
        .groupBy("object_tag.key")
        .having(sql<boolean>`count(*) = ${tags.length}`),
    );
  }

  if (filter?.tagsAny !== undefined && filter.tagsAny.length > 0) {
    const tags = [...new Set(filter.tagsAny)];
    filtered = filtered.where("journal.key", "in", (inner) =>
      inner.selectFrom("object_tag").select("object_tag.key").where("object_tag.tag", "in", tags),
    );
  }

  return filtered;
}

/**
 * WASM 版 SQLite による `IObjectIndex` の実装です。
 *
 * メタデータ検索は kysely で組み立てた SQL で行い、ベクトル検索は JavaScript で総当たり計算します。
 *
 * すべての非同期メソッドは `asyncmux` によりインスタンス単位で排他します。
 * データの整合性のためではなく、`open` や `close` などのライフサイクルと操作が同時実行されないためです。
 */
export class SqliteWasmIndex implements IObjectIndex {
  #kysely: Kysely<SqliteWasmDatabase> | undefined;

  readonly #location: string;

  /**
   * @param options データベースの保存場所などの設定です。
   */
  public constructor(options: SqliteWasmIndexOptions = {}) {
    const parsed = v.parse(SqliteWasmIndexOptionsSchema, options);
    this.#location = parsed.location ?? ":memory:";
  }

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

    let sqlite3: Awaited<ReturnType<typeof initSqliteWasm>>;

    try {
      sqlite3 = await initSqliteWasm();
    } catch (ex) {
      throw new DbQueryError({
        cause: ex,
        operation: "open",
      });
    }

    let handle: SqliteWasmHandle;

    try {
      handle = new sqlite3.oo1.DB(this.#location, "c");
    } catch (ex) {
      throw new DbQueryError({
        cause: ex,
        operation: "open",
      });
    }

    const kysely = new Kysely<SqliteWasmDatabase>({ dialect: new SqliteWasmDialect(handle) });
    let migrationFailed = false;
    let migrationError: unknown;

    try {
      const { error, results } = await new Migrator({
        db: kysely,
        provider: new SqliteWasmMigrationProvider(),
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
      await kysely.destroy().catch(() => undefined);
      closeHandle(handle);
      throw new DbQueryError({
        cause: migrationError ?? new Error("Migration failed"),
        operation: "open",
      });
    }

    this.#kysely = kysely;
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
    let embedding: Uint8Array<ArrayBuffer> | null = null;
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

      embedding = encodeEmbedding(vector);
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
      const row = {
        key,
        hash: object.system.hash ?? null,
        size: object.system.size,
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
        .where("record_type", "is not", "DELETE")
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
        .where("record_type", "is not", "DELETE")
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
      .where("record_type", "is not", "DELETE")
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    const tags = await this.#loadTags(kysely, [row.key]);

    return this.#toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "updateMetadata");
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
      .where("record_type", "is not", "DELETE")
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
      .where("record_type", "is not", "DELETE")
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
        .where("record_type", "is not", "DELETE")
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
    const userMetadataFilter = c.filter?.userMetadata;

    if (userMetadataFilter !== undefined) {
      const matched = await withMetadataFilter(kysely.selectFrom("journal").selectAll(), c.filter)
        .orderBy("key")
        .execute();
      const candidates = matched
        .filter((row) =>
          matchesUserMetadata(parseJson(row.user_metadata ?? "null", "list"), userMetadataFilter),
        )
        .slice(offset);

      return await this.#toListResult<TUserMetadata>(kysely, candidates, limit, offset);
    }

    const candidates = await withMetadataFilter(kysely.selectFrom("journal").selectAll(), c.filter)
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
      .where("record_type", "is not", "DELETE")
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
      .where("record_type", "is not", "DELETE")
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

    const candidates = withMetadataFilter(kysely.selectFrom("journal").selectAll(), c.filter)
      .where("journal.dirty", "=", 0)
      .where("journal.embedding", "is not", null);
    const rows = await (
      c.embeddingModel === undefined
        ? candidates
        : candidates.where("journal.embedding_model", "=", c.embeddingModel)
    ).execute();
    const metric = c.metric ?? "cosine";
    const scored: {
      row: ObjectRow;
      score: number;
    }[] = [];

    for (const row of rows) {
      if (row.embedding === null) {
        continue;
      }

      if (c.embeddingModel !== undefined && row.embedding_model !== c.embeddingModel) {
        continue;
      }

      const vector = this.#decodeRowEmbedding(row);

      if (vector === undefined) {
        continue;
      }

      if (vector.length !== c.vector.length) {
        continue;
      }

      const score = scoreVector(metric, c.vector, vector);

      if (c.minScore !== undefined && score < c.minScore) {
        continue;
      }

      if (
        c.filter?.userMetadata !== undefined &&
        !matchesUserMetadata(
          parseJson(row.user_metadata ?? "null", "search"),
          c.filter.userMetadata,
        )
      ) {
        continue;
      }

      scored.push({
        row,
        score,
      });
    }

    scored.sort((left, right) => right.score - left.score);

    const top = scored.slice(0, c.topK);
    const tags = await this.#loadTags(
      kysely,
      top.map(({ row }) => row.key),
    );

    return top.map(({ row, score }) => {
      const vector = this.#decodeRowEmbedding(row);

      return {
        ...this.#toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "search", vector),
        score,
      };
    });
  }

  /**
   * 開いている kysely インスタンスを返します。
   *
   * @param operation 実行中の操作名です。
   *
   * @returns kysely のインスタンスです。
   */
  #requireOpen(operation: string): Kysely<SqliteWasmDatabase> {
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
    kysely: Kysely<SqliteWasmDatabase>,
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
    kysely: Kysely<SqliteWasmDatabase>,
    candidates: readonly ObjectRow[],
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
   * 行の埋め込みを復号し、次元数を検証します。
   *
   * @param row `journal` テーブルの行です。
   *
   * @returns 復号した埋め込みベクトル、埋め込みがない場合は undefined です。
   */
  #decodeRowEmbedding(row: ObjectRow): Float32Array | undefined {
    const embedding = row.embedding === null ? undefined : decodeEmbedding(row.embedding);

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
    row: ObjectRow,
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
        size: row.size,
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
