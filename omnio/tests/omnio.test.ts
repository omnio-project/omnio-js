import {
  type IEmbedder,
  type IndexedObject,
  OmnioKey,
  DbNotOpenError,
  InvalidOmnioKeyError,
  OperationAbortedError,
} from "@omniojs/core";
import { SqliteWasmIndex } from "@omniojs/idx-sqlite.wasm";
import { ChecksumSha256 } from "@unikvs/checksum";
import { Memory } from "@unikvs/memory";
import * as unikvs from "unikvs";
import { ValiError } from "valibot";
import { vi, test, describe } from "vite-plus/test";

import type { IOmnioEntity, IOmnioEntityBuilder } from "../src/entity.js";
import { Omnio } from "../src/omnio.js";

/**
 * 検証用の埋め込み器です。
 *
 * "cat" を含む文は [1, 0]、"dog" を含む文は [0, 1]、それ以外は正規化した中間値にします。
 * 画像はすべて [1, 0] にします。外部への問い合わせはしないため、決定的に動作します。
 */
class FakeEmbedder implements IEmbedder {
  public readonly info = {
    dims: 2,
    name: "fake-model",
    modalities: ["text", "image"],
    normalized: true,
    multilingual: false,
  } as const;

  public supports(c: IEmbedder.SupportsContext): boolean {
    return c.modality === "text" || c.modality === "image";
  }

  public async embed(c: IEmbedder.EmbedContext): Promise<Float32Array> {
    if (c.input.kind === "text") {
      return this.#vectorFor(c.input.text);
    }

    if (c.input.kind === "image") {
      return new Float32Array([1, 0]);
    }

    const kind: string = (c.input as { kind: string }).kind;

    throw new Error(`unsupported: ${kind}`);
  }

  public async embedMany(c: IEmbedder.EmbedManyContext): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];

    for (const input of c.inputs) {
      if (input.kind === "text") {
        vectors.push(this.#vectorFor(input.text));

        continue;
      }

      if (input.kind === "image") {
        vectors.push(new Float32Array([1, 0]));

        continue;
      }

      const kind: string = (input as { kind: string }).kind;

      throw new Error(`unsupported: ${kind}`);
    }

    return vectors;
  }

  public async embedText(c: IEmbedder.EmbedTextContext): Promise<Float32Array> {
    return this.#vectorFor(c.text);
  }

  /**
   * テキストを検証用のベクトルに変換します。
   *
   * @param text 変換するテキストです。
   *
   * @returns 2 次元のベクトルです。
   */
  #vectorFor(text: string): Float32Array {
    if (text.includes("cat")) {
      return new Float32Array([1, 0]);
    }

    if (text.includes("dog")) {
      return new Float32Array([0, 1]);
    }

    return new Float32Array([Math.SQRT1_2, Math.SQRT1_2]);
  }
}

type TestMapping = Record<string, unikvs.Value<Uint8Array>>;

/**
 * 検証用の実体ストレージーのビルダーを作ります。
 *
 * メモリー上にバイト列を保存します。
 *
 * @returns 開く前の実体ストレージーを構築するビルダーです。
 */
function createTestEntityBuilder(): IOmnioEntityBuilder {
  return new unikvs.Builder<TestMapping>().persist(new Memory());
}

/**
 * 構築後の実体ストレージーを検証できるようにしたビルダーを作ります。
 *
 * `Omnio` が構築する実体ストレージーをテストから直接操作する場合に使います。
 *
 * @returns 実体ストレージーを取得する関数と、そのビルダーです。
 */
function createInspectableTestEntity(): {
  builder: IOmnioEntityBuilder;
  getEntity: () => IOmnioEntity;
} {
  const builder = new unikvs.Builder<TestMapping>().persist(new Memory());
  let entity: IOmnioEntity | undefined;

  return {
    builder: {
      build: (options) => {
        entity = builder.build(options);

        return entity;
      },
    },
    getEntity: () => {
      if (entity === undefined) {
        throw new Error("実体ストレージーがまだ構築されていません。");
      }

      return entity;
    },
  };
}

/**
 * 検証用の Omnio を作ります。
 *
 * メモリー実体とメモリー索引、検証用埋め込み器を組み合わせます。
 *
 * @param signal 処理を中断するための中断シグナルです。
 * @param index 検証に使うインデックスです。省略時は新しい索引を作ります。
 * @param entity 検証に使う実体ストレージーのビルダーです。省略時は新しいビルダーを作ります。
 *
 * @returns 開いた状態の Omnio です。
 */
async function createTestOmnio(
  signal: AbortSignal,
  index: SqliteWasmIndex = new SqliteWasmIndex(),
  entity: IOmnioEntityBuilder = createTestEntityBuilder(),
): Promise<Omnio> {
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

/**
 * ReadableStream を継承せずにインターフェースだけを満たすオブジェクトを作ります。
 *
 * @param source 元になる ReadableStream です。
 *
 * @returns ReadableStream のインターフェースを満たすオブジェクトです。
 */
function createReadableStreamLike(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return new Proxy(source, {
    get(target, property): unknown {
      const value = Reflect.get(target, property, target);

      return typeof value === "function" ? value.bind(target) : value;
    },
    getPrototypeOf: (): object => Object.prototype,
  });
}

/**
 * オブジェクトのハッシュ値を取り出します。
 *
 * ハッシュ値が必ず存在することを前提にした検証で使用します。
 *
 * @param object ハッシュ値を持つオブジェクトです。
 *
 * @returns ハッシュ値です。
 */
function hashOf(object: IndexedObject): string {
  const hash = object.hash;

  if (hash === undefined) {
    throw new Error("ハッシュ値がありません。");
  }

  return hash;
}

describe("コンストラクター", () => {
  test("不正なオプションは ValiError を投げる", ({ expect }) => {
    // 準備：
    const entity = createTestEntityBuilder();
    const embedder = new FakeEmbedder();

    // 実行と検証：
    expect(() => new Omnio({} as never)).toThrow(ValiError);
    expect(
      () =>
        new Omnio({
          index: {} as never,
          entity,
          embedder,
        }),
    ).toThrow(ValiError);
  });

  test("実体ビルダーの build を実行する", ({ expect }) => {
    // 準備：
    const entity = new unikvs.Builder<TestMapping>().persist(new Memory()).build();
    const build = vi.fn<IOmnioEntityBuilder["build"]>(() => entity);
    const builder: IOmnioEntityBuilder = { build };

    // 実行：
    const omnio = new Omnio({
      index: new SqliteWasmIndex(),
      entity: builder,
      embedder: new FakeEmbedder(),
    });

    // 検証：
    expect(build).toHaveBeenCalledOnce();
    expect(build.mock.calls[0]?.[0]?.beforeAll?.[0]).toBeInstanceOf(ChecksumSha256);
    expect(omnio.isOpen).toBe(false);
  });
});

describe("open と close", () => {
  test("開くと利用可能になり閉じると操作できない", async ({ expect, signal }) => {
    // 準備：
    const entity = new unikvs.Builder<TestMapping>().persist(new Memory());
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

  test("close すると既定のシグナルで実行中の操作を中断する", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index);
    const started = Promise.withResolvers<AbortSignal>();
    using _get = vi.spyOn(index, "get").mockImplementation((c) => {
      started.resolve(c.signal);

      return new Promise<never>((_, reject) => {
        c.signal.addEventListener(
          "abort",
          () => {
            reject(c.signal.reason);
          },
          { once: true },
        );
      });
    });

    // 実行：
    const loading = omnio.headObject("missing");
    const active = await started.promise;
    expect(active.aborted).toBe(false);

    const closing = omnio.close();

    expect(active.aborted).toBe(true);

    // 検証：
    expect(active.reason).toBeInstanceOf(OperationAbortedError);
    await expect(loading).rejects.toBeInstanceOf(OperationAbortedError);
    await closing;
    expect(omnio.isOpen).toBe(false);
  });

  test("明示シグナルで実行中の操作を中断する", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index);
    const started = Promise.withResolvers<AbortSignal>();
    using _get = vi.spyOn(index, "get").mockImplementation((c) => {
      started.resolve(c.signal);

      return new Promise<never>((_, reject) => {
        c.signal.addEventListener(
          "abort",
          () => {
            reject(c.signal.reason);
          },
          { once: true },
        );
      });
    });
    const controller = new AbortController();
    const reason = new OperationAbortedError();

    // 実行：
    const loading = omnio.headObject("missing", controller.signal);
    const active = await started.promise;
    expect(active.aborted).toBe(false);
    controller.abort(reason);

    // 検証：
    expect(active.aborted).toBe(true);
    expect(active.reason).toBe(reason);
    await expect(loading).rejects.toBe(reason);

    // 後始末：
    await omnio.close(signal);
  });

  test("明示シグナル付きの操作も close で中断する", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index);
    const started = Promise.withResolvers<AbortSignal>();
    using _get = vi.spyOn(index, "get").mockImplementation((c) => {
      started.resolve(c.signal);

      return new Promise<never>((_, reject) => {
        c.signal.addEventListener(
          "abort",
          () => {
            reject(c.signal.reason);
          },
          { once: true },
        );
      });
    });
    const controller = new AbortController();

    // 実行：
    const loading = omnio.headObject("missing", controller.signal);
    const active = await started.promise;
    expect(active.aborted).toBe(false);

    const closing = omnio.close();

    // 検証：
    expect(active.aborted).toBe(true);
    expect(active.reason).toBeInstanceOf(OperationAbortedError);
    expect(controller.signal.aborted).toBe(false);
    await expect(loading).rejects.toBeInstanceOf(OperationAbortedError);
    await closing;
    expect(omnio.isOpen).toBe(false);
  });

  test("閉じて開き直すと既定のシグナルで再び操作できる", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行：
    await omnio.close(signal);
    await omnio.open(signal);

    const stored = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    // 検証：
    expect(stored.key.key).toBe("k");

    // 後始末：
    await omnio.close(signal);
  });
});

describe("排他制御", () => {
  test("読み取り操作は並行して実行できる", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index);
    const firstStarted = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    using get = vi
      .spyOn(index, "get")
      .mockImplementationOnce(async () => {
        firstStarted.resolve();
        await secondStarted.promise;

        return null;
      })
      .mockImplementationOnce(async () => {
        secondStarted.resolve();
        await firstStarted.promise;

        return null;
      });

    // 実行：
    const [first, second] = await Promise.all([
      omnio.headObject("a", signal),
      omnio.headObject("b", signal),
    ]);

    // 検証：
    expect(get).toHaveBeenCalledTimes(2);
    expect(first).toBeNull();
    expect(second).toBeNull();

    // 後始末：
    await omnio.close(signal);
  });

  test("close は実行中の操作の完了を待つ", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index);
    const release = Promise.withResolvers<void>();
    using _get = vi.spyOn(index, "get").mockImplementation(async () => {
      await release.promise;

      return null;
    });

    // 実行：
    const loading = omnio.headObject("k", signal);
    const closing = omnio.close(signal);
    const opening = omnio.isOpen;
    release.resolve();
    await loading;
    await closing;

    // 検証：
    expect(opening).toBe(true);
    expect(omnio.isOpen).toBe(false);
  });
});

describe("dirty 再インデックス", () => {
  test("open 時に古いモデルの埋め込みをバックグラウンドで作り直す", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    await index.open({
      action: "open",
      signal,
    });
    await index.upsert({
      action: "upsert",
      object: {
        key: OmnioKey.parse("k"),
        size: 3,
        tags: ["pet"],
        entityId: crypto.randomUUID(),
        createdAt: "2026-01-01T00:00:00Z",
        embedding: new Float32Array([0, 1]),
        updatedAt: "2026-01-01T00:00:00Z",
        contentType: "text/plain",
        description: "cat on the mat",
        userMetadata: {},
        embeddingDims: 2,
        embeddingModel: "old-model",
        embeddingSource: {
          kind: "description",
          model: "old-model",
        },
      },
      signal,
    });

    const omnio = new Omnio({
      index,
      entity: createTestEntityBuilder(),
      embedder: new FakeEmbedder(),
    });

    // 実行：
    await omnio.open(signal);
    await vi.waitFor(
      async () => {
        const head = await omnio.headObject("k", signal);
        expect(head?.embeddingModel).toBe("fake-model");
        expect(head?.embedding).toStrictEqual(new Float32Array([1, 0]));

        const actual = await omnio.searchObjects({
          topK: 10,
          query: { text: "cat" },
          signal,
        });
        expect(actual.map((item) => item.key.key)).toStrictEqual(["k"]);
      },
      { timeout: 5000 },
    );

    // 検証：
    const head = await omnio.headObject("k", signal);
    expect(head?.embeddingSource).toStrictEqual({
      kind: "description",
      model: "fake-model",
    });

    // 後始末：
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
    expect(stored.contentType).toBe("text/plain");
    expect(stored.size).toBe(3);
    expect(stored.hash).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    expect(stored.hashAlgorithm).toBe("sha256");
    expect(head?.description).toBe("cat on the mat");
    expect(head?.hashAlgorithm).toBe("sha256");
    expect(head?.tags).toStrictEqual(["pet"]);
    expect(head?.userMetadata).toStrictEqual({ genre: "test" });
    expect(head?.embedding).toStrictEqual(new Float32Array([1, 0]));
    expect(head?.embeddingModel).toBe("fake-model");
    expect(head?.embeddingDims).toBe(2);
    expect(head?.embeddingSource).toStrictEqual({
      kind: "description",
      model: "fake-model",
    });

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

  test("ReadableStream のインターフェースを持つオブジェクトを受け付ける", async ({
    expect,
    signal,
  }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new Uint8Array([9, 10]));
        controller.close();
      },
    });
    // ReadableStream を継承しないが、インターフェースを満たすオブジェクトを作ります。
    const stream = createReadableStreamLike(source);

    // 実行：
    await omnio.putObject({
      key: "s",
      data: stream,
      contentType: "application/octet-stream",
    });

    // 検証：
    expect(stream).not.toBeInstanceOf(ReadableStream);
    expect(await omnio.getObject("s", signal)).toStrictEqual(new Uint8Array([9, 10]));

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
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.entityId).toBe(first.entityId);
    expect(await omnio.getObject("k", signal)).toStrictEqual(new Uint8Array([1, 2]));

    // 後始末：
    await omnio.close(signal);
  });

  test("実体は UUID の entityId をキーに保存する", async ({ expect, signal }) => {
    // 準備：
    const { builder, getEntity } = createInspectableTestEntity();
    const omnio = await createTestOmnio(signal, new SqliteWasmIndex(), builder);

    // 実行：
    const stored = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1, 2, 3]),
      contentType: "text/plain",
    });

    // 検証：
    expect(stored.entityId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(await getEntity().get(stored.entityId)).toStrictEqual(new Uint8Array([1, 2, 3]));
    await expect(getEntity().get("k")).rejects.toBeInstanceOf(unikvs.KeyNotFoundError);

    // 後始末：
    await omnio.close(signal);
  });

  test("実体を参照するときは entityId だけを使う", async ({ expect, signal }) => {
    // 準備：
    const { builder, getEntity } = createInspectableTestEntity();
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index, builder);
    const entityId = crypto.randomUUID();
    const bytes = new Uint8Array([1, 2, 3]);
    await index.upsert({
      action: "upsert",
      object: {
        key: OmnioKey.parse("legacy"),
        size: bytes.byteLength,
        tags: [],
        entityId,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        contentType: "text/plain",
        userMetadata: {},
      },
      signal,
    });
    await getEntity().set("legacy", bytes, { signal });

    // 実行：
    const actual = await omnio.getObject("legacy", signal);
    const stream = await omnio.streamObject("legacy", signal);

    // 検証：
    expect(actual).toBeNull();
    expect(stream).toBeNull();

    expect(await getEntity().has("legacy")).toBe(true);
    expect(await getEntity().has(entityId)).toBe(false);

    // 後始末：
    await omnio.close(signal);
  });

  test("上書きの索引保存に失敗したら既存の実体とメタデータを残す", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index);
    await omnio.putObject({
      key: "k",
      data: new Uint8Array([1, 2, 3]),
      contentType: "text/plain",
      description: "cat on the mat",
      userMetadata: { version: 1 },
    });

    const failure = new Error("upsert failed");
    using _upsert = vi.spyOn(index, "upsert").mockRejectedValueOnce(failure);

    // 実行と検証：
    await expect(
      omnio.putObject({
        key: "k",
        data: new Uint8Array([9]),
        contentType: "application/octet-stream",
        description: "dog in the park",
        userMetadata: { version: 2 },
      }),
    ).rejects.toBe(failure);

    expect(await omnio.getObject("k", signal)).toStrictEqual(new Uint8Array([1, 2, 3]));

    const head = await omnio.headObject("k", signal);
    expect(head?.description).toBe("cat on the mat");
    expect(head?.contentType).toBe("text/plain");
    expect(head?.userMetadata).toStrictEqual({ version: 1 });
    expect(head?.embedding).toStrictEqual(new Float32Array([1, 0]));

    // 後始末：
    await omnio.close(signal);
  });

  test("新規キーの索引保存に失敗したら実体を残さない", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index);
    const failure = new Error("upsert failed");
    using _upsert = vi.spyOn(index, "upsert").mockRejectedValueOnce(failure);

    // 実行と検証：
    await expect(
      omnio.putObject({
        key: "fresh",
        data: new Uint8Array([1]),
        contentType: "text/plain",
      }),
    ).rejects.toBe(failure);
    expect(await omnio.getObject("fresh", signal)).toBeNull();
    expect(await omnio.headObject("fresh", signal)).toBeNull();

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

  test("コンテンツタイプを小文字に正規化する", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行：
    const stored = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      contentType: "Text/Plain",
    });

    // 検証：
    expect(stored.contentType).toBe("text/plain");

    // 後始末：
    await omnio.close(signal);
  });

  test("不正な保存入力を ValiError にする", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const tags = Array.from({ length: 11 }, (_, index) => `tag-${index}`);

    // 実行と検証：
    await expect(
      omnio.putObject({
        key: "k",
        data: "invalid" as never,
        contentType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(ValiError);
    await expect(
      omnio.putObject({
        key: "k",
        data: new Uint8Array([1]),
        tags,
        contentType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(ValiError);

    // 後始末：
    await omnio.close(signal);
  });
});

describe("copyObject", () => {
  test("実体とメタデータを複製する", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const source = await omnio.putObject({
      key: "source",
      data: new Uint8Array([1, 2, 3]),
      tags: ["pet"],
      contentType: "text/plain",
      description: "cat on the mat",
      userMetadata: { genre: "test" },
    });

    // 実行：
    const copied = await omnio.copyObject("source", "dest", signal);

    // 検証：
    expect(copied?.key.key).toBe("dest");
    expect(copied?.entityId).not.toBe(source.entityId);
    expect(copied?.size).toBe(source.size);
    expect(copied?.hash).toBe(source.hash);
    expect(copied?.hashAlgorithm).toBe(source.hashAlgorithm);
    expect(copied?.contentType).toBe(source.contentType);
    expect(copied?.description).toBe(source.description);
    expect(copied?.tags).toStrictEqual(source.tags);
    expect(copied?.userMetadata).toStrictEqual(source.userMetadata);
    expect(copied?.embedding).toStrictEqual(source.embedding);
    expect(await omnio.getObject("source", signal)).toStrictEqual(new Uint8Array([1, 2, 3]));
    expect(await omnio.getObject("dest", signal)).toStrictEqual(new Uint8Array([1, 2, 3]));

    // 後始末：
    await omnio.close(signal);
  });

  test("複製先が存在する場合は上書きする", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "source",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    const destination = await omnio.putObject({
      key: "dest",
      data: new Uint8Array([9]),
      contentType: "application/octet-stream",
      userMetadata: { version: 1 },
    });

    // 実行：
    const copied = await omnio.copyObject("source", "dest", signal);

    // 検証：
    expect(copied?.entityId).toBe(destination.entityId);
    expect(copied?.createdAt).toBe(destination.createdAt);
    expect(copied?.contentType).toBe("text/plain");
    expect(copied?.userMetadata).toStrictEqual({});

    expect(await omnio.getObject("dest", signal)).toStrictEqual(new Uint8Array([1]));

    // 後始末：
    await omnio.close(signal);
  });

  test("同じキーを指定した場合は元のオブジェクトを返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const source = await omnio.putObject({
      key: "source",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    // 実行：
    const copied = await omnio.copyObject("source", "source", signal);

    // 検証：
    expect(copied).toStrictEqual(source);

    // 後始末：
    await omnio.close(signal);
  });

  test("複製元が存在しない場合は null を返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行と検証：
    expect(await omnio.copyObject("missing", "dest", signal)).toBeNull();
    expect(await omnio.hasObject("dest", signal)).toBe(false);

    // 後始末：
    await omnio.close(signal);
  });

  test("複製元の実体が存在しない場合は null を返す", async ({ expect, signal }) => {
    // 準備：
    const { builder, getEntity } = createInspectableTestEntity();
    const omnio = await createTestOmnio(signal, new SqliteWasmIndex(), builder);
    const source = await omnio.putObject({
      key: "source",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "dest",
      data: new Uint8Array([9]),
      contentType: "text/plain",
    });
    await getEntity().delete(source.entityId);

    // 実行と検証：
    expect(await omnio.copyObject("source", "dest", signal)).toBeNull();
    expect(await omnio.getObject("dest", signal)).toStrictEqual(new Uint8Array([9]));

    // 後始末：
    await omnio.close(signal);
  });

  test("索引保存に失敗したら複製先の実体を元に戻す", async ({ expect, signal }) => {
    // 準備：
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index);
    await omnio.putObject({
      key: "source",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "dest",
      data: new Uint8Array([9]),
      contentType: "text/plain",
    });

    const failure = new Error("upsert failed");
    using _upsert = vi.spyOn(index, "upsert").mockRejectedValueOnce(failure);

    // 実行と検証：
    await expect(omnio.copyObject("source", "dest", signal)).rejects.toBe(failure);

    expect(await omnio.getObject("dest", signal)).toStrictEqual(new Uint8Array([9]));

    // 後始末：
    await omnio.close(signal);
  });
});

describe("renameObject", () => {
  test("キーを変更し、実体とメタデータを維持する", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const source = await omnio.putObject({
      key: "source",
      data: new Uint8Array([1, 2, 3]),
      tags: ["pet"],
      contentType: "text/plain",
      description: "cat on the mat",
      userMetadata: { genre: "test" },
    });

    // 実行：
    const renamed = await omnio.renameObject("source", "dest", signal);

    // 検証：
    expect(renamed?.key.key).toBe("dest");
    expect(renamed?.entityId).toBe(source.entityId);
    expect(renamed?.createdAt).toBe(source.createdAt);
    expect(renamed?.size).toBe(source.size);
    expect(renamed?.hash).toBe(source.hash);
    expect(renamed?.hashAlgorithm).toBe(source.hashAlgorithm);
    expect(renamed?.contentType).toBe(source.contentType);
    expect(renamed?.description).toBe(source.description);
    expect(renamed?.tags).toStrictEqual(source.tags);
    expect(renamed?.userMetadata).toStrictEqual(source.userMetadata);
    expect(await omnio.getObject("source", signal)).toBeNull();
    expect(await omnio.getObject("dest", signal)).toStrictEqual(new Uint8Array([1, 2, 3]));
    expect(await omnio.hasObject("source", signal)).toBe(false);
    expect(await omnio.hasObject("dest", signal)).toBe(true);

    // 後始末：
    await omnio.close(signal);
  });

  test("変更先が存在する場合は上書きし、変更先の実体を削除する", async ({ expect, signal }) => {
    // 準備：
    const { builder, getEntity } = createInspectableTestEntity();
    const omnio = await createTestOmnio(signal, new SqliteWasmIndex(), builder);
    const source = await omnio.putObject({
      key: "source",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });
    const destination = await omnio.putObject({
      key: "dest",
      data: new Uint8Array([9]),
      contentType: "application/octet-stream",
      userMetadata: { version: 1 },
    });

    // 実行：
    const renamed = await omnio.renameObject("source", "dest", signal);

    // 検証：
    expect(renamed?.entityId).toBe(source.entityId);
    expect(renamed?.createdAt).toBe(source.createdAt);
    expect(renamed?.contentType).toBe("text/plain");
    expect(renamed?.userMetadata).toStrictEqual({});
    expect(await omnio.getObject("dest", signal)).toStrictEqual(new Uint8Array([1]));
    expect(await getEntity().has(source.entityId)).toBe(true);
    await vi.waitFor(async () => {
      expect(await getEntity().has(destination.entityId)).toBe(false);
    });

    // 後始末：
    await omnio.close(signal);
  });

  test("同じキーを指定した場合は元のオブジェクトを返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const source = await omnio.putObject({
      key: "source",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    // 実行：
    const renamed = await omnio.renameObject("source", "source", signal);

    // 検証：
    expect(renamed).toStrictEqual(source);

    // 後始末：
    await omnio.close(signal);
  });

  test("変更元が存在しない場合は null を返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "dest",
      data: new Uint8Array([9]),
      contentType: "text/plain",
    });

    // 実行と検証：
    expect(await omnio.renameObject("missing", "dest", signal)).toBeNull();
    expect(await omnio.getObject("dest", signal)).toStrictEqual(new Uint8Array([9]));

    // 後始末：
    await omnio.close(signal);
  });
});

describe("updateObjectMetadata", () => {
  test("変更可能なメタデータだけを更新する", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const first = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1, 2, 3]),
      tags: ["old"],
      contentType: "text/plain",
      description: "cat on the mat",
      userMetadata: { version: 1 },
    });

    // 実行：
    const updated = await omnio.updateObjectMetadata({
      key: "k",
      tags: [],
      signal,
      contentType: "application/json",
      description: "dog in the park",
      userMetadata: { version: 2 },
    });

    // 検証：
    expect(updated?.entityId).toBe(first.entityId);
    expect(updated?.size).toBe(first.size);
    expect(updated?.hash).toBe(first.hash);
    expect(updated?.hashAlgorithm).toBe(first.hashAlgorithm);
    expect(updated?.createdAt).toBe(first.createdAt);
    expect(updated?.contentType).toBe("application/json");
    expect(updated?.description).toBe("dog in the park");
    expect(updated?.tags).toStrictEqual([]);
    expect(updated?.userMetadata).toStrictEqual({ version: 2 });
    expect(await omnio.getObject("k", signal)).toStrictEqual(new Uint8Array([1, 2, 3]));
    expect(await omnio.headObject("k", signal)).toStrictEqual(updated);

    // 後始末：
    await omnio.close(signal);
  });

  test("省略した項目は変更しない", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      tags: ["pet"],
      contentType: "text/plain",
      description: "cat on the mat",
      userMetadata: { version: 1 },
    });

    // 実行：
    const updated = await omnio.updateObjectMetadata({
      key: "k",
      signal,
      userMetadata: { version: 2 },
    });

    // 検証：
    expect(updated?.contentType).toBe("text/plain");
    expect(updated?.description).toBe("cat on the mat");
    expect(updated?.tags).toStrictEqual(["pet"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("実体に由来する項目は更新できない", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const first = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1, 2, 3]),
      contentType: "text/plain",
    });

    // 実行：
    const updated = await omnio.updateObjectMetadata({
      key: "k",
      hash: "invalid",
      size: 999,
      entityId: "changed",
      createdAt: "2000-01-01T00:00:00Z",
      userMetadata: { version: 2 },
      hashAlgorithm: "md5",
    } as never);

    // 検証：
    expect(updated?.size).toBe(first.size);
    expect(updated?.hash).toBe(first.hash);
    expect(updated?.hashAlgorithm).toBe(first.hashAlgorithm);
    expect(updated?.createdAt).toBe(first.createdAt);
    expect(updated?.entityId).toBe(first.entityId);

    // 後始末：
    await omnio.close(signal);
  });

  test("存在しないキーは null を返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行と検証：
    expect(
      await omnio.updateObjectMetadata({
        key: "missing",
        signal,
        userMetadata: { version: 1 },
      }),
    ).toBeNull();

    // 後始末：
    await omnio.close(signal);
  });
});

describe("hasObject", () => {
  test("索引に存在するかを返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行と検証：
    expect(await omnio.hasObject("k", signal)).toBe(false);
    await omnio.putObject({
      key: "k",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });
    expect(await omnio.hasObject("k", signal)).toBe(true);
    await omnio.deleteObject("k", signal);
    expect(await omnio.hasObject("k", signal)).toBe(false);

    // 後始末：
    await omnio.close(signal);
  });

  test("実体ストレージーは参照しない", async ({ expect, signal }) => {
    // 準備：
    const { builder, getEntity } = createInspectableTestEntity();
    const omnio = await createTestOmnio(signal, new SqliteWasmIndex(), builder);
    const stored = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1, 2, 3]),
      contentType: "text/plain",
    });
    await getEntity().delete(stored.entityId, { signal });

    // 実行と検証：
    expect(await omnio.getObject("k", signal)).toBeNull();
    expect(await omnio.hasObject("k", signal)).toBe(true);

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

  test("実体はバックグラウンドで削除し、完了後に索引からも消える", async ({ expect, signal }) => {
    // 準備：
    const { builder, getEntity } = createInspectableTestEntity();
    const index = new SqliteWasmIndex();
    const omnio = await createTestOmnio(signal, index, builder);
    const stored = await omnio.putObject({
      key: "k",
      data: new Uint8Array([1, 2, 3]),
      contentType: "text/plain",
    });
    const purged = Promise.withResolvers<void>();
    const originalPurge = index.purge.bind(index);
    using _purge = vi.spyOn(index, "purge").mockImplementation(async (c) => {
      const result = await originalPurge(c);

      purged.resolve();

      return result;
    });

    // 実行：
    const deleted = await omnio.deleteObject("k", signal);

    // 検証：
    expect(deleted).toBe(true);
    expect(await omnio.getObject("k", signal)).toBeNull();
    await purged.promise;
    expect(await getEntity().has(stored.entityId)).toBe(false);
    await expect(
      index.purge({
        key: stored.key,
        action: "purge",
        signal,
        entityId: stored.entityId,
      }),
    ).resolves.toBe(false);

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

  test("コンテンツタイプの条件で絞り込む", async ({ expect, signal }) => {
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
      contentType: "application/json",
    });

    // 実行：
    const actual = await omnio.listObjects(
      {
        filter: { contentType: { endsWith: "JSON" } },
      },
      signal,
    );

    // 検証：
    expect(actual.items.map((item) => item.key.key)).toStrictEqual(["b"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("ハッシュの条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const a = await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });
    const b = await omnio.putObject({
      key: "b",
      data: new Uint8Array([2]),
      contentType: "text/plain",
    });
    const c = await omnio.putObject({
      key: "c",
      data: new Uint8Array([3]),
      contentType: "text/plain",
    });
    const hashA = hashOf(a);
    const hashB = hashOf(b);
    const hashC = hashOf(c);

    const cases = [
      [hashA, ["a"]],
      [{ equals: hashA }, ["a"]],
      [{ not: hashA }, ["b", "c"]],
      [{ in: [hashA, hashC] }, ["a", "c"]],
      [{ notIn: [hashA, hashC] }, ["b"]],
      [{ contains: hashB.slice(4, 12) }, ["b"]],
      [{ startsWith: hashA.slice(0, 8) }, ["a"]],
      [{ endsWith: hashC.slice(-8) }, ["c"]],
    ] as const;

    for (const [hash, expected] of cases) {
      // 実行：
      const actual = await omnio.listObjects({ filter: { hash } }, signal);

      // 検証：
      expect(actual.items.map((item) => item.key.key)).toStrictEqual(expected);
    }

    // 後始末：
    await omnio.close(signal);
  });

  test("サイズの条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "b",
      data: new Uint8Array([2, 3]),
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "c",
      data: new Uint8Array([4, 5, 6]),
      contentType: "text/plain",
    });

    const cases = [
      [1, ["a"]],
      [3n, ["c"]],
      [{ equals: 2n }, ["b"]],
      [{ not: 1 }, ["b", "c"]],
      [{ not: [1n, 3] }, ["b"]],
      [{ in: [1n, 3] }, ["a", "c"]],
      [{ notIn: [1, 2n] }, ["c"]],
      [{ lt: 2n }, ["a"]],
      [{ lte: 2 }, ["a", "b"]],
      [{ gt: 1n }, ["b", "c"]],
      [{ gte: 2 }, ["b", "c"]],
    ] as const;

    for (const [size, expected] of cases) {
      // 実行：
      const actual = await omnio.listObjects({ filter: { size } }, signal);

      // 検証：
      expect(actual.items.map((item) => item.key.key)).toStrictEqual(expected);
    }

    // 後始末：
    await omnio.close(signal);
  });

  test("作成時刻の条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const stored = await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    // 実行：
    const byValue = await omnio.listObjects(
      {
        filter: { createdAt: new Date(stored.createdAt) },
      },
      signal,
    );
    const byCondition = await omnio.listObjects(
      {
        filter: { createdAt: { equals: new Date(stored.createdAt) } },
      },
      signal,
    );

    // 検証：
    expect(byValue.items.map((item) => item.key.key)).toStrictEqual(["a"]);
    expect(byCondition.items.map((item) => item.key.key)).toStrictEqual(["a"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("更新時刻の条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const stored = await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    // 実行：
    const byValue = await omnio.listObjects(
      {
        filter: { updatedAt: new Date(stored.updatedAt) },
      },
      signal,
    );
    const byCondition = await omnio.listObjects(
      {
        filter: { updatedAt: { equals: new Date(stored.updatedAt) } },
      },
      signal,
    );

    // 検証：
    expect(byValue.items.map((item) => item.key.key)).toStrictEqual(["a"]);
    expect(byCondition.items.map((item) => item.key.key)).toStrictEqual(["a"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("レコード時刻の条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    const stored = await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      contentType: "text/plain",
    });

    // 実行：
    const byValue = await omnio.listObjects(
      {
        filter: { recordTimestamp: new Date(stored.updatedAt) },
      },
      signal,
    );
    const byCondition = await omnio.listObjects(
      {
        filter: { recordTimestamp: { equals: new Date(stored.updatedAt) } },
      },
      signal,
    );

    // 検証：
    expect(byValue.items.map((item) => item.key.key)).toStrictEqual(["a"]);
    expect(byCondition.items.map((item) => item.key.key)).toStrictEqual(["a"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("レコードタイプの条件で絞り込む", async ({ expect, signal }) => {
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
    await omnio.updateObjectMetadata({
      key: "b",
      signal,
      description: "更新済み",
    });

    // 実行：
    const byValue = await omnio.listObjects(
      {
        filter: { recordType: "CREATE" },
      },
      signal,
    );
    const byCondition = await omnio.listObjects(
      {
        filter: { recordType: { in: "UPDATE_METADATA" } },
      },
      signal,
    );
    const byNot = await omnio.listObjects(
      {
        filter: { recordType: { not: ["UPDATE_METADATA"] } },
      },
      signal,
    );

    // 検証：
    expect(byValue.items.map((item) => item.key.key)).toStrictEqual(["a"]);
    expect(byCondition.items.map((item) => item.key.key)).toStrictEqual(["b"]);
    expect(byNot.items.map((item) => item.key.key)).toStrictEqual(["a"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("タグの条件で絞り込む", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "a",
      data: new Uint8Array([1]),
      tags: ["red", "round"],
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "b",
      data: new Uint8Array([2]),
      tags: ["blue", "round"],
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "c",
      data: new Uint8Array([3]),
      tags: ["red", "square"],
      contentType: "text/plain",
    });
    await omnio.putObject({
      key: "d",
      data: new Uint8Array([4]),
      contentType: "text/plain",
    });

    const cases = [
      ["red", ["a", "c"]],
      [{ has: "red" }, ["a", "c"]],
      [{ hasSome: ["square", "blue"] }, ["b", "c"]],
      [{ hasEvery: ["red", "round"] }, ["a"]],
      [{ hasEvery: ["red", "square"] }, ["c"]],
      [{ isEmpty: true }, ["d"]],
      [{ isEmpty: false }, ["a", "b", "c"]],
      [{ equals: ["round", "red"] }, ["a"]],
      [{ equals: [] }, ["d"]],
      [{ equals: ["red"] }, []],
      [
        {
          has: "red",
          hasSome: ["square"],
        },
        ["c"],
      ],
    ] as const;

    for (const [tags, expected] of cases) {
      // 実行：
      const actual = await omnio.listObjects({ filter: { tags } }, signal);

      // 検証：
      expect(actual.items.map((item) => item.key.key)).toStrictEqual(expected);
    }

    // 後始末：
    await omnio.close(signal);
  });

  test("不正な一覧条件を ValiError にする", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行と検証：
    await expect(omnio.listObjects({ limit: -1 }, signal)).rejects.toBeInstanceOf(ValiError);

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
      filter: { tags: { hasSome: ["wild"] } },
      signal,
    });

    // 検証：
    expect(actual.map((item) => item.key.key)).toStrictEqual(["b"]);

    // 後始末：
    await omnio.close(signal);
  });

  test("画像検索でも同じ埋め込みモデルの結果だけを返す", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);
    await omnio.putObject({
      key: "described",
      data: new Uint8Array([1]),
      contentType: "text/plain",
      description: "cat on the mat",
    });
    await omnio.putObject({
      key: "explicit",
      data: new Uint8Array([2]),
      embedding: new Float32Array([1, 0]),
      contentType: "text/plain",
    });

    // 実行：
    const actual = await omnio.searchObjects({
      topK: 10,
      query: {
        image: new Uint8Array([1]),
        mimeType: "image/png",
      },
      signal,
    });

    // 検証：
    expect(actual.map((item) => item.key.key)).toStrictEqual(["described"]);
    expect(actual[0]?.embeddingModel).toBe("fake-model");

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

  test("不正な検索入力を ValiError にする", async ({ expect, signal }) => {
    // 準備：
    const omnio = await createTestOmnio(signal);

    // 実行と検証：
    await expect(
      omnio.searchObjects({
        topK: -1,
        query: { text: "cat" },
        signal,
      }),
    ).rejects.toBeInstanceOf(ValiError);
    await expect(
      omnio.searchObjects({
        query: { vector: new Float32Array() },
        signal,
      }),
    ).rejects.toBeInstanceOf(ValiError);

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
    expect(actual?.embeddingSource).toStrictEqual({
      kind: "description",
      model: "fake-model",
    });
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
