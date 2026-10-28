export type { Migration } from "kysely/migration";
export { Migrator } from "kysely/migration";
export { MIGRATIONS, PGliteMigrationProvider } from "./migrations.js";

export type { PGliteIndexOptions } from "./pglite-index.js";
export { PGliteIndex } from "./pglite-index.js";

export type { ObjectRow, ObjectTagRow, PGliteDatabase } from "./schema.js";

export {
  l2Distance,
  scoreVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
} from "./vector.js";
