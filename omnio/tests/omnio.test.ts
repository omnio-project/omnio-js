import { type IEmbedder, OmnioKey, DbNotOpenError, InvalidOmnioKeyError } from "@omniojs/core";
import { SqliteWasmIndex } from "@omniojs/idx-sqlite.wasm";
import { Memory } from "@unikvs/memory";
import { type Value, UniKvs } from "unikvs";
import { test, describe } from "vite-plus/test";

import { Omnio } from "../src/omnio.js";

/**
 * 検証用の埋め込み器です。
 *
 * "cat" を含む文は [1, 0]、"dog" を含む文は [0, 1]、それ以外は正規化した中間値にします。
 * 外部への問い合わせはしないため、決定的に動作します。
 */
class FakeEmbedder implements IEmbedder {
  public readonly info = {
    dims: 2,
    name: "fake-model",
    modalities: ["text"],
    normalized: true,
    multilingual: false,
  } as const;

  public supports(c: IEmbedder.SupportsContext): boolean {
    return c.modality === "text";
  }

  public async embed(c: IEmbedder.EmbedContext): Promise<Float32Array> {
    if (c.input.kind !== "text") {
      throw new Error(`unsupported: ${c.input.kind}`);
    }

    return this.vectorFor(c.input.text);
  }

  public async embedMany(c: IEmbedder.EmbedManyContext): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];

    for (const input of c.inputs) {
      if (input.kind !== "text") {
        throw new Error(`unsupported: ${input.kind}`);
      }

      vectors.push(this.vectorFor(input.text));
    }

    return vectors;
  }

  public async embedText(c: IEmbedder.EmbedTextContext): Promise<Float32Array> {
    return this.vectorFor(c.text);
  }

  /**
   * テキストを検証用のベクトルに変換します。
   *
   * @param text 変換するテキストです。
   *
   * @returns 2 次元のベクトルです。
   */
  private vectorFor(text: string): Float32Array {
    if (text.includes("cat")) {
      return new Float32Array([1, 0]);
    }

    if (text.includes("dog")) {
      return new Float32Array([0, 1]);
    }

    return new Float32Array([Math.SQRT1_2, Math.SQRT1_2]);
  }
}

type TestMapping = Record<string, Value<Uint8Array>>;

/**
 * 検証用の Omnio を作ります。
 *
 * メモリー実体とメモリー索引、検証用埋め込み器を組み合わせます。
 *
 * @param signal 処理を中断するための中断シグナルです。
 *
 * @returns 開いた状態の Omnio です。
 */
async function createTestOmnio(signal: AbortSignal): Promise<Omnio> {
  const entity = UniKvs.config<TestMapping>().appendStorage(new Memory()).create();
  const index = new SqliteWasmIndex();
  const omnio = new Omnio({
    index,
    entity,
    embedder: new FakeEmbedder(),
  });
  await omnio.open(signal);

  return omnio;
}

/**
 * ストリームをすべて読み取って結合します。
 *
 * null の場合は空のバイト列を返します。
 * ストリーム取得結果の検証に使用します。
 *
 * @param source 読み取るストリームです。
 *
 * @returns 結合したバイト列です。
 */
async function readAll(source: AsyncIterable<Uint8Array> | null): Promise<Uint8Array> {
  if (source === null) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];

  for await (const chunk of source) {
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

describe("open と close", () => {
  test("開くと利用可能になり閉じると操作できない", async ({ expect, signal }) => {
    // 準備：
    const entity = UniKvs.config<TestMapping>().appendStorage(new Memory()).create();
    const omnio = new Omnio({
      index: new SqliteWasmIndex(),
      entity,
      embedder: new FakeEmbedder(),
    });

    // 実行と検証：
    expect(omnio.isOpen).toBe(false);
    await omnio.open(signal);
    expect(omnio.isOpen).toBe(true);
    await omnio.open(signal);
    expect(omnio.isOpen).toBe(true);
    await omnio.close(signal);
    expect(omnio.isOpen).toBe(false);
    await expect(
      omnio.putObject({
        key: "k",
        data: new Uint8Array([1]),
        contentType: "text/plain",
      }),
    ).rejects.toThrow(DbNotOpenError);
    await omnio.close(signal);
  });
});

describe("putObject と getObject", () => {
  test("保存したバイト列をそのまま取得する", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行：
    const stored = await omnio.putObject({
      key: "k1",
      data: new Uint8Array([1, 2, 3]),
      tags: ["pet"],
      contentType: "text/plain",
      description: "cat on the mat",
      userMetadata: { genre: "test" },
    });
    const actual = await omnio.getObject("k1", signal);
    const head = await omnio.headObject("k1", signal);

    // 検証：
    expect(actual).toStrictEqual(new Uint8Array([1, 2, 3]));
    expect(stored.key).toBeInstanceOf(OmnioKey);
    expect(stored.key.key).toBe("k1");
    expect(stored.system.contentType).toBe("text/plain");
    expect(stored.system.size).toBe(3);
    expect(stored.system.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(head?.description).toBe("cat on the mat");
    expect(head?.tags).toStrictEqual(["pet"]);
    expect(head?.userMetadata).toStrictEqual({ genre: "test" });
    expect(head?.embedding).toStrictEqual(new Float32Array([1, 0]));
    expect(head?.embeddingModel).toBe("fake-model");
    expect(head?.embeddingDims).toBe(2);

    // 後始末：
    await omnio.close(signal);
  });

  test("Blob とストリームを受け付ける", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行：
    await omnio.putObject({
      key: "b",
      data: new Blob([new Uint8Array([4, 5])]),
      contentType: "text/plain",
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new Uint8Array([6]));
        controller.enqueue(new Uint8Array([7, 8]));
        controller.close();
      },
    });
    await omnio.putObject({
      key: "s",
      data: stream,
      contentType: "application/octet-stream",
    });

    // 検証：
    expect(await omnio.getObject("b", signal)).toStrictEqual(new Uint8Array([4, 5]));
    expect(await omnio.getObject("s", signal)).toStrictEqual(new Uint8Array([6, 7, 8]));

    // 後始末：
    await omnio.close(signal);
  });

  test("存在しないキーは null を返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行と検証：
    expect(await omnio.getObject("missing", signal)).toBeNull();
    expect(await omnio.headObject("missing", signal)).toBeNull();
    expect(await omnio.streamObject("missing", signal)).toBeNull();

    // 後始末：
    await omnio.close(signal);
  });

  test("不正なキーは InvalidOmnioKeyError になる", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行と検証：
    await expect(
      omnio.putObject({
        key: "",
        data: new Uint8Array([1]),
        contentType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(InvalidOmnioKeyError);

    // 後始末：
    await omnio.close(signal);
  });

  test("上書きすると作成時刻を保つ", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const first = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    // 実行：
    const second = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1, 2]),
      contentType: "text/plain",
    });

    // 検証：
    expect(second.system.createdAt).toBe(first.system.createdAt);
    expect(await omnio.getObject("k", signal)).toStrictEqual(new Uint8Array([1, 2]));

    // 後始末：
    await omnio.close(signal);
  });

  test("embed を無効にすると埋め込みを作らない", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行：
    const stored = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      embed: false,
      contentType: "text/plain",
      description: "cat on the mat",
    });

    // 検証：
    expect(stored.embedding).toBeUndefined();

    // 後始末：
    await omnio.close(signal);
  });

  test("指定したベクトルをそのまま使う", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行：
    const stored = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      embedding: new Float32Array([0, 1]),
      contentType: "text/plain",
    });

    // 検証：
    expect(stored.embedding).toStrictEqual(new Float32Array([0, 1]));
    expect(stored.embeddingDims).toBe(2);

    // 後始末：
    await omnio.close(signal);
  });
});

describe("deleteObject", () => {
  test("削除すると取得できなくなる", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "b",
      data: new Uint8Array([2]),
      contentType: "text/plain",
    });

    // 実行：
    const deleted = await omnio.deleteObject("a", signal);

    // 検証：
    expect(deleted).toBe(true);

    expect(await omnio.getObject("a", signal)).toBeNull();
    expect(await omnio.deleteObject("a", signal)).toBe(false);

    // 後始末：
    await omnio.close(signal);
  });
});

describe("listObjects", () => {
  test("limit と cursor でページ分けする", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "b",
      data: new Uint8Array([2]),
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "c",
      data: new Uint8Array([3]),
      contentType: "text/plain",
    });

    // 実行：
    const first = await omnio.listObjects({ limit: 2 }, signal);
    const second = await omnio.listObjects(
      {
        limit: 2,
        cursor: first.nextCursor,
      },
      signal,
    );

    // 検証：
    expect(first.items.map((item) => item.key.key)).toStrictEqual(["a", "b"]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map((item) => item.key.key)).toStrictEqual(["c"]);
    expect(second.nextCursor).toBeNull();

    // 後始末：
    await omnio.close(signal);
  });
});

describe("searchObjects", () => {
  test("自然言語で類似順に返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
      description: "cat on the mat",
    });
    await omnio.putObject({
      key: "b",
      data: new Uint8Array([2]),
      contentType: "text/plain",
      description: "dog in the park",
    });
    await omnio.putObject({
      key: "c",
      data: new Uint8Array([3]),
      contentType: "text/plain",
      description: "plants in the garden",
    });

    // 実行：
    const actual = await omnio.searchObjects({
      topK: 10,
      query: { text: "my cat" },
      signal,
    });

    // 検証：
    expect(actual.map((item) => item.key.key)).toStrictEqual(["a", "c", "b"]);
    expect(actual[0]?.score).toBeCloseTo(1, 4);

    // 後始末：
    await omnio.close(signal);
  });

  test("topK と minScore で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
      description: "cat on the mat",
    });
    await omnio.putObject({
      key: "b",
      data: new Uint8Array([2]),
      contentType: "text/plain",
      description: "dog in the park",
    });

    // 実行と検証：
    const top = await omnio.searchObjects({
      topK: 1,
      query: { text: "my cat" },
      signal,
    });
    expect(top.map((item) => item.key.key)).toStrictEqual(["a"]);

    const filtered = await omnio.searchObjects({
      topK: 10,
      query: { text: "my cat" },
      filter: undefined,
      signal,
      minScore: 0.9,
    });
    expect(filtered.map((item) => item.key.key)).toStrictEqual(["a"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("タグで事前に絞り込む", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      tags: ["pet"],
      contentType: "text/plain",
      description: "cat on the mat",
    });
    await omnio.putObject({
      key: "b",
      data: new Uint8Array([2]),
      tags: ["wild"],
      contentType: "text/plain",
      description: "wild cat",
    });

    // 実行：
    const actual = await omnio.searchObjects({
      query: { text: "cat" },
      filter: { tagsAny: ["wild"] },
      signal,
    });

    // 検証：
    expect(actual.map((item) => item.key.key)).toStrictEqual(["b"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("includeEmbedding を無効にすると埋め込みを省く", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
      description: "cat on the mat",
    });

    // 実行：
    const actual = await omnio.searchObjects({
      query: { text: "cat" },
      signal,
      includeEmbedding: false,
    });

    // 検証：
    expect(actual).not.toHaveLength(0);
    expect(actual[0]?.embedding).toBeUndefined();

    // 後始末：
    await omnio.close(signal);
  });
});

describe("streamObject", () => {
  test("ストリームで取得する", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const expected = new Uint8Array([1, 2, 3, 4]);
    await omnio.putObject({
      key: "k",
      data: expected,
      contentType: "application/octet-stream",
    });

    // 実行：
    const stream = await omnio.streamObject("k", signal);

    // 検証：
    expect(stream).not.toBeNull();
    expect(await readAll(stream)).toStrictEqual(expected);

    // 後始末：
    await omnio.close(signal);
  });
});

describe("reindexObject", () => {
  test("説明文から埋め込みを作り直す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      embed: false,
      contentType: "text/plain",
      description: "cat on the mat",
    });

    // 実行：
    const actual = await omnio.reindexObject("k", signal);
    const head = await omnio.headObject("k", signal);

    // 検証：
    expect(actual?.embedding).toStrictEqual(new Float32Array([1, 0]));
    expect(actual?.embeddingModel).toBe("fake-model");
    expect(head?.embedding).toStrictEqual(new Float32Array([1, 0]));

    // 後始末：
    await omnio.close(signal);
  });

  test("存在しないキーは null を返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行と検証：
    expect(await omnio.reindexObject("missing", signal)).toBeNull();

    // 後始末：
    await omnio.close(signal);
  });

  test("説明文がない場合はそのまま返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    // 実行：
    const actual = await omnio.reindexObject("k", signal);

    // 検証：
    expect(actual?.embedding).toBeUndefined();

    // 後始末：
    await omnio.close(signal);
  });
});
