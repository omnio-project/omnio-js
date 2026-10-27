import { createSqlMigrations, SqlMigrationProvider } from "@omniojs/idx-sql";
import type { Migration } from "kysely/migration";

/**
 * 適用するマイグレーションの一覧です。キー名の辞書順で実行します。
 */
export const MIGRATIONS: Record<string, Migration> = createSqlMigrations({
  sizeColumnType: "integer",
  embeddingColumnType: "blob",
});

/**
 * WASM 版 SQLite 用のマイグレーション提供器です。
 */
export class SqliteWasmMigrationProvider extends SqlMigrationProvider {
  /**
   * マイグレーションの一覧を設定します。
   */
  public constructor() {
    super(MIGRATIONS);
  }
}
