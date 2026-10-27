import { test, describe } from "vite-plus/test";

import {
  dotProduct,
  l2Distance,
  scoreVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
} from "../src/vector.js";

describe("encodeEmbedding と decodeEmbedding", () => {
  test("符号化して復号すると元のベクトルに戻る", ({ expect }) => {
    // 準備：
    const vector = new Float32Array([1, -2.5, 3.25]);

    // 実行：
    const actual = decodeEmbedding(encodeEmbedding(vector));

    // 検証：
    expect(actual).toStrictEqual(vector);
  });

  test("byteOffset 付きのビューも正しく符号化する", ({ expect }) => {
    // 準備：
    const vector = new Float32Array([9, 1, 2]).subarray(1);

    // 実行：
    const actual = decodeEmbedding(encodeEmbedding(vector));

    // 検証：
    expect(actual).toStrictEqual(new Float32Array([1, 2]));
  });

  test("4 の倍数でないバイト列の復号はエラーを投げる", ({ expect }) => {
    // 準備：
    const bytes = new Uint8Array([1, 2, 3]);

    // 実行と検証：
    expect(() => decodeEmbedding(bytes)).toThrow();
  });
});

describe("cosineSimilarity", () => {
  test("同じ向きのベクトルは 1 である", ({ expect }) => {
    // 実行と検証：
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([2, 4]))).toBeCloseTo(1);
  });

  test("直交するベクトルは 0 である", ({ expect }) => {
    // 実行と検証：
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
  });

  test("ゼロベクトルは NaN ではなく 0 である", ({ expect }) => {
    // 実行と検証：
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 0]))).toBe(0);
  });

  test("長さが異なるベクトルでも短い方に合わせて計算する", ({ expect }) => {
    // 実行と検証：
    expect(cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([1, 0]))).toBeCloseTo(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBeCloseTo(1);
  });
});

describe("dotProduct", () => {
  test("内積を求める", ({ expect }) => {
    // 実行と検証：
    expect(dotProduct(new Float32Array([1, 2]), new Float32Array([3, 4]))).toBe(11);
  });

  test("長さが異なるベクトルでも短い方に合わせて計算する", ({ expect }) => {
    // 実行と検証：
    expect(dotProduct(new Float32Array([1, 2, 3]), new Float32Array([4, 5]))).toBe(14);
    expect(dotProduct(new Float32Array([1, 2]), new Float32Array([3, 4, 5]))).toBe(11);
  });
});

describe("l2Distance", () => {
  test("同じベクトルは 0 である", ({ expect }) => {
    // 実行と検証：
    expect(l2Distance(new Float32Array([1, 2]), new Float32Array([1, 2]))).toBe(0);
  });

  test("距離を求める", ({ expect }) => {
    // 実行と検証：
    expect(l2Distance(new Float32Array([0, 0]), new Float32Array([3, 4]))).toBe(5);
  });

  test("長さが異なるベクトルでも短い方に合わせて計算する", ({ expect }) => {
    // 実行と検証：
    expect(l2Distance(new Float32Array([1, 2, 3]), new Float32Array([1, 2]))).toBe(0);
    expect(l2Distance(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toBe(0);
  });
});

describe("scoreVector", () => {
  test("cosine は類似度を返す", ({ expect }) => {
    // 実行と検証：
    expect(scoreVector("cosine", new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1);
  });

  test("dot は内積を返す", ({ expect }) => {
    // 実行と検証：
    expect(scoreVector("dot", new Float32Array([1, 2]), new Float32Array([3, 4]))).toBe(11);
  });

  test("l2 は負の距離を返す", ({ expect }) => {
    // 実行と検証：
    expect(scoreVector("l2", new Float32Array([0, 0]), new Float32Array([3, 4]))).toBe(-5);
  });
});
