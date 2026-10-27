import { ModelLoadError, EmbedFailedError } from "@omniojs/core";
import { vi, test, describe, beforeEach } from "vite-plus/test";

import {
  DEFAULT_DTYPE,
  Gemma2Embedder,
  DEFAULT_MODEL_ID,
  DEFAULT_SUBFOLDER,
} from "../src/emb-gemma2.js";

const mocks = vi.hoisted(() => ({
  pipeline: vi.fn<(task: string, model: string, options?: unknown) => Promise<unknown>>(),
  readImage: vi.fn<(source: Blob) => Promise<unknown>>(),
  fromPretrainedModel: vi.fn<(model: string, options?: unknown) => Promise<unknown>>(),
  fromPretrainedProcessor: vi.fn<(model: string, options?: unknown) => Promise<unknown>>(),
}));
vi.mock("@huggingface/transformers", () => ({
  pipeline: mocks.pipeline,
  RawImage: {
    read: mocks.readImage,
  },
  AutoModel: {
    from_pretrained: mocks.fromPretrainedModel,
  },
  AutoProcessor: {
    from_pretrained: mocks.fromPretrainedProcessor,
  },
}));

/**
 * テストで使うテンソルに似た値です。
 */
type TensorLike = {
  data: Float32Array;
  dims: number[];
};

/**
 * 推論結果として使うテンソルを作ります。
 *
 * モデルの出力形状に依存する処理を実際のテンソルなしで検証するために使用します。
 *
 * @param dims テンソルの次元です。
 * @param data テンソルの要素です。
 *
 * @returns テンソルに似たオブジェクトです。
 */
function tensor(dims: number[], data: number[]): TensorLike {
  return {
    data: new Float32Array(data),
    dims,
  };
}

/**
 * 指定したベクトルを返すテキスト用の推論器を作ります。
 *
 * @param vector 各テキストに対して返すベクトルです。
 *
 * @returns 推論器として使う関数です。
 */
function extractorFor(vector: number[]): (texts: string[]) => Promise<TensorLike> {
  return async (texts) =>
    tensor(
      [texts.length, vector.length],
      texts.flatMap(() => vector),
    );
}

/**
 * 画像用のプロセッサーとモデルを設定します。
 *
 * @param embedding 画像埋め込みとして返すテンソルです。
 */
function mockImageBackend(embedding: TensorLike): {
  model: ReturnType<typeof vi.fn>;
  processor: ReturnType<typeof vi.fn>;
} {
  const processor = vi.fn<(image: null, input: unknown) => Promise<unknown>>(async () => ({}));
  const model = vi.fn<(inputs: unknown) => Promise<{ sentence_embedding: unknown }>>(async () => ({
    sentence_embedding: embedding,
  }));
  mocks.fromPretrainedProcessor.mockResolvedValue(processor);
  mocks.fromPretrainedModel.mockResolvedValue(model);

  mocks.readImage.mockResolvedValue({ image: true });

  return {
    model,
    processor,
  };
}

describe("Gemma2Embedder のモデル連携", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("dims 指定で切り詰めて L2 正規化する", async ({ expect, signal }) => {
    // 準備：
    mocks.pipeline.mockResolvedValue(extractorFor([3, 4, 0]));
    const embedder = new Gemma2Embedder({ dims: 2 });

    // 実行：
    const actual = await embedder.embedText({
      text: "hello",
      action: "embedText",
      signal,
    });

    // 検証：
    expect(actual).toStrictEqual(new Float32Array([0.6, 0.8]));
  });

  test("dims 以下のベクトルはそのまま返す", async ({ expect, signal }) => {
    // 準備：
    mocks.pipeline.mockResolvedValue(extractorFor([1, 2]));
    const embedder = new Gemma2Embedder({ dims: 4 });

    // 実行：
    const actual = await embedder.embedText({
      text: "hello",
      action: "embedText",
      signal,
    });

    // 検証：
    expect(actual).toStrictEqual(new Float32Array([1, 2]));
  });

  test("device を指定するとモデル読み込み設定に含める", async ({ expect, signal }) => {
    // 準備：
    mocks.pipeline.mockResolvedValue(extractorFor([1]));
    const embedder = new Gemma2Embedder({ device: "cpu" });

    // 実行：
    await embedder.embedText({
      text: "hello",
      action: "embedText",
      signal,
    });

    // 検証：
    expect(mocks.pipeline).toHaveBeenCalledWith("feature-extraction", DEFAULT_MODEL_ID, {
      dtype: DEFAULT_DTYPE,
      device: "cpu",
      subfolder: DEFAULT_SUBFOLDER,
    });
  });

  test("モデルの読み込みに失敗すると ModelLoadError を投げ、再試行できる", async ({
    expect,
    signal,
  }) => {
    // 準備：
    mocks.pipeline
      .mockRejectedValueOnce(new Error("load failed"))
      .mockResolvedValueOnce(extractorFor([1]));
    const embedder = new Gemma2Embedder();

    // 実行と検証：
    await expect(
      embedder.embedText({
        text: "hello",
        action: "embedText",
        signal,
      }),
    ).rejects.toBeInstanceOf(ModelLoadError);

    const actual = await embedder.embedText({
      text: "hello",
      action: "embedText",
      signal,
    });
    expect(actual).toStrictEqual(new Float32Array([1]));

    expect(mocks.pipeline).toHaveBeenCalledTimes(2);
  });

  test("読み込み済みの推論器を再利用する", async ({ expect, signal }) => {
    // 準備：
    mocks.pipeline.mockResolvedValue(extractorFor([1]));
    const embedder = new Gemma2Embedder();

    // 実行：
    await embedder.embedText({
      text: "one",
      action: "embedText",
      signal,
    });
    await embedder.embedText({
      text: "two",
      action: "embedText",
      signal,
    });

    // 検証：
    expect(mocks.pipeline).toHaveBeenCalledTimes(1);
  });

  test("テキストの推論失敗は EmbedFailedError を投げる", async ({ expect, signal }) => {
    // 準備：
    mocks.pipeline.mockResolvedValue(async () => {
      throw new Error("inference failed");
    });
    const embedder = new Gemma2Embedder();

    // 実行と検証：
    await expect(
      embedder.embedText({
        text: "hello",
        action: "embedText",
        signal,
      }),
    ).rejects.toBeInstanceOf(EmbedFailedError);
  });

  test("出力の次元が空なら EmbedFailedError を投げる", async ({ expect, signal }) => {
    // 準備：
    mocks.pipeline.mockResolvedValue(async () => tensor([], []));
    const embedder = new Gemma2Embedder();

    // 実行と検証：
    await expect(
      embedder.embedText({
        text: "hello",
        action: "embedText",
        signal,
      }),
    ).rejects.toBeInstanceOf(EmbedFailedError);
  });

  test("出力の要素数が次元と一致しなければ EmbedFailedError を投げる", async ({
    expect,
    signal,
  }) => {
    // 準備：
    mocks.pipeline.mockResolvedValue(async () => tensor([1, 3], [1]));
    const embedder = new Gemma2Embedder();

    // 実行と検証：
    await expect(
      embedder.embedText({
        text: "hello",
        action: "embedText",
        signal,
      }),
    ).rejects.toBeInstanceOf(EmbedFailedError);
  });

  test("画像を埋め込む", async ({ expect, signal }) => {
    // 準備：
    const { processor } = mockImageBackend(tensor([1, 2], [1, 2]));
    const embedder = new Gemma2Embedder();

    // 実行：
    const actual = await embedder.embed({
      input: {
        data: new Uint8Array([1, 2, 3]),
        kind: "image",
        mimeType: "image/png",
      },
      action: "embed",
      signal,
    });

    // 検証：
    expect(actual).toStrictEqual(new Float32Array([1, 2]));
    expect(processor).toHaveBeenCalledWith(null, { image: true });
  });

  test("Blob の画像と MIME タイプなしを処理する", async ({ expect, signal }) => {
    // 準備：
    mockImageBackend(tensor([1, 1], [1]));
    const embedder = new Gemma2Embedder();
    const image = new Blob([new Uint8Array([1, 2, 3])]);

    // 実行：
    await embedder.embed({
      input: {
        data: image,
        kind: "image",
      },
      action: "embed",
      signal,
    });

    // 検証：
    expect(mocks.readImage).toHaveBeenCalledWith(image);
  });

  test("複数画像を一括で埋め込む", async ({ expect, signal }) => {
    // 準備：
    const { processor } = mockImageBackend(tensor([2, 2], [1, 0, 0, 1]));
    const embedder = new Gemma2Embedder();

    // 実行：
    const actual = await embedder.embedMany({
      action: "embedMany",
      inputs: [
        {
          data: new Uint8Array([1]),
          kind: "image",
        },
        {
          data: new Uint8Array([2]),
          kind: "image",
        },
      ],
      signal,
    });

    // 検証：
    expect(actual).toHaveLength(2);
    expect(processor).toHaveBeenCalledWith(null, [[{ image: true }], [{ image: true }]]);
  });

  test("テキストと画像を混在して一括で埋め込む", async ({ expect, signal }) => {
    // 準備：
    mocks.pipeline.mockResolvedValue(extractorFor([1, 0]));
    mockImageBackend(tensor([1, 2], [0, 1]));
    const embedder = new Gemma2Embedder();

    // 実行：
    const actual = await embedder.embedMany({
      action: "embedMany",
      inputs: [
        {
          kind: "text",
          text: "hello",
        },
        {
          data: new Uint8Array([1]),
          kind: "image",
        },
      ],
      signal,
    });

    // 検証：
    expect(actual).toStrictEqual([new Float32Array([1, 0]), new Float32Array([0, 1])]);
  });

  test("画像バックエンドの読み込み失敗は ModelLoadError を投げる", async ({ expect, signal }) => {
    // 準備：
    mocks.readImage.mockResolvedValue({ image: true });
    mocks.fromPretrainedProcessor.mockRejectedValue(new Error("load failed"));
    const embedder = new Gemma2Embedder();

    // 実行と検証：
    await expect(
      embedder.embed({
        input: {
          data: new Uint8Array([1]),
          kind: "image",
        },
        action: "embed",
        signal,
      }),
    ).rejects.toBeInstanceOf(ModelLoadError);
  });

  test("画像の推論失敗は EmbedFailedError を投げる", async ({ expect, signal }) => {
    // 準備：
    mockImageBackend(tensor([1, 1], [1]));
    mocks.fromPretrainedModel.mockResolvedValue(async () => {
      throw new Error("inference failed");
    });
    const embedder = new Gemma2Embedder();

    // 実行と検証：
    await expect(
      embedder.embed({
        input: {
          data: new Uint8Array([1]),
          kind: "image",
        },
        action: "embed",
        signal,
      }),
    ).rejects.toBeInstanceOf(EmbedFailedError);
  });
});
