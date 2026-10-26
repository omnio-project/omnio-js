import {
  type ErrorMeta,
  type ErrorOptions,
  DbErrorBase,
  setErrorMessage,
  InvalidUsageErrorBase,
} from "@omniojs/core";

/**
 * `@omniojs/idx-sqlite.wasm` パッケージにおけるエラークラスの基底です。
 *
 * @example
 * ```
 * import { SqliteWasmErrorBase } from "@omniojs/idx-sqlite.wasm";
 *
 * class MyError extends SqliteWasmErrorBase<{ readonly detail: string }> {}
 * ```
 */
export class SqliteWasmErrorBase<
  TMeta extends ErrorMeta | undefined = ErrorMeta | undefined,
> extends DbErrorBase<TMeta> {}

/**
 * `SqliteWasmDialectError` のメタデータです。
 */
export type SqliteWasmDialectErrorMeta = {
  /** 対応していない処理の名前です。 */
  readonly operation: string;
};

/**
 * `SqliteWasmDialectError` のコンストラクター引数です。
 */
export type SqliteWasmDialectErrorArgs = ErrorOptions & SqliteWasmDialectErrorMeta;

/**
 * SQLite WASM  dialect が対応していない処理を要求したことを示すエラーです。
 *
 * @example
 * ```
 * import { SqliteWasmDialectError } from "@omniojs/idx-sqlite.wasm";
 *
 * throw new SqliteWasmDialectError({ operation: "stream" });
 * ```
 */
export class SqliteWasmDialectError extends InvalidUsageErrorBase<SqliteWasmDialectErrorMeta> {
  static {
    this.prototype.name = "OmnioSqliteWasmDialectError";
  }

  public constructor(args: SqliteWasmDialectErrorArgs) {
    const { operation, ...options } = args;
    const meta: SqliteWasmDialectErrorMeta = { operation };
    super(
      meta,
      ({ operation: failedOperation }) =>
        `Unsupported operation in the sqlite.wasm dialect: ${failedOperation}`,
      options,
    );
  }
}

setErrorMessage(
  SqliteWasmDialectError,
  ({ operation }) => `sqlite.wasm dialect では対応していない処理です: ${operation}`,
  "ja",
);
