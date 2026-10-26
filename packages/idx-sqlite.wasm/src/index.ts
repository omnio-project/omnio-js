export type { SqliteWasmHandle } from "./dialect.js";
export { initSqliteWasm, SqliteWasmDialect } from "./dialect.js";

export type { SqliteWasmDialectErrorArgs, SqliteWasmDialectErrorMeta } from "./errors.js";
export { SqliteWasmErrorBase, SqliteWasmDialectError } from "./errors.js";

export type { Migration } from "kysely/migration";
export { Migrator } from "kysely/migration";
export { MIGRATIONS, SqliteWasmMigrationProvider } from "./migrations.js";

export type { ObjectRow, ObjectTagRow, SqliteWasmDatabase } from "./schema.js";

export type { SqliteWasmIndexOptions } from "./sqlite-index.js";
export { SqliteWasmIndex } from "./sqlite-index.js";

export {
  dotProduct,
  l2Distance,
  scoreVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
} from "./vector.js";
