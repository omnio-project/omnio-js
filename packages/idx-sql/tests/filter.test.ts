import {
  type Dialect,
  Kysely,
  DummyDriver,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import { test, describe } from "vite-plus/test";

import { withMetadataFilter } from "../src/filter.js";
import type { SqlIndexDatabase } from "../src/schema.js";

/**
 * SQL をコンパイルするための Kysely のインスタンスを作ります。
 *
 * @returns SQL をコンパイルするための Kysely のインスタンスです。
 */
function createDatabase(): Kysely<SqlIndexDatabase> {
  const dialect: Dialect = {
    createDriver: () => new DummyDriver(),
    createAdapter: () => new SqliteAdapter(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  };

  return new Kysely<SqlIndexDatabase>({ dialect });
}

describe("withMetadataFilter", () => {
  test("比較演算子を省略すると LIKE を使う", async ({ expect }) => {
    // 準備：
    const db = createDatabase();

    try {
      // 実行：
      const compiled = withMetadataFilter(db.selectFrom("journal").select("key"), {
        contentType: { contains: "image/" },
      }).compile();

      // 検証：
      expect(compiled.sql).toContain(" LIKE ");
      expect(compiled.sql).not.toContain("ILIKE");
    } finally {
      // 後始末：
      await db.destroy();
    }
  });
});
