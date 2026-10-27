import type { Kysely } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";

import type { SqliteNodeDatabase } from "./schema.js";

/**
 * `journal` 表と `object_tag` 表を作成します。
 *
 * @param db kysely のインスタンスです。
 */
async function up001(db: Kysely<SqliteNodeDatabase>): Promise<void> {
  await db.schema
    .createTable("journal")
    .addColumn("key", "text", (column) => column.notNull().primaryKey())
    .addColumn("entity_id", "text", (column) => column.notNull())
    .addColumn("record_type", "text", (column) => column.notNull())
    .addColumn("record_timestamp", "text", (column) => column.notNull())
    .addColumn("content_type", "text")
    .addColumn("size", "integer")
    .addColumn("hash", "text")
    .addColumn("hash_algorithm", "text")
    .addColumn("description", "text")
    .addColumn("user_metadata", "text")
    .addColumn("embedding_model", "text")
    .addColumn("embedding_dims", "integer")
    .addColumn("embedding_source", "text")
    .addColumn("dirty", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("embedding", "blob")
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
async function down001(db: Kysely<SqliteNodeDatabase>): Promise<void> {
  await db.schema.dropTable("object_tag").execute();
  await db.schema.dropTable("journal").execute();
}

/**
 * 適用するマイグレーションの一覧です。キー名の辞書順で実行します。
 */
export const MIGRATIONS: Record<string, Migration> = {
  "001_create_journal": {
    up: up001,
    down: down001,
  },
};

/**
 * ブラウザーと Node.js の両方で動作するマイグレーション提供器です。
 */
export class SqliteNodeMigrationProvider implements MigrationProvider {
  /**
   * マイグレーションの一覧を返します。
   *
   * @returns マイグレーション名から内容への対応表を解決する Promise です。
   */
  public async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS;
  }
}
