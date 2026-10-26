// oxlint-disable import/no-namespace
import { type IEmbedder, UnsupportedModalityError } from "@omniojs/core";
import * as v from "valibot";
import { test, describe } from "vite-plus/test";

import {
  DEFAULT_DIMS,
  DEFAULT_DTYPE,
  Gemma2Embedder,
  DEFAULT_MODEL_ID,
  DEFAULT_SUBFOLDER,
} from "../src/emb-gemma2.js";

describe("Gemma2Embedder", () => {
  test("supports はテキストのみ対応する", ({ expect }) => {
    // 準備：
    const embedder = new Gemma2Embedder();
    const signal = AbortSignal.abort();

    // 実行と検証：
    expect(
      embedder.supports({
        action: "supports",
        signal,
        modality: "text",
      }),
    ).toBe(true);
    expect(
      embedder.supports({
        action: "supports",
        signal,
        modality: "image",
      }),
    ).toBe(false);
    expect(
      embedder.supports({
        action: "supports",
        signal,
        modality: "audio",
      }),
    ).toBe(false);
  });

  test("既定の能力情報を公開する", ({ expect }) => {
    // 実行：
    const embedder = new Gemma2Embedder();

    // 検証：
    expect(embedder.info).toStrictEqual({
      dims: DEFAULT_DIMS,
      name: DEFAULT_MODEL_ID,
      modalities: ["text"],
      normalized: true,
      multilingual: true,
    });

    expect(DEFAULT_DTYPE).toBe("q4");
    expect(DEFAULT_SUBFOLDER).toBe("onnx");
  });

  test("dims を指定すると能力情報に反映する", ({ expect }) => {
    // 実行：
    const embedder = new Gemma2Embedder({ dims: 256 });

    // 検証：
    expect(embedder.info.dims).toBe(256);
  });

  test("不正な dims では構築時に ValiError を投げる", ({ expect }) => {
    // 実行と検証：
    expect(() => new Gemma2Embedder({ dims: 0 })).toThrow(v.ValiError);
    expect(() => new Gemma2Embedder({ dims: -1 })).toThrow(v.ValiError);
    expect(() => new Gemma2Embedder({ dims: 1.5 })).toThrow(v.ValiError);
  });

  test("画像の埋め込みはモデル読込前に UnsupportedModalityError を投げる", async ({
    expect,
    signal,
  }) => {
    // 準備：
    const embedder = new Gemma2Embedder();

    // 実行と検証：
    await expect(
      embedder.embed({
        input: {
          data: new Uint8Array([1, 2, 3]),
          kind: "image",
        },
        action: "embed",
        signal,
      }),
    ).rejects.toBeInstanceOf(UnsupportedModalityError);
  });

  test("画像を含む一括埋め込みは UnsupportedModalityError を投げる", async ({ expect, signal }) => {
    // 準備：
    const embedder = new Gemma2Embedder();

    // 実行と検証：
    await expect(
      embedder.embedMany({
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
      }),
    ).rejects.toBeInstanceOf(UnsupportedModalityError);
  });

  test("空の一括埋め込みはモデルを読まずに空配列を返す", async ({ expect, signal }) => {
    // 準備：
    const embedder = new Gemma2Embedder();

    // 実行：
    const actual = await embedder.embedMany({
      action: "embedMany",
      inputs: [],
      signal,
    });

    // 検証：
    expect(actual).toStrictEqual([]);
  });

  test("IEmbedder として扱える", ({ expect }) => {
    // 実行：
    const embedder: IEmbedder = new Gemma2Embedder();

    // 検証：
    expect(embedder.info.dims).toBe(768);
  });
});
