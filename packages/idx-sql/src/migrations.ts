import { type Kysely, sql } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";

import type { SqlIndexDatabase } from "./schema.js";
import { normalizeTimestamp } from "./timestamp.js";

/**
 * SQL インデックスのマイグレーションを構築する設定です。
 */
export type SqlMigrationOptions = {
  /**
   * 埋め込みベクトルを保存する列の型です。
   *
   * `"vector"` を指定した場合は pgvector 拡張を有効にします。
   */
  readonly embeddingColumnType: "blob" | "bytea" | "vector";

  /** バイト列のサイズを保存する列の型です。 */
  readonly sizeColumnType: "bigint" | "integer";
};

/**
 * `journal` 表と `object_tag` 表を作成します。
 *
 * @param db kysely のインスタンスです。
 * @param options 列の型の設定です。
 */
async function up001(db: Kysely<SqlIndexDatabase>, options: SqlMigrationOptions): Promise<void> {
  if (options.embeddingColumnType === "vector") {
    await sql`create extension if not exists vector`.execute(db);
  }

  const embeddingColumnType =
    options.embeddingColumnType === "vector" ? sql`vector` : options.embeddingColumnType;
  await db.schema
    .createTable("journal")
    .addColumn("key", "text", (column) => column.notNull().primaryKey())
    .addColumn("entity_id", "text", (column) => column.notNull())
    .addColumn("record_type", "text", (column) => column.notNull())
    .addColumn("record_timestamp", "text", (column) => column.notNull())
    .addColumn("content_type", "text")
    .addColumn("size", options.sizeColumnType)
    .addColumn("hash", "text")
    .addColumn("hash_algorithm", "text")
    .addColumn("description", "text")
    .addColumn("user_metadata", "text")
    .addColumn("embedding_model", "text")
    .addColumn("embedding_dims", "integer")
    .addColumn("embedding_source", "text")
    .addColumn("dirty", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("embedding", embeddingColumnType)
    .addColumn("created_at", "text")
    .addColumn("updated_at", "text")
    .execute();

  await db.schema
    .createTable("object_tag")
    .addColumn("key", "text", (column) =>
      column.notNull().references("journal.key").onDelete("cascade"),
    )
    .addColumn("tag", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("object_tag_pkey", ["key", "tag"])
    .execute();
  await db.schema.createIndex("object_tag_tag_index").on("object_tag").column("tag").execute();
  await db.schema
    .createIndex("journal_content_type_index")
    .on("journal")
    .column("content_type")
    .execute();
  await db.schema
    .createIndex("journal_created_at_index")
    .on("journal")
    .column("created_at")
    .execute();
  await db.schema
    .createIndex("journal_entity_id_index")
    .on("journal")
    .column("entity_id")
    .unique()
    .execute();
}

/**
 * `journal` 表と `object_tag` 表を削除します。
 *
 * @param db kysely のインスタンスです。
 */
async function down001(db: Kysely<SqlIndexDatabase>): Promise<void> {
  await db.schema.dropTable("object_tag").execute();
  await db.schema.dropTable("journal").execute();
}

/**
 * 解釈できない値をそのまま保持して日時を正規化します。
 *
 * @param value 変換する日時の文字列です。
 *
 * @returns 正規化した日時の文字列、解釈できない場合は元の文字列です。
 */
function normalizeOrKeep(value: string): string {
  try {
    return normalizeTimestamp(value, "migrate");
  } catch {
    // 壊れた旧データで開けなくならないよう、解釈できない値はそのまま保持します。
    return value;
  }
}

/**
 * null を保持したまま日時を正規化します。
 *
 * @param value 変換する日時の文字列です。
 *
 * @returns 正規化した日時の文字列、null、または解釈できない場合は元の文字列です。
 */
function normalizeNullableOrKeep(value: string | null): string | null {
  return value === null ? null : normalizeOrKeep(value);
}

/**
 * `journal` 表に保存された日時をミリ秒付きの UTC 表記に揃えます。
 *
 * @param db kysely のインスタンスです。
 */
async function normalizeJournalTimestamps(db: Kysely<SqlIndexDatabase>): Promise<void> {
  const rows = await db
    .selectFrom("journal")
    .select(["key", "created_at", "updated_at", "record_timestamp"])
    .execute();

  for (const row of rows) {
    const createdAt = normalizeNullableOrKeep(row.created_at);
    const updatedAt = normalizeNullableOrKeep(row.updated_at);
    const recordTimestamp = normalizeOrKeep(row.record_timestamp);

    if (
      createdAt === row.created_at &&
      updatedAt === row.updated_at &&
      recordTimestamp === row.record_timestamp
    ) {
      continue;
    }

    await db
      .updateTable("journal")
      .set({
        created_at: createdAt,
        updated_at: updatedAt,
        record_timestamp: recordTimestamp,
      })
      .where("key", "=", row.key)
      .execute();
  }
}

/**
 * `journal` 表に保存された日時をミリ秒付きの UTC 表記に揃えます。
 *
 * @param db kysely のインスタンスです。
 */
async function up002(db: Kysely<SqlIndexDatabase>): Promise<void> {
  // Kysely のマイグレーターは対応するデータベースではトランザクションを開始済みです。
  if (db.isTransaction) {
    await normalizeJournalTimestamps(db);

    return;
  }

  await db.transaction().execute((trx) => normalizeJournalTimestamps(trx));
}

/**
 * 物理削除を待つ実体の表を作成します。
 *
 * @param db kysely のインスタンスです。
 */
async function up003(db: Kysely<SqlIndexDatabase>): Promise<void> {
  await db.schema
    .createTable("pending_purge")
    .addColumn("entity_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("key", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .execute();
  await db.schema
    .createIndex("pending_purge_created_at_index")
    .on("pending_purge")
    .column("created_at")
    .execute();
}

/**
 * 物理削除を待つ実体の表を削除します。
 *
 * @param db kysely のインスタンスです。
 */
async function down003(db: Kysely<SqlIndexDatabase>): Promise<void> {
  await db.schema.dropTable("pending_purge").execute();
}

/**
 * 適用するマイグレーションの一覧を構築します。キー名の辞書順で実行します。
 *
 * @param options 列の型の設定です。
 *
 * @returns マイグレーション名から内容への対応表です。
 */
export function createSqlMigrations(options: SqlMigrationOptions): Record<string, Migration> {
  return {
    "001_create_journal": {
      up: (db) => up001(db, options),
      down: down001,
    },
    "003_create_pending_purge": {
      up: up003,
      down: down003,
    },
    "002_normalize_journal_timestamps": {
      up: up002,
      down: async () => {
        // 日時の正規化は元に戻せないため、ダウングレードでは何もしません。
      },
    },
  };
}

/**
 * ブラウザーと Node.js の両方で動作するマイグレーション提供器です。
 */
export class SqlMigrationProvider implements MigrationProvider {
  readonly #migrations: Record<string, Migration>;

  /**
   * @param migrations マイグレーション名から内容への対応表です。
   */
  public constructor(migrations: Record<string, Migration>) {
    this.#migrations = migrations;
  }

  /**
   * マイグレーションの一覧を返します。
   *
   * @returns マイグレーション名から内容への対応表を解決する Promise です。
   */
  public async getMigrations(): Promise<Record<string, Migration>> {
    return this.#migrations;
  }
}
