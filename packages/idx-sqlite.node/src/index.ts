export type { SqliteNodeHandle } from "./dialect.js";
export { SqliteNodeDialect } from "./dialect.js";

export type { SqliteNodeDialectErrorArgs, SqliteNodeDialectErrorMeta } from "./errors.js";
export { SqliteNodeErrorBase, SqliteNodeDialectError } from "./errors.js";

export type { Migration } from "kysely/migration";
export { Migrator } from "kysely/migration";
export { MIGRATIONS, SqliteNodeMigrationProvider } from "./migrations.js";

export type { ObjectRow, ObjectTagRow, SqliteNodeDatabase } from "./schema.js";

export type { SqliteNodeIndexOptions } from "./sqlite-index.js";
export { SqliteNodeIndex } from "./sqlite-index.js";

export {
  l2Distance,
  scoreVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
} from "./vector.js";
