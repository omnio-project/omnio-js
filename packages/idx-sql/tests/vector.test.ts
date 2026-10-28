import { test, describe } from "vite-plus/test";

import {
  l2Distance,
  parseVector,
  scoreVector,
  formatVector,
  decodeEmbedding,
  encodeEmbedding,
  cosineSimilarity,
  decodeEmbeddingInto,
} from "../src/vector.js";

describe("formatVector と parseVector", () => {
  test("pgvector の形式に変換して復号すると元のベクトルに戻る", ({ expect }) => {
    // 準備：
    const vector = new Float32Array([1, -2.5, 3.25]);

    // 実行：
    const actual = parseVector(formatVector(vector));

    // 検証：
    expect(formatVector(vector)).toBe("[1,-2.5,3.25]");
    expect(actual).toStrictEqual(vector);
  });

  test("空のベクトルを扱える", ({ expect }) => {
    // 実行と検証：
    expect(formatVector(new Float32Array())).toBe("[]");
    expect(parseVector("[]")).toStrictEqual(new Float32Array());
  });

  test("NaN を含む値も復号できる", ({ expect }) => {
    // 実行と検証：
    expect(parseVector("[NaN,1]")[0]).toBeNaN();
  });

  test("不正な形式はエラーを投げる", ({ expect }) => {
    // 実行と検証：
    expect(() => parseVector("1,2,3")).toThrow();
    expect(() => parseVector("[1,invalid,3]")).toThrow();
    expect(() => parseVector("[1,,3]")).toThrow();
  });
});

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

describe("decodeEmbeddingInto", () => {
  test("作業用のベクトルへ復号する", ({ expect }) => {
    // 準備：
    const vector = new Float32Array([1, -2.5, 3.25]);
    const target = new Float32Array(vector.length);

    // 実行：
    const actual = decodeEmbeddingInto(encodeEmbedding(vector), target);

    // 検証：
    expect(actual).toBe(target);
    expect(actual).toStrictEqual(vector);
  });

  test("長さが一致しない作業用ベクトルはエラーを投げる", ({ expect }) => {
    // 準備：
    const bytes = encodeEmbedding(new Float32Array([1, 2]));
    const target = new Float32Array(1);

    // 実行と検証：
    expect(() => decodeEmbeddingInto(bytes, target)).toThrow();
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

  test("l2 は負の距離を返す", ({ expect }) => {
    // 実行と検証：
    expect(scoreVector("l2", new Float32Array([0, 0]), new Float32Array([3, 4]))).toBe(-5);
  });
});
