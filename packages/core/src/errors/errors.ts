import { type ErrorMeta, type ErrorOptions, I18nErrorBase, setErrorMessage } from "i18n-error-base";

export type { ErrorMeta, ErrorOptions };
export { setErrorMessage };

/**
 * このパッケージにおけるエラークラスの基底です。
 *
 * @example
 * ```
 * import { ErrorBase } from "@omniojs/core";
 *
 * class MyError extends ErrorBase<{ readonly code: string }> {}
 * ```
 */
export class ErrorBase<
  TMeta extends ErrorMeta | undefined = ErrorMeta | undefined,
> extends I18nErrorBase<TMeta> {}

/**
 * 不正な使用方法を示すエラークラスの基底です。
 *
 * @example
 * ```
 * import { InvalidUsageErrorBase } from "@omniojs/core";
 *
 * class MyUsageError extends InvalidUsageErrorBase<{ readonly detail: string }> {}
 * ```
 */
export class InvalidUsageErrorBase<
  TMeta extends ErrorMeta | undefined = ErrorMeta | undefined,
> extends ErrorBase<TMeta> {}

/**
 * 予期しない失敗を示すエラークラスの基底です。
 *
 * @example
 * ```
 * import { UnexpectedErrorBase } from "@omniojs/core";
 *
 * class MyUnexpectedError extends UnexpectedErrorBase<{ readonly detail: string }> {}
 * ```
 */
export class UnexpectedErrorBase<
  TMeta extends ErrorMeta | undefined = ErrorMeta | undefined,
> extends ErrorBase<TMeta> {}
