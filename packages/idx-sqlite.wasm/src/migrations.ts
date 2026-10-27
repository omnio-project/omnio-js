import { type Kysely, sql } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";

import type { SqliteWasmDatabase } from "./schema.js";

/**
 * `objects` 表と `object_tags` 表を作成します。
 *
 * @param db kysely のインスタンスです。
 */
async function up001(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema
    .createTable("objects")
    .addColumn("key", "text", (column) => column.primaryKey())
    .addColumn("content_type", "text", (column) => column.notNull())
    .addColumn("size", "integer", (column) => column.notNull())
    .addColumn("hash", "text")
    .addColumn("description", "text")
    .addColumn("user_metadata", "text", (column) => column.notNull())
    .addColumn("embedding_model", "text")
    .addColumn("embedding_dims", "integer")
    .addColumn("embedding_source", "text")
    .addColumn("embedding", "blob")
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute();
  await db.schema
    .createTable("object_tags")
    .addColumn("key", "text", (column) =>
      column.notNull().references("objects.key").onDelete("cascade"),
    )
    .addColumn("tag", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("object_tags_pkey", ["key", "tag"])
    .execute();
  await db.schema.createIndex("object_tags_tag_index").on("object_tags").column("tag").execute();
  await db.schema
    .createIndex("objects_content_type_index")
    .on("objects")
    .column("content_type")
    .execute();
  await db.schema
    .createIndex("objects_created_at_index")
    .on("objects")
    .column("created_at")
    .execute();
}

/**
 * `objects` 表と `object_tags` 表を削除します。
 *
 * @param db kysely のインスタンスです。
 */
async function down001(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema.dropTable("object_tags").execute();
  await db.schema.dropTable("objects").execute();
}

/**
 * `objects` テーブルを `journal` に改名し、関連インデックスを付け替えます。
 *
 * @param db kysely のインスタンスです。
 */
async function up002(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema.dropIndex("objects_content_type_index").execute();
  await db.schema.dropIndex("objects_created_at_index").execute();
  await db.schema.alterTable("objects").renameTo("journal").execute();
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
}

/**
 * `journal` テーブルを `objects` に戻し、関連インデックスを付け替えます。
 *
 * @param db kysely のインスタンスです。
 */
async function down002(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema.dropIndex("journal_content_type_index").execute();
  await db.schema.dropIndex("journal_created_at_index").execute();
  await db.schema.alterTable("journal").renameTo("objects").execute();
  await db.schema
    .createIndex("objects_content_type_index")
    .on("objects")
    .column("content_type")
    .execute();
  await db.schema
    .createIndex("objects_created_at_index")
    .on("objects")
    .column("created_at")
    .execute();
}

/**
 * `journal` テーブルに記録の種類と時刻を追加します。
 *
 * @param db kysely のインスタンスです。
 */
async function up003(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema
    .alterTable("journal")
    .addColumn("record_type", "text", (column) => column.notNull().defaultTo("CREATE"))
    .execute();
  await db.schema
    .alterTable("journal")
    .addColumn("record_timestamp", "text", (column) => column.notNull().defaultTo(""))
    .execute();
  await sql`update journal set record_timestamp = updated_at`.execute(db);
}

/**
 * `journal` テーブルから記録の種類と時刻を削除します。
 *
 * @param db kysely のインスタンスです。
 */
async function down003(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema.alterTable("journal").dropColumn("record_timestamp").execute();
  await db.schema.alterTable("journal").dropColumn("record_type").execute();
}

/**
 * `journal` テーブルに実体ストレージーのキーを追加します。
 *
 * @param db kysely のインスタンスです。
 */
async function up004(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema
    .alterTable("journal")
    .addColumn("entity_id", "text", (column) => column.notNull().defaultTo(""))
    .execute();

  const rows = await db.selectFrom("journal").select("key").execute();

  for (const row of rows) {
    await db
      .updateTable("journal")
      .set({ entity_id: crypto.randomUUID() })
      .where("key", "=", row.key)
      .execute();
  }

  await db.schema
    .createIndex("journal_entity_id_index")
    .on("journal")
    .column("entity_id")
    .unique()
    .execute();
}

/**
 * `journal` テーブルから実体ストレージーのキーを削除します。
 *
 * @param db kysely のインスタンスです。
 */
async function down004(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema.dropIndex("journal_entity_id_index").execute();
  await db.schema.alterTable("journal").dropColumn("entity_id").execute();
}

/**
 * 削除フラグ付きレコードでデータ列を NULL にできるようにします。
 *
 * @param db kysely のインスタンスです。
 */
async function up005(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await db.schema
    .createTable("journal_new")
    .addColumn("key", "text", (column) => column.notNull().primaryKey())
    .addColumn("entity_id", "text", (column) => column.notNull())
    .addColumn("record_type", "text", (column) => column.notNull())
    .addColumn("record_timestamp", "text", (column) => column.notNull())
    .addColumn("content_type", "text")
    .addColumn("size", "integer")
    .addColumn("hash", "text")
    .addColumn("description", "text")
    .addColumn("user_metadata", "text")
    .addColumn("embedding_model", "text")
    .addColumn("embedding_dims", "integer")
    .addColumn("embedding_source", "text")
    .addColumn("embedding", "blob")
    .addColumn("created_at", "text")
    .addColumn("updated_at", "text")
    .execute();
  await sql`
    insert into journal_new (
      key,
      entity_id,
      record_type,
      record_timestamp,
      content_type,
      size,
      hash,
      description,
      user_metadata,
      embedding_model,
      embedding_dims,
      embedding_source,
      embedding,
      created_at,
      updated_at
    )
    select
      key,
      entity_id,
      record_type,
      record_timestamp,
      content_type,
      size,
      hash,
      description,
      user_metadata,
      embedding_model,
      embedding_dims,
      embedding_source,
      embedding,
      created_at,
      updated_at
    from journal
  `.execute(db);
  await db.schema
    .createTable("object_tags_new")
    .addColumn("key", "text", (column) =>
      column.notNull().references("journal_new.key").onDelete("cascade"),
    )
    .addColumn("tag", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("object_tags_pkey", ["key", "tag"])
    .execute();
  await sql`
    insert into object_tags_new (key, tag)
    select key, tag from object_tags
  `.execute(db);
  await db.schema.dropTable("object_tags").execute();
  await db.schema.dropTable("journal").execute();
  await db.schema.alterTable("journal_new").renameTo("journal").execute();
  await db.schema.alterTable("object_tags_new").renameTo("object_tags").execute();
  await db.schema.createIndex("object_tags_tag_index").on("object_tags").column("tag").execute();
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
 * 削除フラグ付きレコードを削除し、データ列を NOT NULL に戻します。
 *
 * @param db kysely のインスタンスです。
 */
async function down005(db: Kysely<SqliteWasmDatabase>): Promise<void> {
  await sql`delete from journal where record_type = 'DELETE'`.execute(db);
  await db.schema
    .createTable("journal_old")
    .addColumn("key", "text", (column) => column.notNull().primaryKey())
    .addColumn("entity_id", "text", (column) => column.notNull())
    .addColumn("record_type", "text", (column) => column.notNull())
    .addColumn("record_timestamp", "text", (column) => column.notNull())
    .addColumn("content_type", "text", (column) => column.notNull())
    .addColumn("size", "integer", (column) => column.notNull())
    .addColumn("hash", "text")
    .addColumn("description", "text")
    .addColumn("user_metadata", "text", (column) => column.notNull())
    .addColumn("embedding_model", "text")
    .addColumn("embedding_dims", "integer")
    .addColumn("embedding_source", "text")
    .addColumn("embedding", "blob")
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("updated_at", "text", (column) => column.notNull())
    .execute();
  await sql`
    insert into journal_old (
      key,
      entity_id,
      record_type,
      record_timestamp,
      content_type,
      size,
      hash,
      description,
      user_metadata,
      embedding_model,
      embedding_dims,
      embedding_source,
      embedding,
      created_at,
      updated_at
    )
    select
      key,
      entity_id,
      record_type,
      record_timestamp,
      content_type,
      size,
      hash,
      description,
      user_metadata,
      embedding_model,
      embedding_dims,
      embedding_source,
      embedding,
      created_at,
      updated_at
    from journal
  `.execute(db);
  await db.schema
    .createTable("object_tags_old")
    .addColumn("key", "text", (column) =>
      column.notNull().references("journal_old.key").onDelete("cascade"),
    )
    .addColumn("tag", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("object_tags_pkey", ["key", "tag"])
    .execute();
  await sql`
    insert into object_tags_old (key, tag)
    select key, tag from object_tags
  `.execute(db);
  await db.schema.dropTable("object_tags").execute();
  await db.schema.dropTable("journal").execute();
  await db.schema.alterTable("journal_old").renameTo("journal").execute();
  await db.schema.alterTable("object_tags_old").renameTo("object_tags").execute();
  await db.schema.createIndex("object_tags_tag_index").on("object_tags").column("tag").execute();
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
 * 適用するマイグレーションの一覧です。キー名の辞書順で実行します。
 */
export const MIGRATIONS: Record<string, Migration> = {
  "004_add_entity_id": {
    up: up004,
    down: down004,
  },
  "001_create_objects": {
    up: up001,
    down: down001,
  },
  "003_add_record_metadata": {
    up: up003,
    down: down003,
  },
  "005_allow_delete_tombstones": {
    up: up005,
    down: down005,
  },
  "002_rename_objects_to_journal": {
    up: up002,
    down: down002,
  },
};

/**
 * ブラウザーと Node.js の両方で動作するマイグレーション提供器です。
 */
export class SqliteWasmMigrationProvider implements MigrationProvider {
  /**
   * マイグレーションの一覧を返します。
   *
   * @returns マイグレーション名から内容への対応表を解決する Promise です。
   */
  public async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS;
  }
}
