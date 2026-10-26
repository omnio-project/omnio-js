import {
  type EmbedSource,
  type OmnioObject,
  type IObjectIndex,
  type IndexedObject,
  type MetadataFilter,
  DbQueryError,
  DbNotOpenError,
  VectorDimensionMismatchError,
} from "@omniojs/core";
import { type SelectQueryBuilder, sql, Kysely } from "kysely";
import { Migrator } from "kysely/migration";

import { type SqliteWasmHandle, initSqliteWasm, SqliteWasmDialect } from "./dialect.js";
import { SqliteWasmMigrationProvider } from "./migrations.js";
import type { ObjectRow, SqliteWasmDatabase } from "./schema.js";
import { scoreVector, decodeEmbedding, encodeEmbedding } from "./vector.js";

/**
 * `SqliteWasmIndex` のオプションです。
 */
export interface SqliteWasmIndexOptions {
  /** データベースの保存場所です。既定値はメモリーです。 */
  readonly location?: string | undefined;
}

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
  } catch (error) {
    throw new DbQueryError({
      cause: error,
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
  } catch (error) {
    throw new DbQueryError({
      cause: error,
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
        name in right && deepEqual(value, (right as Record<string, unknown>)[name]),
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
function matchesUserMetadata(
  record: Record<string, unknown>,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (filter === undefined) {
    return true;
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
  query: SelectQueryBuilder<SqliteWasmDatabase, "objects", ObjectRow>,
  filter: MetadataFilter | undefined,
): SelectQueryBuilder<SqliteWasmDatabase, "objects", ObjectRow> {
  let filtered = query;

  if (filter?.contentTypes !== undefined && filter.contentTypes.length > 0) {
    filtered = filtered.where("objects.content_type", "in", [...filter.contentTypes]);
  }

  if (filter?.createdAfter !== undefined) {
    filtered = filtered.where("objects.created_at", ">=", filter.createdAfter);
  }

  if (filter?.createdBefore !== undefined) {
    filtered = filtered.where("objects.created_at", "<=", filter.createdBefore);
  }

  if (filter?.fullText !== undefined && filter.fullText !== "") {
    const pattern = `%${escapeLikePattern(filter.fullText)}%`;
    filtered = filtered.where(
      sql<boolean>`(coalesce(${sql.ref("description")}, '') || ' ' || ${sql.ref("key")}) LIKE ${pattern} ESCAPE '\\'`,
    );
  }

  if (filter?.tagsAll !== undefined && filter.tagsAll.length > 0) {
    const tags = [...new Set(filter.tagsAll)];
    filtered = filtered.where("objects.key", "in", (inner) =>
      inner
        .selectFrom("object_tags")
        .select("object_tags.key")
        .where("object_tags.tag", "in", tags)
        .groupBy("object_tags.key")
        .having(sql<boolean>`count(*) = ${tags.length}`),
    );
  }

  if (filter?.tagsAny !== undefined && filter.tagsAny.length > 0) {
    const tags = [...new Set(filter.tagsAny)];
    filtered = filtered.where("objects.key", "in", (inner) =>
      inner
        .selectFrom("object_tags")
        .select("object_tags.key")
        .where("object_tags.tag", "in", tags),
    );
  }

  return filtered;
}

/**
 * WASM 版 SQLite による `IObjectIndex` の実装です。
 *
 * メタデータ検索は kysely で組み立てた SQL で行い、ベクトル検索は JavaScript で総当たり計算します。
 */
export class SqliteWasmIndex implements IObjectIndex {
  private kysely: Kysely<SqliteWasmDatabase> | undefined;

  private readonly location: string;

  /**
   * @param options データベースの保存場所などの設定です。
   */
  public constructor(options: SqliteWasmIndexOptions = {}) {
    this.location = options.location ?? ":memory:";
  }

  /**
   * インデックスが現在開いているかを示します。
   */
  public get isOpen(): boolean {
    return this.kysely !== undefined;
  }

  /**
   * インデックスを開き、マイグレーションを適用します。
   *
   * @param c 開く操作のコンテキストです。
   */
  public async open(c: IObjectIndex.OpenContext): Promise<void> {
    c.signal.throwIfAborted();

    if (this.kysely !== undefined) {
      return;
    }

    let sqlite3: Awaited<ReturnType<typeof initSqliteWasm>>;

    try {
      sqlite3 = await initSqliteWasm();
    } catch (error) {
      throw new DbQueryError({
        cause: error,
        operation: "open",
      });
    }

    let handle: SqliteWasmHandle;

    try {
      handle = new sqlite3.oo1.DB(this.location, "c");
    } catch (error) {
      throw new DbQueryError({
        cause: error,
        operation: "open",
      });
    }

    const kysely = new Kysely<SqliteWasmDatabase>({ dialect: new SqliteWasmDialect(handle) });
    const { error } = await new Migrator({
      db: kysely,
      provider: new SqliteWasmMigrationProvider(),
    }).migrateToLatest();

    if (error instanceof Error) {
      handle.close();
      throw new DbQueryError({
        cause: error,
        operation: "open",
      });
    }

    this.kysely = kysely;
  }

  /**
   * インデックスを閉じます。
   *
   * @param c 閉じる操作のコンテキストです。
   */
  public async close(c: IObjectIndex.CloseContext): Promise<void> {
    c.signal.throwIfAborted();

    const kysely = this.kysely;

    this.kysely = undefined;

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

    const kysely = this.requireOpen("upsert");
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

    const key = object.key;
    const tags = [...new Set(object.tags)];
    const row = {
      key,
      hash: object.system.hash ?? null,
      size: object.system.size,
      embedding,
      created_at: object.system.createdAt,
      updated_at: object.system.updatedAt,
      description: object.description ?? null,
      content_type: object.system.contentType,
      user_metadata: stringifyJson(object.userMetadata, "upsert"),
      embedding_dims: embeddingDims,
      embedding_model: embeddingModel,
      embedding_source: embeddingSource,
    };
    await kysely.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("objects")
        .values(row)
        .onConflict((conflict) =>
          conflict.column("key").doUpdateSet({
            hash: row.hash,
            size: row.size,
            embedding: row.embedding,
            created_at: row.created_at,
            updated_at: row.updated_at,
            description: row.description,
            content_type: row.content_type,
            user_metadata: row.user_metadata,
            embedding_dims: row.embedding_dims,
            embedding_model: row.embedding_model,
            embedding_source: row.embedding_source,
          }),
        )
        .execute();
      await transaction.deleteFrom("object_tags").where("key", "=", key).execute();

      if (tags.length > 0) {
        await transaction
          .insertInto("object_tags")
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

    const kysely = this.requireOpen("get");
    const row = await kysely
      .selectFrom("objects")
      .selectAll()
      .where("key", "=", c.key)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    const tags = await this.loadTags(kysely, [row.key]);

    return this.toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "get");
  }

  /**
   * オブジェクトを削除します。
   *
   * @param c 削除する操作のコンテキストです。
   *
   * @returns 削除した場合は true、存在しなかった場合は false です。
   */
  public async delete(c: IObjectIndex.DeleteContext): Promise<boolean> {
    c.signal.throwIfAborted();

    const kysely = this.requireOpen("delete");
    const result = await kysely.deleteFrom("objects").where("key", "=", c.key).executeTakeFirst();
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

    const kysely = this.requireOpen("list");
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
      const candidates = await withMetadataFilter(
        kysely.selectFrom("objects").selectAll(),
        c.filter,
      )
        .orderBy("key")
        .execute();
      const matched = candidates.filter((row) =>
        matchesUserMetadata(
          parseJson(row.user_metadata, "list") as Record<string, unknown>,
          userMetadataFilter,
        ),
      );
      const page = matched.slice(offset, offset + limit);
      const tags = await this.loadTags(
        kysely,
        page.map((row) => row.key),
      );

      return {
        items: page.map((row) =>
          this.toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "list"),
        ),
        nextCursor: offset + page.length < matched.length ? String(offset + page.length) : null,
      };
    }

    const rows = await withMetadataFilter(kysely.selectFrom("objects").selectAll(), c.filter)
      .orderBy("key")
      .limit(limit + 1)
      .offset(offset)
      .execute();
    const page = rows.slice(0, limit);
    const tags = await this.loadTags(
      kysely,
      page.map((row) => row.key),
    );

    return {
      items: page.map((row) => this.toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "list")),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
    };
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

    const kysely = this.requireOpen("search");

    if (c.topK <= 0 || c.vector.length === 0) {
      return [];
    }

    const rows = await withMetadataFilter(
      kysely.selectFrom("objects").selectAll(),
      c.filter,
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

      const vector = decodeEmbedding(row.embedding);

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

      if (
        c.filter?.userMetadata !== undefined &&
        !matchesUserMetadata(
          parseJson(row.user_metadata, "search") as Record<string, unknown>,
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
    const tags = await this.loadTags(
      kysely,
      top.map(({ row }) => row.key),
    );

    return top.map(({ row, score }) => ({
      ...this.toObject<TUserMetadata>(row, tags.get(row.key) ?? [], "search"),
      score,
    }));
  }

  /**
   * 開いている kysely インスタンスを返します。
   *
   * @param operation 実行中の操作名です。
   *
   * @returns kysely のインスタンスです。
   */
  private requireOpen(operation: string): Kysely<SqliteWasmDatabase> {
    const kysely = this.kysely;

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
  private async loadTags(
    kysely: Kysely<SqliteWasmDatabase>,
    keys: readonly string[],
  ): Promise<Map<string, string[]>> {
    const tags = new Map<string, string[]>();

    if (keys.length === 0) {
      return tags;
    }

    const rows = await kysely
      .selectFrom("object_tags")
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
   * 行をオブジェクトに変換します。
   *
   * @param row `objects` テーブルの行です。
   * @param tags タグの一覧です。
   * @param operation 実行中の操作名です。
   *
   * @returns 変換したオブジェクトです。
   */
  private toObject<TUserMetadata>(
    row: ObjectRow,
    tags: readonly string[],
    operation: string,
  ): OmnioObject<TUserMetadata> {
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

    return {
      key: row.key,
      tags: [...tags],
      system: {
        hash: row.hash ?? undefined,
        size: row.size,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        contentType: row.content_type,
      },
      embedding,
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
