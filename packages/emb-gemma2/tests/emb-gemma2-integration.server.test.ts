import { test, describe } from "vite-plus/test";

import { Gemma2Embedder } from "../src/emb-gemma2.js";

/** 統合テストの制限時間です。モデルの読み込みに時間がかかります。 */
const TIMEOUT = 300_000;

/**
 * 読み込み済みの共有 embedder を返します。
 *
 * モデルの読み込みは重いため、読み取り専用の単一インスタンスを使い回します。
 *
 * @param signal 処理を中断するための中断シグナルです。
 *
 * @returns 共有の embedder です。
 */
let shared: Gemma2Embedder | undefined;

async function getSharedEmbedder(signal: AbortSignal): Promise<Gemma2Embedder> {
  if (shared === undefined) {
    shared = new Gemma2Embedder();
    // 読み込みを確定させるため、短い文を 1 回埋め込みます。
    await shared.embedText({
      text: "warmup",
      action: "embedText",
      signal,
    });
  }

  return shared;
}

/**
 * ベクトルの L2 ノルムを求めます。
 *
 * 正規化の検証に使用します。
 *
 * @param vector 検証するベクトルです。
 *
 * @returns L2 ノルムです。
 */
function norm(vector: Float32Array): number {
  let sum = 0;

  for (const value of vector) {
    sum += value * value;
  }

  return Math.sqrt(sum);
}

/**
 * 検証用の 16x16 赤画像の PNG バイト列です。
 *
 * 外部への問い合わせなしに画像埋め込みを検証するために使用します。
 */
const RED_PNG_HEX =
  "89504e470d0a1a0a0000000d4948445200000010000000100802000000909168360000001649444154789c6338a1a141126218d530aa61f86a00007c331810f8f8ebd20000000049454e44ae426082";

/**
 * 検証用の画像バイト列を作ります。
 *
 * @returns PNG 画像のバイト列です。
 */
function redPngBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(RED_PNG_HEX.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(RED_PNG_HEX.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

describe("Gemma2Embedder の統合", () => {
  test(
    "テキストを 768 次元に埋め込む",
    async ({ expect, signal }) => {
      // 準備：
      const embedder = await getSharedEmbedder(signal);

      // 実行：
      const actual = await embedder.embedText({
        text: "Hello world",
        action: "embedText",
        signal,
      });

      // 検証：
      expect(actual).toBeInstanceOf(Float32Array);
      expect(actual.length).toBe(768);
      expect(norm(actual)).toBeCloseTo(1, 4);
    },
    TIMEOUT,
  );

  test(
    "日本語を埋め込む",
    async ({ expect, signal }) => {
      // 準備：
      const embedder = await getSharedEmbedder(signal);

      // 実行：
      const actual = await embedder.embedText({
        text: "夕日の海辺",
        action: "embedText",
        signal,
      });

      // 検証：
      expect(actual.length).toBe(768);
      expect(norm(actual)).toBeCloseTo(1, 4);
    },
    TIMEOUT,
  );

  test(
    "同じ入力は同じベクトルになり異なる入力は異なる",
    async ({ expect, signal }) => {
      // 準備：
      const embedder = await getSharedEmbedder(signal);

      // 実行：
      const first = await embedder.embedText({
        text: "hello",
        action: "embedText",
        signal,
      });
      const second = await embedder.embedText({
        text: "hello",
        action: "embedText",
        signal,
      });
      const other = await embedder.embedText({
        text: "goodbye",
        action: "embedText",
        signal,
      });

      // 検証：
      expect(second).toStrictEqual(first);
      expect(other).not.toStrictEqual(first);
    },
    TIMEOUT,
  );

  test(
    "一括埋め込みは入力順に返す",
    async ({ expect, signal }) => {
      // 準備：
      const embedder = await getSharedEmbedder(signal);

      // 実行：
      const actual = await embedder.embedMany({
        action: "embedMany",
        inputs: [
          {
            kind: "text",
            text: "hello",
          },
          {
            kind: "text",
            text: "world",
          },
        ],
        signal,
      });
      const single = await embedder.embed({
        input: {
          kind: "text",
          text: "hello",
        },
        action: "embed",
        signal,
      });

      // 検証：
      expect(actual).toHaveLength(2);
      expect(actual[0]).toStrictEqual(single);
    },
    TIMEOUT,
  );

  test(
    "dims 指定で切り詰めて正規化する",
    async ({ expect, signal }) => {
      // 準備：
      const embedder = new Gemma2Embedder({ dims: 256 });

      // 実行：
      const actual = await embedder.embedText({
        text: "hello",
        action: "embedText",
        signal,
      });

      // 検証：
      expect(actual.length).toBe(256);
      expect(norm(actual)).toBeCloseTo(1, 4);
    },
    TIMEOUT,
  );

  test(
    "画像を 768 次元に埋め込む",
    async ({ expect, signal }) => {
      // 準備：
      const embedder = await getSharedEmbedder(signal);

      // 実行：
      const actual = await embedder.embed({
        input: {
          data: redPngBytes(),
          kind: "image",
          mimeType: "image/png",
        },
        action: "embed",
        signal,
      });

      // 検証：
      expect(actual).toBeInstanceOf(Float32Array);
      expect(actual.length).toBe(768);
      expect(norm(actual)).toBeCloseTo(1, 4);
    },
    TIMEOUT,
  );

  test(
    "テキストと画像の一括埋め込みは入力順に返す",
    async ({ expect, signal }) => {
      // 準備：
      const embedder = await getSharedEmbedder(signal);

      // 実行：
      const actual = await embedder.embedMany({
        action: "embedMany",
        inputs: [
          {
            kind: "text",
            text: "hello",
          },
          {
            data: redPngBytes(),
            kind: "image",
            mimeType: "image/png",
          },
        ],
        signal,
      });
      const single = await embedder.embed({
        input: {
          data: redPngBytes(),
          kind: "image",
          mimeType: "image/png",
        },
        action: "embed",
        signal,
      });

      // 検証：
      expect(actual).toHaveLength(2);
      expect(actual[1]).toStrictEqual(single);
    },
    TIMEOUT,
  );
});
