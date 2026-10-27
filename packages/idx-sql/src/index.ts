export type { FullTextOperator } from "./filter.js";

export type { SqlMigrationOptions } from "./migrations.js";
export { createSqlMigrations, SqlMigrationProvider } from "./migrations.js";

export type { SqlObjectRow, SqlObjectTagRow, SqlIndexDatabase } from "./schema.js";

export type { SqlIndexBackend } from "./sql-index.js";
export { SqlObjectIndex } from "./sql-index.js";

export {
  dotProduct,
  l2Distance,
  scoreVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
  decodeEmbeddingInto,
} from "./vector.js";
