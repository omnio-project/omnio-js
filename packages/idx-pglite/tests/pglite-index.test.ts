import {
  type OmnioObject,
  type MetadataFilter,
  OmnioKey,
  DbQueryError,
  DbNotOpenError,
  OperationAbortedError,
  VectorDimensionMismatchError,
} from "@omniojs/core";
import type { Migration } from "kysely/migration";
import { vi, test, describe } from "vite-plus/test";

import { PGliteMigrationProvider } from "../src/migrations.js";
import { PGliteIndex } from "../src/pglite-index.js";

/** ハッシュの絞り込み条件の検証に使うハッシュ値です。 */
const HASH_K1 = "1".repeat(64);

/** ハッシュの絞り込み条件の検証に使うハッシュ値です。 */
const HASH_K2 = "2".repeat(64);

/** ハッシュの絞り込み条件の検証に使うハッシュ値です。 */
const HASH_K3 = "3".repeat(64);

/**
 * 開いた状態のインデックスを作ります。
 *
 * 各テストの IObjectIndex 操作の検証に使用します。
 *
 * @param signal 処理を中断するための中断シグナルです。
 *
 * @returns 開いた状態のインデックスです。
 */
async function createOpenedIndex(signal: AbortSignal): Promise<PGliteIndex> {
  const index = new PGliteIndex();
  await index.open({
    action: "open",
    signal,
  });

  return index;
}

/**
 * テスト用のオブジェクトを作ります。
 *
 * 保存と取得の roundtrip 検証の基準値として使用します。
 *
 * @param key オブジェクトのキーです。
 * @param tags 付与するタグの一覧です。
 *
 * @returns テスト用のオブジェクトです。
 */
function createObject(key: string, tags: readonly string[] = []): OmnioObject {
  return {
    key: OmnioKey.parse(key),
    hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    size: 3,
    tags: [...tags],
    entityId: crypto.randomUUID(),
    createdAt: "2026-01-01T00:00:00.000Z",
    embedding: new Float32Array([1, 0, 0]),
    updatedAt: "2026-01-02T00:00:00.000Z",
    contentType: "text/plain",
    description: `${key} の説明文`,
    userMetadata: { genre: "test" },
    embeddingDims: 3,
    hashAlgorithm: "sha256",
    embeddingModel: "test-model",
    embeddingSource: {
      kind: "description",
      model: "test-model",
    },
  };
}

/**
 * 指定したベクトルを持つテスト用のオブジェクトを作ります。
 *
 * ベクトル検索の検証に使用します。
 *
 * @param key オブジェクトのキーです。
 * @param vector 埋め込みベクトルです。
 * @param tags 付与するタグの一覧です。
 *
 * @returns テスト用のオブジェクトです。
 */
function createVectorObject(
  key: string,
  vector: Float32Array,
  tags: readonly string[] = [],
): OmnioObject {
  return {
    ...createObject(key, tags),
    embedding: vector,
    embeddingDims: vector.length,
  };
}

/**
 * 一覧と検索の検証用に 3 件を保存します。
 *
 * タグ絞り込み、日付絞り込み、全文検索の検証に使用します。
 *
 * @param index 保存先のインデックスです。
 * @param signal 処理を中断するための中断シグナルです。
 */
async function seedThree(index: PGliteIndex, signal: AbortSignal): Promise<void> {
  const objects: OmnioObject[] = [
    {
      ...createObject("k1", ["red", "round"]),
      description: "赤い丸",
      hash: HASH_K1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-05T00:00:00Z",
      userMetadata: { color: "red" },
    },
    {
      ...createObject("k2", ["blue", "round"]),
      description: "青い丸",
      hash: HASH_K2,
      contentType: "image/png",
      createdAt: "2026-02-01T00:00:00Z",
      size: 8,
      updatedAt: "2026-02-05T00:00:00Z",
      userMetadata: { color: "blue" },
    },
    {
      ...createObject("k3", ["red", "square"]),
      description: "赤い四角",
      hash: HASH_K3,
      createdAt: "2026-03-01T00:00:00Z",
      size: 5,
      updatedAt: "2026-03-05T00:00:00Z",
      userMetadata: { color: "red" },
    },
  ];

  for (const object of objects) {
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });
  }
}

/**
 * 一覧結果のキーを取り出します。
 *
 * 検証文を短くするために使用します。
 *
 * @param items 一覧結果の項目です。
 *
 * @returns キーの一覧です。
 */
function keysOf(items: readonly { key: OmnioKey }[]): string[] {
  return items.map((item) => item.key.key);
}

describe("lifecycle", () => {
  test("初期状態では開いていない", ({ expect }) => {
    // 実行と検証：
    expect(new PGliteIndex().isOpen).toBe(false);
  });

  test("open すると開いた状態になる", async ({ expect, signal }) => {
    // 準備：
    const index = new PGliteIndex();

    // 実行：
    await index.open({
      action: "open",
      signal,
    });

    // 検証：
    expect(index.isOpen).toBe(true);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("二重の open は成功する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    // 実行：
    await index.open({
      action: "open",
      signal,
    });

    // 検証：
    expect(index.isOpen).toBe(true);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("close すると閉じた状態になる", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    // 実行：
    await index.close({
      action: "close",
      signal,
    });

    // 検証：
    expect(index.isOpen).toBe(false);
  });

  test("二重の close は成功する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.close({
      action: "close",
      signal,
    });

    // 実行と検証：
    await expect(
      index.close({
        action: "close",
        signal,
      }),
    ).resolves.toBeUndefined();
    expect(index.isOpen).toBe(false);
  });

  test("閉じた状態での get は DbNotOpenError を投げる", async ({ expect, signal }) => {
    // 準備：
    const index = new PGliteIndex();

    // 実行と検証：
    await expect(
      index.get({
        key: OmnioKey.parse("missing"),
        action: "get",
        signal,
      }),
    ).rejects.toBeInstanceOf(DbNotOpenError);
  });

  test("中断済みのシグナルでの open は中断する", async ({ expect }) => {
    // 準備：
    const index = new PGliteIndex();
    const controller = new AbortController();
    const reason = new OperationAbortedError();
    controller.abort(reason);

    // 実行と検証：
    await expect(
      index.open({
        action: "open",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(index.isOpen).toBe(false);
  });

  test("Error 以外のマイグレーション失敗でも開き直せる", async ({ expect, signal }) => {
    // 準備：
    const failed: Migration = {
      up: () => Promise.reject("migration failed"),
    };
    using _getMigrations = vi
      .spyOn(PGliteMigrationProvider.prototype, "getMigrations")
      .mockResolvedValueOnce({ failed });
    const index = new PGliteIndex();

    // 実行と検証：
    await expect(
      index.open({
        action: "open",
        signal,
      }),
    ).rejects.toBeInstanceOf(DbQueryError);
    expect(index.isOpen).toBe(false);
    await index.open({
      action: "open",
      signal,
    });
    expect(index.isOpen).toBe(true);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("マイグレーションが undefined で失敗しても開き直せる", async ({ expect, signal }) => {
    // 準備：
    const failed: Migration = {
      up: () => Promise.reject(undefined),
    };
    using _getMigrations = vi
      .spyOn(PGliteMigrationProvider.prototype, "getMigrations")
      .mockResolvedValueOnce({ failed });
    const index = new PGliteIndex();

    // 実行と検証：
    await expect(
      index.open({
        action: "open",
        signal,
      }),
    ).rejects.toBeInstanceOf(DbQueryError);
    expect(index.isOpen).toBe(false);
    await index.open({
      action: "open",
      signal,
    });
    expect(index.isOpen).toBe(true);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});

describe("upsert と get", () => {
  test("保存したオブジェクトをそのまま取得する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const object = createObject("k1", ["photo", "sea"]);

    // 実行：
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });

    const actual = await index.get({
      key: OmnioKey.parse("k1"),
      action: "get",
      signal,
    });

    // 検証：
    expect(actual?.key).toBeInstanceOf(OmnioKey);
    expect(actual?.key.key).toBe("k1");
    expect(actual?.description).toBe(object.description);
    expect(actual?.embedding).toStrictEqual(object.embedding);
    expect(actual?.embeddingDims).toBe(object.embeddingDims);
    expect(actual?.embeddingModel).toBe(object.embeddingModel);
    expect(actual?.embeddingSource).toStrictEqual(object.embeddingSource);
    expect(actual).toStrictEqual(object);
    expect(actual?.tags).toStrictEqual(object.tags);
    expect(actual?.userMetadata).toStrictEqual(object.userMetadata);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("同じキーの保存は上書きしタグを置き換える", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createObject("k1", ["old"]),
      signal,
    });

    const overwritten = {
      ...createObject("k1", ["new"]),
      description: "新しい説明",
    };

    // 実行：
    await index.upsert({
      action: "upsert",
      object: overwritten,
      signal,
    });

    const actual = await index.get({
      key: OmnioKey.parse("k1"),
      action: "get",
      signal,
    });
    const byOldTag = await index.list({
      action: "list",
      filter: { tags: { hasSome: ["old"] } },
      signal,
    });

    // 検証：
    expect(actual?.key).toBeInstanceOf(OmnioKey);
    expect(actual?.key.key).toBe("k1");
    expect(actual?.description).toBe(overwritten.description);
    expect(actual?.tags).toStrictEqual(overwritten.tags);
    expect(byOldTag.items).toStrictEqual([]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("存在しないキーの取得は null である", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    // 実行：
    const actual = await index.get({
      key: OmnioKey.parse("missing"),
      action: "get",
      signal,
    });

    // 検証：
    expect(actual).toBeNull();

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("埋め込みなしのオブジェクトを保存と取得する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const object: OmnioObject = {
      ...createObject("k1"),
      embedding: undefined,
    };

    // 実行：
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });

    const actual = await index.get({
      key: OmnioKey.parse("k1"),
      action: "get",
      signal,
    });

    // 検証：
    expect(actual).toStrictEqual({
      ...object,
      embeddingDims: undefined,
      embeddingModel: undefined,
      embeddingSource: undefined,
    });

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("次元数が一致しない埋め込みの保存はエラーを投げる", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const object = {
      ...createObject("k1"),
      embeddingDims: 2,
    };

    // 実行と検証：
    await expect(
      index.upsert({
        action: "upsert",
        object,
        signal,
      }),
    ).rejects.toBeInstanceOf(VectorDimensionMismatchError);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});

describe("has", () => {
  test("存在する場合だけ true を返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createObject("k1"),
      signal,
    });

    // 実行と検証：
    expect(
      await index.has({
        key: OmnioKey.parse("k1"),
        action: "has",
        signal,
      }),
    ).toBe(true);
    expect(
      await index.has({
        key: OmnioKey.parse("missing"),
        action: "has",
        signal,
      }),
    ).toBe(false);
    await index.delete({
      key: OmnioKey.parse("k1"),
      action: "delete",
      signal,
    });
    expect(
      await index.has({
        key: OmnioKey.parse("k1"),
        action: "has",
        signal,
      }),
    ).toBe(false);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});

describe("updateMetadata", () => {
  test("変更可能なメタデータだけを更新する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const object = createObject("k1", ["old"]);
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });

    // 実行：
    const updated = await index.updateMetadata({
      key: OmnioKey.parse("k1"),
      action: "updateMetadata",
      signal,
      metadata: {
        tags: [],
        updatedAt: "2026-02-01T00:00:00Z",
        contentType: "application/json",
        description: "新しい説明",
        userMetadata: { genre: "updated" },
      },
    });

    // 検証：
    expect(updated?.entityId).toBe(object.entityId);
    expect(updated?.size).toBe(object.size);
    expect(updated?.hash).toBe(object.hash);
    expect(updated?.hashAlgorithm).toBe(object.hashAlgorithm);
    expect(updated?.createdAt).toBe(object.createdAt);
    expect(updated?.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(updated?.contentType).toBe("application/json");
    expect(updated?.description).toBe("新しい説明");
    expect(updated?.tags).toStrictEqual([]);
    expect(updated?.userMetadata).toStrictEqual({ genre: "updated" });

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("存在しないキーは null を返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    // 実行と検証：
    expect(
      await index.updateMetadata({
        key: OmnioKey.parse("missing"),
        action: "updateMetadata",
        signal,
        metadata: {
          updatedAt: "2026-02-01T00:00:00Z",
          userMetadata: { genre: "updated" },
        },
      }),
    ).toBeNull();

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("dirty フラグを維持する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createObject("k1"),
      signal,
    });
    await index.markDirty({
      action: "markDirty",
      signal,
      embeddingModel: "other-model",
    });

    // 実行：
    await index.updateMetadata({
      key: OmnioKey.parse("k1"),
      action: "updateMetadata",
      signal,
      metadata: {
        updatedAt: "2026-02-01T00:00:00Z",
        userMetadata: { genre: "updated" },
      },
    });

    const dirty = await index.listDirty({
      action: "listDirty",
      signal,
    });

    // 検証：
    expect(keysOf(dirty)).toStrictEqual(["k1"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});

describe("rename", () => {
  test("キーとタグを変更し、実体とメタデータを維持する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const object = createObject("old", ["a", "b"]);
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });

    // 実行：
    const result = await index.rename({
      action: "rename",
      signal,
      sourceKey: OmnioKey.parse("old"),
      updatedAt: "2026-02-01T00:00:00Z",
      destinationKey: OmnioKey.parse("new"),
    });
    const actual = await index.get({
      key: OmnioKey.parse("new"),
      action: "get",
      signal,
    });

    // 検証：
    expect(result?.replacedEntityId).toBeUndefined();
    expect(result?.object.entityId).toBe(object.entityId);
    expect(result?.object.size).toBe(object.size);
    expect(result?.object.hash).toBe(object.hash);
    expect(result?.object.hashAlgorithm).toBe(object.hashAlgorithm);
    expect(result?.object.createdAt).toBe(object.createdAt);
    expect(result?.object.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(result?.object.tags).toStrictEqual(["a", "b"]);
    expect(actual).toStrictEqual(result?.object);

    expect(
      await index.get({
        key: OmnioKey.parse("old"),
        action: "get",
        signal,
      }),
    ).toBeNull();

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("変更先が存在する場合は上書きする", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const source = createObject("source", ["source-tag"]);
    const destination = createObject("dest", ["dest-tag"]);
    await index.upsert({
      action: "upsert",
      object: source,
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: destination,
      signal,
    });

    // 実行：
    const result = await index.rename({
      action: "rename",
      signal,
      sourceKey: OmnioKey.parse("source"),
      updatedAt: "2026-02-01T00:00:00Z",
      destinationKey: OmnioKey.parse("dest"),
    });
    const bySourceTag = await index.list({
      action: "list",
      filter: { tags: { hasSome: ["source-tag"] } },
      signal,
    });
    const byDestinationTag = await index.list({
      action: "list",
      filter: { tags: { hasSome: ["dest-tag"] } },
      signal,
    });

    // 検証：
    expect(result?.replacedEntityId).toBe(destination.entityId);
    expect(result?.object.entityId).toBe(source.entityId);
    expect(keysOf(bySourceTag.items)).toStrictEqual(["dest"]);
    expect(byDestinationTag.items).toStrictEqual([]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("変更元が存在しない場合は null を返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    // 実行と検証：
    expect(
      await index.rename({
        action: "rename",
        signal,
        sourceKey: OmnioKey.parse("missing"),
        updatedAt: "2026-02-01T00:00:00Z",
        destinationKey: OmnioKey.parse("dest"),
      }),
    ).toBeNull();

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});

describe("delete", () => {
  test("削除すると取得できなくなりタグも消える", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createObject("k1", ["gone"]),
      signal,
    });

    // 実行：
    const deleted = await index.delete({
      key: OmnioKey.parse("k1"),
      action: "delete",
      signal,
    });
    const actual = await index.get({
      key: OmnioKey.parse("k1"),
      action: "get",
      signal,
    });
    const byTag = await index.list({
      action: "list",
      filter: { tags: { hasSome: ["gone"] } },
      signal,
    });

    // 検証：
    expect(deleted).toBe(true);
    expect(actual).toBeNull();
    expect(byTag.items).toStrictEqual([]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("削除フラグを立てたレコードは取得・検索から除外し、purgeで物理削除する", async ({
    expect,
    signal,
  }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const object = createObject("k1", ["gone"]);
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });

    // 実行：
    const deleted = await index.delete({
      key: object.key,
      action: "delete",
      signal,
    });
    const actual = await index.get({
      key: object.key,
      action: "get",
      signal,
    });
    const byTag = await index.list({
      action: "list",
      filter: { tags: { hasSome: ["gone"] } },
      signal,
    });
    const byVector = await index.search({
      topK: 10,
      action: "search",
      signal,
      vector: new Float32Array([1, 0, 0]),
    });
    const purged = await index.purge({
      key: object.key,
      action: "purge",
      signal,
      entityId: object.entityId,
    });
    const purgedAgain = await index.purge({
      key: object.key,
      action: "purge",
      signal,
      entityId: object.entityId,
    });

    // 検証：
    expect(deleted).toBe(true);
    expect(actual).toBeNull();
    expect(byTag.items).toStrictEqual([]);
    expect(byVector).toStrictEqual([]);
    expect(purged).toBe(true);
    expect(purgedAgain).toBe(false);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("削除フラグ付きのキーを再保存すると復元する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const first = createObject("k1");
    await index.upsert({
      action: "upsert",
      object: first,
      signal,
    });
    await index.delete({
      key: first.key,
      action: "delete",
      signal,
    });

    // 実行：
    const second = {
      ...createObject("k1"),
      entityId: crypto.randomUUID(),
      description: "復元した説明",
    };
    await index.upsert({
      action: "upsert",
      object: second,
      signal,
    });

    const actual = await index.get({
      key: second.key,
      action: "get",
      signal,
    });
    const purgedOldEntity = await index.purge({
      key: first.key,
      action: "purge",
      signal,
      entityId: first.entityId,
    });

    // 検証：
    expect(actual?.entityId).toBe(second.entityId);
    expect(actual?.description).toBe("復元した説明");
    expect(purgedOldEntity).toBe(false);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("存在しないキーの削除は false である", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    // 実行：
    const actual = await index.delete({
      key: OmnioKey.parse("missing"),
      action: "delete",
      signal,
    });

    // 検証：
    expect(actual).toBe(false);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});

describe("dirty", () => {
  test("モデルが異なる説明付きオブジェクトに dirty を立て、検索から除外する", async ({
    expect,
    signal,
  }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const object = createObject("k1", ["pet"]);
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });

    // 実行：
    const marked = await index.markDirty({
      action: "markDirty",
      signal,
      embeddingModel: "next-model",
    });
    const markedAgain = await index.markDirty({
      action: "markDirty",
      signal,
      embeddingModel: "test-model",
    });
    const dirty = await index.listDirty({
      action: "listDirty",
      signal,
    });
    const hidden = await index.search({
      topK: 10,
      action: "search",
      signal,
      vector: new Float32Array([1, 0, 0]),
      embeddingModel: "test-model",
    });

    await index.upsert({
      action: "upsert",
      object: {
        ...object,
        embeddingModel: "next-model",
        embeddingSource: {
          kind: "description",
          model: "next-model",
        },
      },
      signal,
    });

    const remaining = await index.listDirty({
      action: "listDirty",
      signal,
    });
    const visible = await index.search({
      topK: 10,
      action: "search",
      signal,
      vector: new Float32Array([1, 0, 0]),
      embeddingModel: "next-model",
    });

    // 検証：
    expect(marked).toBe(1);
    expect(markedAgain).toBe(0);
    expect(keysOf(dirty)).toStrictEqual(["k1"]);
    expect(dirty[0]?.description).toBe(object.description);
    expect(hidden).toStrictEqual([]);
    expect(remaining).toStrictEqual([]);
    expect(keysOf(visible)).toStrictEqual(["k1"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
  test("モデル名が同じでも次元数が異なる場合は dirty にする", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createObject("same"),
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: createVectorObject("different", new Float32Array([1, 0, 0, 0])),
      signal,
    });

    // 実行：
    const marked = await index.markDirty({
      action: "markDirty",
      signal,
      embeddingDims: 3,
      embeddingModel: "test-model",
    });
    const dirty = await index.listDirty({
      action: "listDirty",
      signal,
    });

    // 検証：
    expect(marked).toBe(1);
    expect(keysOf(dirty)).toStrictEqual(["different"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("afterKey で続きの dirty を取得する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    for (const key of ["a", "b", "c"]) {
      await index.upsert({
        action: "upsert",
        object: createObject(key),
        signal,
      });
    }

    const marked = await index.markDirty({
      action: "markDirty",
      signal,
      embeddingModel: "next-model",
    });

    // 実行：
    const first = await index.listDirty({
      limit: 2,
      action: "listDirty",
      signal,
    });
    const second = await index.listDirty({
      limit: 2,
      action: "listDirty",
      signal,
      afterKey: "b",
    });

    // 検証：
    expect(marked).toBe(3);
    expect(keysOf(first)).toStrictEqual(["a", "b"]);
    expect(keysOf(second)).toStrictEqual(["c"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});

describe("list", () => {
  test("キー順にページ分けして取得する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    // 実行：
    const first = await index.list({
      limit: 2,
      action: "list",
      signal,
    });
    const second = await index.list({
      limit: 2,
      action: "list",
      cursor: first.nextCursor,
      signal,
    });

    // 検証：
    expect(keysOf(first.items)).toStrictEqual(["k1", "k2"]);
    expect(first.nextCursor).not.toBeNull();
    expect(keysOf(second.items)).toStrictEqual(["k3"]);
    expect(second.nextCursor).toBeNull();

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("limit が 0 以下では空の一覧を返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    // 実行：
    const actual = await index.list({
      limit: 0,
      action: "list",
      signal,
    });

    // 検証：
    expect(actual).toStrictEqual({
      items: [],
      nextCursor: null,
    });

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("タグの条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);
    await index.upsert({
      action: "upsert",
      object: createObject("k4"),
      signal,
    });

    const cases = [
      ["red", ["k1", "k3"]],
      [{ has: "red" }, ["k1", "k3"]],
      [{ hasSome: ["square", "blue"] }, ["k2", "k3"]],
      [{ hasEvery: ["red", "round"] }, ["k1"]],
      [{ hasEvery: ["red", "square"] }, ["k3"]],
      [{ isEmpty: true }, ["k4"]],
      [{ isEmpty: false }, ["k1", "k2", "k3"]],
      [{ equals: ["round", "red"] }, ["k1"]],
      [{ equals: [] }, ["k4"]],
      [{ equals: ["red"] }, []],
      [
        {
          has: "red",
          hasSome: ["square"],
        },
        ["k3"],
      ],
    ] as const;

    for (const [tags, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { tags },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("コンテンツタイプと日時で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    // 実行：
    const byType = await index.list({
      action: "list",
      filter: { contentType: "image/png" },
      signal,
    });
    const after = await index.list({
      action: "list",
      filter: { createdAt: { gte: "2026-02-01T00:00:00Z" } },
      signal,
    });
    const before = await index.list({
      action: "list",
      filter: { createdAt: { lte: "2026-01-15T00:00:00Z" } },
      signal,
    });

    // 検証：
    expect(keysOf(byType.items)).toStrictEqual(["k2"]);
    expect(keysOf(after.items)).toStrictEqual(["k2", "k3"]);
    expect(keysOf(before.items)).toStrictEqual(["k1"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("コンテンツタイプの条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    const cases = [
      [{ equals: "image/png" }, ["k2"]],
      [{ not: "image/png" }, ["k1", "k3"]],
      [{ in: ["image/png"] }, ["k2"]],
      [{ notIn: ["image/png"] }, ["k1", "k3"]],
      [{ contains: "image/" }, ["k2"]],
      [{ startsWith: "image/" }, ["k2"]],
      [{ endsWith: "plain" }, ["k1", "k3"]],
      [
        {
          endsWith: "png",
          startsWith: "image/",
        },
        ["k2"],
      ],
    ] as const;

    for (const [contentType, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { contentType },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("大文字の部分一致で小文字のコンテンツタイプに一致する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: {
        ...createObject("json"),
        contentType: "application/json",
      },
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: createObject("text"),
      signal,
    });

    const cases = [
      [{ endsWith: "JSON" }, ["json"]],
      [{ startsWith: "APPLICATION/" }, ["json"]],
      [{ contains: "SON" }, ["json"]],
    ] as const;

    for (const [contentType, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { contentType },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("数値オフセット付きの日時条件で同じ瞬間に一致する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    const cases = [
      [{ equals: "2026-01-01T09:00:00+09:00" }, ["k1"]],
      [{ equals: "2026-01-01T09:00:00+0900" }, ["k1"]],
      [{ equals: "2026-01-01T09:00:00+09" }, ["k1"]],
      [{ gte: "2026-02-01T09:00:00+0900" }, ["k2", "k3"]],
      [{ gte: "2026-02-01T09:00:00+09" }, ["k2", "k3"]],
      [
        {
          in: ["2026-01-01T09:00:00+0900", "2026-03-01T09:00:00+09"],
        },
        ["k1", "k3"],
      ],
    ] as const;

    for (const [createdAt, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { createdAt },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("数値オフセット付きの日時をミリ秒付き UTC で保存する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    // 実行：
    await index.upsert({
      action: "upsert",
      object: {
        ...createObject("compact"),
        createdAt: "2026-01-01T09:00:00+0900",
        updatedAt: "2026-01-02T09:00:00+09",
      },
      signal,
    });

    const actual = await index.get({
      key: OmnioKey.parse("compact"),
      action: "get",
      signal,
    });
    const byRecordTimestamp = await index.list({
      action: "list",
      filter: { recordTimestamp: { equals: "2026-01-02T09:00:00+09" } },
      signal,
    });

    // 検証：
    expect(actual?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(actual?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(keysOf(byRecordTimestamp.items)).toStrictEqual(["compact"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("Date の完全一致でミリ秒なしの保存値に一致する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    // 実行：
    const direct = await index.list({
      action: "list",
      filter: { createdAt: new Date("2026-01-01T00:00:00Z") },
      signal,
    });
    const equals = await index.list({
      action: "list",
      filter: { createdAt: { equals: new Date("2026-02-01T00:00:00Z") } },
      signal,
    });

    // 検証：
    expect(keysOf(direct.items)).toStrictEqual(["k1"]);
    expect(keysOf(equals.items)).toStrictEqual(["k2"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("空の in 条件は何にも一致しない", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    const filters: MetadataFilter[] = [
      { contentType: { in: [] } },
      { hash: { in: [] } },
      { size: { in: [] } },
      { createdAt: { in: [] } },
      { recordType: { in: [] } },
    ];

    for (const filter of filters) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter,
        signal,
      });

      // 検証：
      expect(actual.items).toStrictEqual([]);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("ハッシュの条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    const cases = [
      [HASH_K1, ["k1"]],
      [{ equals: HASH_K1 }, ["k1"]],
      [{ not: HASH_K1 }, ["k2", "k3"]],
      [{ in: [HASH_K1, HASH_K3] }, ["k1", "k3"]],
      [{ notIn: [HASH_K1, HASH_K3] }, ["k2"]],
      [{ contains: "2222" }, ["k2"]],
      [{ startsWith: "1" }, ["k1"]],
      [{ endsWith: "3" }, ["k3"]],
      [
        {
          endsWith: "2",
          startsWith: "2",
        },
        ["k2"],
      ],
    ] as const;

    for (const [hash, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { hash },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("サイズの条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    const cases = [
      [3, ["k1"]],
      [5n, ["k3"]],
      [{ equals: 8 }, ["k2"]],
      [{ equals: 5n }, ["k3"]],
      [{ not: 3 }, ["k2", "k3"]],
      [{ not: [3, 8] }, ["k3"]],
      [{ in: [3, 5] }, ["k1", "k3"]],
      [{ in: 8n }, ["k2"]],
      [{ notIn: [3, 8] }, ["k3"]],
      [{ lt: 5 }, ["k1"]],
      [{ lte: 5 }, ["k1", "k3"]],
      [{ gt: 5 }, ["k2"]],
      [{ gte: 5 }, ["k2", "k3"]],
      [
        {
          gt: 3n,
          lt: 8n,
        },
        ["k3"],
      ],
    ] as const;

    for (const [size, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { size },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("作成時刻の条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    const cases = [
      ["2026-01-01T00:00:00Z", ["k1"]],
      [{ equals: "2026-01-01T00:00:00Z" }, ["k1"]],
      [{ not: "2026-01-01T00:00:00Z" }, ["k2", "k3"]],
      [{ in: ["2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"] }, ["k1", "k3"]],
      [{ in: "2026-02-01T00:00:00Z" }, ["k2"]],
      [{ notIn: ["2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"] }, ["k2"]],
      [{ notIn: "2026-02-01T00:00:00Z" }, ["k1", "k3"]],
      [{ lt: "2026-02-01T00:00:00Z" }, ["k1"]],
      [{ lte: "2026-02-01T00:00:00Z" }, ["k1", "k2"]],
      [{ gt: "2026-02-01T00:00:00Z" }, ["k3"]],
      [{ gte: "2026-02-01T00:00:00Z" }, ["k2", "k3"]],
      [{ gt: new Date("2026-01-15T00:00:00Z") }, ["k2", "k3"]],
      [
        {
          gt: new Date("2026-01-15T00:00:00Z"),
          lte: new Date("2026-02-15T00:00:00Z"),
        },
        ["k2"],
      ],
    ] as const;

    for (const [createdAt, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { createdAt },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("更新時刻の条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    const cases = [
      ["2026-01-05T00:00:00Z", ["k1"]],
      [{ equals: "2026-01-05T00:00:00Z" }, ["k1"]],
      [{ not: "2026-01-05T00:00:00Z" }, ["k2", "k3"]],
      [{ in: ["2026-01-05T00:00:00Z", "2026-03-05T00:00:00Z"] }, ["k1", "k3"]],
      [{ in: "2026-02-05T00:00:00Z" }, ["k2"]],
      [{ notIn: ["2026-01-05T00:00:00Z", "2026-03-05T00:00:00Z"] }, ["k2"]],
      [{ notIn: "2026-02-05T00:00:00Z" }, ["k1", "k3"]],
      [{ lt: "2026-02-05T00:00:00Z" }, ["k1"]],
      [{ lte: "2026-02-05T00:00:00Z" }, ["k1", "k2"]],
      [{ gt: "2026-02-05T00:00:00Z" }, ["k3"]],
      [{ gte: "2026-02-05T00:00:00Z" }, ["k2", "k3"]],
      [{ gt: new Date("2026-01-15T00:00:00Z") }, ["k2", "k3"]],
      [
        {
          gt: new Date("2026-01-15T00:00:00Z"),
          lte: new Date("2026-02-15T00:00:00Z"),
        },
        ["k2"],
      ],
    ] as const;

    for (const [updatedAt, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { updatedAt },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("レコード時刻の条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    const cases = [
      ["2026-01-05T00:00:00Z", ["k1"]],
      [{ equals: "2026-01-05T00:00:00Z" }, ["k1"]],
      [{ not: "2026-01-05T00:00:00Z" }, ["k2", "k3"]],
      [{ in: ["2026-01-05T00:00:00Z", "2026-03-05T00:00:00Z"] }, ["k1", "k3"]],
      [{ in: "2026-02-05T00:00:00Z" }, ["k2"]],
      [{ notIn: ["2026-01-05T00:00:00Z", "2026-03-05T00:00:00Z"] }, ["k2"]],
      [{ notIn: "2026-02-05T00:00:00Z" }, ["k1", "k3"]],
      [{ lt: "2026-02-05T00:00:00Z" }, ["k1"]],
      [{ lte: "2026-02-05T00:00:00Z" }, ["k1", "k2"]],
      [{ gt: "2026-02-05T00:00:00Z" }, ["k3"]],
      [{ gte: "2026-02-05T00:00:00Z" }, ["k2", "k3"]],
      [{ gt: new Date("2026-01-15T00:00:00Z") }, ["k2", "k3"]],
      [
        {
          gt: new Date("2026-01-15T00:00:00Z"),
          lte: new Date("2026-02-15T00:00:00Z"),
        },
        ["k2"],
      ],
    ] as const;

    for (const [recordTimestamp, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { recordTimestamp },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("レコードタイプの条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);
    await index.updateMetadata({
      key: OmnioKey.parse("k2"),
      action: "updateMetadata",
      signal,
      metadata: { updatedAt: "2026-02-06T00:00:00Z" },
    });

    const cases = [
      ["CREATE", ["k1", "k3"]],
      ["UPDATE_METADATA", ["k2"]],
      [{ in: "CREATE" }, ["k1", "k3"]],
      [{ in: ["CREATE", "UPDATE_METADATA"] }, ["k1", "k2", "k3"]],
      [{ not: "UPDATE_METADATA" }, ["k1", "k3"]],
      [{ not: ["CREATE"] }, ["k2"]],
    ] as const;

    for (const [recordType, expected] of cases) {
      // 実行：
      const actual = await index.list({
        action: "list",
        filter: { recordType },
        signal,
      });

      // 検証：
      expect(keysOf(actual.items)).toStrictEqual(expected);
    }

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("全文で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    // 実行：
    const actual = await index.list({
      action: "list",
      filter: { fullText: "赤い" },
      signal,
    });

    // 検証：
    expect(keysOf(actual.items)).toStrictEqual(["k1", "k3"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});

describe("search", () => {
  test("類似度の降順で返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createVectorObject("a", new Float32Array([1, 0])),
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: createVectorObject("b", new Float32Array([0, 1])),
      signal,
    });

    // 実行：
    const actual = await index.search({
      topK: 10,
      action: "search",
      signal,
      vector: new Float32Array([1, 0]),
    });

    // 検証：
    expect(keysOf(actual)).toStrictEqual(["a", "b"]);
    expect(actual[0]?.score).toBeCloseTo(1);
    expect(actual[0]?.embedding).toStrictEqual(new Float32Array([1, 0]));

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("topK で件数を制限する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createVectorObject("a", new Float32Array([1, 0])),
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: createVectorObject("b", new Float32Array([0, 1])),
      signal,
    });

    // 実行：
    const actual = await index.search({
      topK: 1,
      action: "search",
      signal,
      vector: new Float32Array([1, 0]),
    });

    // 検証：
    expect(keysOf(actual)).toStrictEqual(["a"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("最小スコア未満を除外する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createVectorObject("a", new Float32Array([1, 0])),
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: createVectorObject("b", new Float32Array([0, 1])),
      signal,
    });

    // 実行：
    const actual = await index.search({
      topK: 10,
      action: "search",
      signal,
      vector: new Float32Array([1, 0]),
      minScore: 0.5,
    });

    // 検証：
    expect(keysOf(actual)).toStrictEqual(["a"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("数値オフセットの日時条件でベクトル検索を絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: {
        ...createVectorObject("a", new Float32Array([1, 0])),
        createdAt: "2026-01-01T09:00:00+0900",
        updatedAt: "2026-01-02T09:00:00+09",
      },
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: {
        ...createVectorObject("b", new Float32Array([1, 0])),
        createdAt: "2026-02-01T09:00:00+09",
        updatedAt: "2026-02-02T09:00:00+0900",
      },
      signal,
    });

    // 実行：
    const actual = await index.search({
      topK: 10,
      action: "search",
      filter: { createdAt: { equals: "2026-01-01T09:00:00+09" } },
      signal,
      vector: new Float32Array([1, 0]),
    });

    // 検証：
    expect(keysOf(actual)).toStrictEqual(["a"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("タグで候補を絞り込む", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createVectorObject("a", new Float32Array([1, 0]), ["wanted"]),
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: createVectorObject("b", new Float32Array([1, 0]), ["other"]),
      signal,
    });

    // 実行：
    const actual = await index.search({
      topK: 10,
      action: "search",
      filter: { tags: { hasSome: ["wanted"] } },
      signal,
      vector: new Float32Array([1, 0]),
    });

    // 検証：
    expect(keysOf(actual)).toStrictEqual(["a"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("モデル名が異なる記録と埋め込みなしの記録を除外する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createVectorObject("a", new Float32Array([1, 0])),
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: {
        ...createVectorObject("b", new Float32Array([1, 0])),
        embeddingModel: "other-model",
      },
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: {
        ...createObject("c"),
        embedding: undefined,
      },
      signal,
    });

    // 実行：
    const actual = await index.search({
      topK: 10,
      action: "search",
      signal,
      vector: new Float32Array([1, 0]),
      embeddingModel: "test-model",
    });

    // 検証：
    expect(keysOf(actual)).toStrictEqual(["a"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("topK が 0 以下または空ベクトルでは空の一覧を返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createObject("a"),
      signal,
    });

    // 実行：
    const byZeroTopK = await index.search({
      topK: 0,
      action: "search",
      signal,
      vector: new Float32Array([1, 0]),
    });
    const byEmptyVector = await index.search({
      topK: 10,
      action: "search",
      signal,
      vector: new Float32Array([]),
    });

    // 検証：
    expect(byZeroTopK).toStrictEqual([]);
    expect(byEmptyVector).toStrictEqual([]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("l2 距離では近い順に返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createVectorObject("a", new Float32Array([1, 0])),
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: createVectorObject("b", new Float32Array([0, 2])),
      signal,
    });

    // 実行：
    const actual = await index.search({
      topK: 10,
      action: "search",
      metric: "l2",
      signal,
      vector: new Float32Array([0, 0]),
    });

    // 検証：
    expect(keysOf(actual)).toStrictEqual(["a", "b"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("ゼロベクトルの cosine は NaN ではなく 0 を返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await index.upsert({
      action: "upsert",
      object: createVectorObject("a", new Float32Array([1, 0])),
      signal,
    });

    // 実行：
    const actual = await index.search({
      topK: 10,
      action: "search",
      signal,
      vector: new Float32Array([0, 0]),
    });

    // 検証：
    expect(actual[0]?.score).toBe(0);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});
describe("境界条件", () => {
  test("不正なカーソルは先頭から一覧する", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    await seedThree(index, signal);

    // 実行：
    const actual = await index.list({
      action: "list",
      cursor: "invalid",
      signal,
    });

    // 検証：
    expect(keysOf(actual.items)).toStrictEqual(["k1", "k2", "k3"]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("limit が 0 以下の listDirty は空の一覧を返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);

    // 実行：
    const actual = await index.listDirty({
      limit: 0,
      action: "listDirty",
      signal,
    });

    // 検証：
    expect(actual).toStrictEqual([]);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("省略可能なメタデータなしで保存と取得をする", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const base = createObject("k1");
    const object: OmnioObject = {
      ...base,
      description: undefined,
      embeddingModel: undefined,
      embeddingSource: undefined,
      hash: undefined,
      hashAlgorithm: undefined,
    };

    // 実行：
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });

    const actual = await index.get({
      key: object.key,
      action: "get",
      signal,
    });

    // 検証：
    expect(actual?.description).toBeUndefined();
    expect(actual?.embeddingModel).toBeUndefined();
    expect(actual?.embeddingSource).toBeUndefined();
    expect(actual?.hash).toBeUndefined();
    expect(actual?.hashAlgorithm).toBeUndefined();
    expect(actual?.embedding).toStrictEqual(object.embedding);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("循環参照の利用者メタデータは DbQueryError を投げる", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const metadata: Record<string, unknown> = {};
    metadata["self"] = metadata;

    // 実行と検証：
    await expect(
      index.upsert({
        action: "upsert",
        object: {
          ...createObject("k1"),
          userMetadata: metadata,
        },
        signal,
      }),
    ).rejects.toBeInstanceOf(DbQueryError);

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });

  test("同じキーへの rename はそのまま返す", async ({ expect, signal }) => {
    // 準備：
    const index = await createOpenedIndex(signal);
    const object = createObject("k1", ["a", "b"]);
    await index.upsert({
      action: "upsert",
      object,
      signal,
    });

    // 実行：
    const result = await index.rename({
      action: "rename",
      signal,
      sourceKey: object.key,
      updatedAt: "2026-02-01T00:00:00Z",
      destinationKey: object.key,
    });

    // 検証：
    expect(result?.object.key.key).toBe("k1");
    expect(result?.object.tags).toStrictEqual(["a", "b"]);
    expect(result?.replacedEntityId).toBeUndefined();

    // 後始末：
    await index.close({
      action: "close",
      signal,
    });
  });
});
