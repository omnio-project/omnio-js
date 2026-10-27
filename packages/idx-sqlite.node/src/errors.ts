import {
  type ErrorMeta,
  type ErrorOptions,
  DbErrorBase,
  setErrorMessage,
  InvalidUsageErrorBase,
} from "@omniojs/core";

/**
 * `@omniojs/idx-sqlite.node` パッケージにおけるエラークラスの基底です。
 *
 * @example
 * ```
 * import { SqliteNodeErrorBase } from "@omniojs/idx-sqlite.node";
 *
 * class MyError extends SqliteNodeErrorBase<{ readonly detail: string }> {}
 * ```
 */
export class SqliteNodeErrorBase<
  TMeta extends ErrorMeta | undefined = ErrorMeta | undefined,
> extends DbErrorBase<TMeta> {}

/**
 * `SqliteNodeDialectError` のメタデータです。
 */
export type SqliteNodeDialectErrorMeta = {
  /** 対応していない処理の名前です。 */
  readonly operation: string;
};

/**
 * `SqliteNodeDialectError` のコンストラクター引数です。
 */
export type SqliteNodeDialectErrorArgs = ErrorOptions & SqliteNodeDialectErrorMeta;

/**
 * node:sqlite ダイアレクトが対応していない処理を要求したことを示すエラーです。
 *
 * @example
 * ```
 * import { SqliteNodeDialectError } from "@omniojs/idx-sqlite.node";
 *
 * throw new SqliteNodeDialectError({ operation: "stream" });
 * ```
 */
export class SqliteNodeDialectError extends InvalidUsageErrorBase<SqliteNodeDialectErrorMeta> {
  static {
    this.prototype.name = "OmnioSqliteNodeDialectError";
  }

  public constructor(args: SqliteNodeDialectErrorArgs) {
    const { operation, ...options } = args;
    const meta: SqliteNodeDialectErrorMeta = { operation };
    super(
      meta,
      ({ operation: failedOperation }) =>
        `Unsupported operation in the node:sqlite dialect: ${failedOperation}`,
      options,
    );
  }
}

setErrorMessage(
  SqliteNodeDialectError,
  ({ operation }) => `node:sqlite ダイアレクトでは対応していない処理です: ${operation}`,
  "ja",
);
