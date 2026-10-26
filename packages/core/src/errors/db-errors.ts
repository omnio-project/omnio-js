import { type ErrorMeta, type ErrorOptions, setErrorMessage } from "i18n-error-base";

import { ErrorBase } from "./errors.js";

/**
 * `@omniojs/db-*` パッケージにおけるエラークラスの基底です。
 *
 * @example
 * ```
 * import { DbErrorBase } from "@omniojs/core";
 *
 * class MyDbError extends DbErrorBase<{ readonly detail: string }> {}
 * ```
 */
export class DbErrorBase<
  TMeta extends ErrorMeta | undefined = ErrorMeta | undefined,
> extends ErrorBase<TMeta> {}

/**
 * `DbNotOpenError` のメタデータです。
 */
export type DbNotOpenErrorMeta = {
  /** 実行しようとした操作の名前です。 */
  readonly operation: string;
};

/**
 * `DbNotOpenError` のコンストラクター引数です。
 */
export type DbNotOpenErrorArgs = ErrorOptions & DbNotOpenErrorMeta;

/**
 * データベースが開いていない状態で操作しようとしたことを示すエラーです。
 *
 * @example
 * ```
 * import { DbNotOpenError } from "@omniojs/core";
 *
 * throw new DbNotOpenError({ operation: "upsert" });
 * ```
 */
export class DbNotOpenError extends DbErrorBase<DbNotOpenErrorMeta> {
  static {
    this.prototype.name = "OmnioDbNotOpenError";
  }

  public constructor(args: DbNotOpenErrorArgs) {
    const { operation, ...options } = args;
    const meta: DbNotOpenErrorMeta = { operation };
    super(
      meta,
      ({ operation: failedOperation }) =>
        `Database is not open: ${failedOperation} requires an open connection`,
      options,
    );
  }
}

setErrorMessage(
  DbNotOpenError,
  ({ operation }) => `データベースが開いていません: ${operation} には開いた接続が必要です`,
  "ja",
);

/**
 * `DbQueryError` のメタデータです。
 */
export type DbQueryErrorMeta = {
  /** 実行しようとした操作の名前です。 */
  readonly operation: string;

  /** 実行しようとしたクエリーのテキストです。存在しない場合もあります。 */
  readonly queryText?: string | undefined;
};

/**
 * `DbQueryError` のコンストラクター引数です。
 */
export type DbQueryErrorArgs = ErrorOptions & DbQueryErrorMeta;

/**
 * データベース操作に失敗したことを示すエラーです。
 *
 * @example
 * ```
 * import { DbQueryError } from "@omniojs/core";
 *
 * throw new DbQueryError({ operation: "search", cause: originalError });
 * ```
 */
export class DbQueryError extends DbErrorBase<DbQueryErrorMeta> {
  static {
    this.prototype.name = "OmnioDbQueryError";
  }

  public constructor(args: DbQueryErrorArgs) {
    const { operation, queryText, ...options } = args;
    const meta: DbQueryErrorMeta =
      queryText === undefined
        ? { operation }
        : {
            operation,
            queryText,
          };
    super(
      meta,
      ({ operation: failedOperation, queryText: failedQueryText }) =>
        failedQueryText === undefined
          ? `Failed to execute database operation: ${failedOperation}`
          : `Failed to execute database operation: ${failedOperation} (${failedQueryText})`,
      options,
    );
  }
}

setErrorMessage(
  DbQueryError,
  ({ operation, queryText }) =>
    queryText === undefined
      ? `データベース操作に失敗しました: ${operation}`
      : `データベース操作に失敗しました: ${operation} (${queryText})`,
  "ja",
);

/**
 * `VectorDimensionMismatchError` のメタデータです。
 */
export type VectorDimensionMismatchErrorMeta = {
  /** 受け取ったベクトルの次元数です。 */
  readonly actual: number;

  /** 期待されたベクトルの次元数です。 */
  readonly expected: number;
};

/**
 * `VectorDimensionMismatchError` のコンストラクター引数です。
 */
export type VectorDimensionMismatchErrorArgs = ErrorOptions & VectorDimensionMismatchErrorMeta;

/**
 * ベクトルの次元数が保存先の定義と一致しないことを示すエラーです。
 *
 * @example
 * ```
 * import { VectorDimensionMismatchError } from "@omniojs/core";
 *
 * throw new VectorDimensionMismatchError({ actual: 384, expected: 768 });
 * ```
 */
export class VectorDimensionMismatchError extends DbErrorBase<VectorDimensionMismatchErrorMeta> {
  static {
    this.prototype.name = "OmnioVectorDimensionMismatchError";
  }

  public constructor(args: VectorDimensionMismatchErrorArgs) {
    const { actual, expected, ...options } = args;
    const meta: VectorDimensionMismatchErrorMeta = {
      actual,
      expected,
    };
    super(
      meta,
      ({ actual: actualDims, expected: expectedDims }) =>
        `Vector dimension mismatch: expected ${expectedDims}, but got ${actualDims}`,
      options,
    );
  }
}

setErrorMessage(
  VectorDimensionMismatchError,
  ({ actual, expected }) =>
    `ベクトルの次元数が一致しません: ${expected} を期待しましたが、${actual} を受け取りました`,
  "ja",
);

/**
 * `EmbeddingModelMismatchError` のメタデータです。
 */
export type EmbeddingModelMismatchErrorMeta = {
  /** 受け取ったレコードの埋め込みモデル名です。記録がない場合もあります。 */
  readonly actual?: string | undefined;

  /** 期待された埋め込みモデル名です。 */
  readonly expected: string;
};

/**
 * `EmbeddingModelMismatchError` のコンストラクター引数です。
 */
export type EmbeddingModelMismatchErrorArgs = ErrorOptions & EmbeddingModelMismatchErrorMeta;

/**
 * 埋め込みモデル名が期待されるものと一致しないことを示すエラーです。
 *
 * @example
 * ```
 * import { EmbeddingModelMismatchError } from "@omniojs/core";
 *
 * throw new EmbeddingModelMismatchError({ actual: "model-a", expected: "model-b" });
 * ```
 */
export class EmbeddingModelMismatchError extends DbErrorBase<EmbeddingModelMismatchErrorMeta> {
  static {
    this.prototype.name = "OmnioEmbeddingModelMismatchError";
  }

  public constructor(args: EmbeddingModelMismatchErrorArgs) {
    const { actual, expected, ...options } = args;
    const meta: EmbeddingModelMismatchErrorMeta =
      actual === undefined
        ? { expected }
        : {
            actual,
            expected,
          };
    super(
      meta,
      ({ actual: actualModel, expected: expectedModel }) =>
        actualModel === undefined
          ? `Embedding model mismatch: expected ${expectedModel}, but the record has no model`
          : `Embedding model mismatch: expected ${expectedModel}, but got ${actualModel}`,
      options,
    );
  }
}

setErrorMessage(
  EmbeddingModelMismatchError,
  ({ actual, expected }) =>
    actual === undefined
      ? `埋め込みモデルが一致しません: ${expected} を期待しましたが、レコードにモデル名がありません`
      : `埋め込みモデルが一致しません: ${expected} を期待しましたが、${actual} を受け取りました`,
  "ja",
);
