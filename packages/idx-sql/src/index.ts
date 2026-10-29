export type { FullTextOperator } from "./filter.js";
export { withMetadataFilter } from "./filter.js";

export { normalizeTimestamp } from "./timestamp.js";

export type { SqlMigrationOptions } from "./migrations.js";
export { createSqlMigrations, SqlMigrationProvider } from "./migrations.js";

export { PgVectorObjectIndex } from "./pgvector-index.js";

export type { SqlObjectRow, SqlObjectTagRow, SqlIndexDatabase } from "./schema.js";

export type { ScoredObjectKey, SqlIndexBackend } from "./sql-index.js";
export { SqlObjectIndex } from "./sql-index.js";

export {
  l2Distance,
  parseVector,
  scoreVector,
  formatVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
  decodeEmbeddingInto,
} from "./vector.js";
