export type { FullTextOperator } from "./filter.js";
export { withMetadataFilter } from "./filter.js";

export type { SqlMigrationOptions } from "./migrations.js";
export { createSqlMigrations, SqlMigrationProvider } from "./migrations.js";

export { PgVectorObjectIndex } from "./pgvector-index.js";

export type { SqlObjectRow, SqlObjectTagRow, SqlIndexDatabase } from "./schema.js";

export type { ScoredObjectKey, SqlIndexBackend } from "./sql-index.js";
export { SqlObjectIndex } from "./sql-index.js";

export {
  dotProduct,
  l2Distance,
  parseVector,
  scoreVector,
  formatVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
  decodeEmbeddingInto,
} from "./vector.js";
