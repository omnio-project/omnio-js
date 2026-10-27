import { type VectorMetric, DbQueryError } from "@omniojs/core";

/**
 * 埋め込みベクトルを保存用のバイト列に変換します。
 *
 * @param vector 埋め込みベクトルです。
 *
 * @returns リトルエンディアンのバイト列です。
 */
export function encodeEmbedding(vector: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(vector.byteLength);
  bytes.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));

  return bytes;
}

/**
 * 保存用のバイト列を埋め込みベクトルに変換します。
 *
 * @param bytes リトルエンディアンのバイト列です。
 *
 * @returns 埋め込みベクトルです。
 */
export function decodeEmbedding(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) {
    throw new DbQueryError({
      cause: new Error(
        `Invalid embedding bytes: length must be a multiple of 4, but got ${bytes.byteLength}`,
      ),
      operation: "decode",
    });
  }

  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return new Float32Array(buffer);
}

/**
 * 保存用のバイト列を、既存の埋め込みベクトルへ書き込みます。
 *
 * 検索時に行ごとの `Float32Array` を確保しないため、作業用のベクトルを再利用します。
 *
 * @param bytes リトルエンディアンのバイト列です。
 * @param target 書き込み先のベクトルです。長さはバイト列と一致している必要があります。
 *
 * @returns 書き込み先のベクトルです。
 */
export function decodeEmbeddingInto(bytes: Uint8Array, target: Float32Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) {
    throw new DbQueryError({
      cause: new Error(
        `Invalid embedding bytes: length must be a multiple of 4, but got ${bytes.byteLength}`,
      ),
      operation: "decode",
    });
  }

  if (bytes.byteLength !== target.byteLength) {
    throw new DbQueryError({
      cause: new Error(
        `Invalid embedding buffer: expected ${target.byteLength} bytes, but got ${bytes.byteLength}`,
      ),
      operation: "decode",
    });
  }

  new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(bytes);

  return target;
}

/**
 * コサイン類似度を求めます。
 *
 * @param query 検索クエリーのベクトルです。
 * @param target 比較対象のベクトルです。
 *
 * @returns コサイン類似度です。どちらかがゼロベクトルの場合は 0 です。
 */
export function cosineSimilarity(query: Float32Array, target: Float32Array): number {
  const length = Math.min(query.length, target.length);
  let dot = 0;
  let queryNorm = 0;
  let targetNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const queryValue = Number(query[index]);
    const targetValue = Number(target[index]);
    dot += queryValue * targetValue;
    queryNorm += queryValue * queryValue;
    targetNorm += targetValue * targetValue;
  }

  if (queryNorm === 0 || targetNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(queryNorm) * Math.sqrt(targetNorm));
}

/**
 * 内積を求めます。
 *
 * @param query 検索クエリーのベクトルです。
 * @param target 比較対象のベクトルです。
 *
 * @returns 内積です。
 */
export function dotProduct(query: Float32Array, target: Float32Array): number {
  const length = Math.min(query.length, target.length);
  let dot = 0;

  for (let index = 0; index < length; index += 1) {
    dot += Number(query[index]) * Number(target[index]);
  }

  return dot;
}

/**
 * L2 距離を求めます。
 *
 * @param query 検索クエリーのベクトルです。
 * @param target 比較対象のベクトルです。
 *
 * @returns L2 距離です。
 */
export function l2Distance(query: Float32Array, target: Float32Array): number {
  const length = Math.min(query.length, target.length);
  let sum = 0;

  for (let index = 0; index < length; index += 1) {
    const diff = Number(query[index]) - Number(target[index]);
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * 方式ごとのスコア計算です。
 */
const SCORERS: Record<VectorMetric, (left: Float32Array, right: Float32Array) => number> = {
  l2: (left, right) => -l2Distance(left, right),
  dot: dotProduct,
  cosine: cosineSimilarity,
};

/**
 * 指定した方式でスコアを求めます。降順で並べ替えられることを想定します。
 *
 * @param metric ベクトル類似度の計算方式です。
 * @param query 検索クエリーのベクトルです。
 * @param target 比較対象のベクトルです。
 *
 * @returns 類似度スコアです。L2 距離の場合は負の距離です。
 */
export function scoreVector(
  metric: VectorMetric,
  query: Float32Array,
  target: Float32Array,
): number {
  return SCORERS[metric](query, target);
}
