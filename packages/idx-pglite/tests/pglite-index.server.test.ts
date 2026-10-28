import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type OmnioObject, OmnioKey } from "@omniojs/core";
import { test, describe } from "vite-plus/test";

import { PGliteIndex } from "../src/pglite-index.js";

describe("ファイル保存", () => {
  test("location を指定すると、開き直しても取得できる", async ({ expect, signal }) => {
    // 準備：
    const directory = await mkdtemp(join(tmpdir(), "omnio-idx-pglite-"));
    const location = join(directory, "pgdata");
    const object: OmnioObject = {
      key: OmnioKey.parse("k1"),
      hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      size: 3,
      tags: ["persisted"],
      entityId: crypto.randomUUID(),
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      contentType: "text/plain",
      description: "永続化の確認",
      userMetadata: { genre: "test" },
      hashAlgorithm: "sha256",
    };

    try {
      const first = new PGliteIndex({ location });

      try {
        await first.open({
          action: "open",
          signal,
        });
        await first.upsert({
          action: "upsert",
          object,
          signal,
        });
      } finally {
        await first.close({
          action: "close",
          signal,
        });
      }

      const second = new PGliteIndex({ location });

      try {
        // 実行：
        await second.open({
          action: "open",
          signal,
        });
        const actual = await second.get({
          key: OmnioKey.parse("k1"),
          action: "get",
          signal,
        });

        // 検証：
        expect(actual?.key.key).toBe("k1");
        expect(actual?.entityId).toBe(object.entityId);
      } finally {
        await second.close({
          action: "close",
          signal,
        });
      }
    } finally {
      await rm(directory, {
        force: true,
        recursive: true,
      });
    }
  }, 30_000);
});
