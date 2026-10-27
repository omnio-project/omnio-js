export type { Migration } from "kysely/migration";
export { Migrator } from "kysely/migration";
export { MIGRATIONS, PostgresqlMigrationProvider } from "./migrations.js";

export type { PostgresqlIndexOptions } from "./postgresql-index.js";
export { PostgresqlIndex } from "./postgresql-index.js";

export type { ObjectRow, ObjectTagRow, PostgresqlDatabase } from "./schema.js";

export {
  dotProduct,
  l2Distance,
  scoreVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
} from "./vector.js";
