import type { Kysely } from "kysely";
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
 * 適用するマイグレーションの一覧です。キー名の辞書順で実行します。
 */
export const MIGRATIONS: Record<string, Migration> = {
  "001_create_objects": {
    up: up001,
    down: down001,
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
