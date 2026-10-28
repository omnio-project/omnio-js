import { createSqlMigrations, SqlMigrationProvider } from "@omniojs/idx-sql";
import type { Migration } from "kysely/migration";

/**
 * 適用するマイグレーションの一覧です。キー名の辞書順で実行します。
 */
export const MIGRATIONS: Record<string, Migration> = createSqlMigrations({
  sizeColumnType: "bigint",
  embeddingColumnType: "vector",
});

/**
 * PGlite 用のマイグレーション提供器です。
 */
export class PGliteMigrationProvider extends SqlMigrationProvider {
  /**
   * マイグレーションの一覧を設定します。
   */
  public constructor() {
    super(MIGRATIONS);
  }
}
