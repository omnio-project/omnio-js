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

/**
 * `InvalidOmnioKeyError` のメタデータです。
 */
export type InvalidOmnioKeyErrorMeta = {
  /** 検証に失敗した入力値です。 */
  readonly input: unknown;
};

/**
 * `InvalidOmnioKeyError` のコンストラクター引数です。
 */
export type InvalidOmnioKeyErrorArgs = ErrorOptions & InvalidOmnioKeyErrorMeta;

/**
 * オブジェクトキーが無効であることを示すエラーです。
 *
 * @example
 * ```
 * import { InvalidOmnioKeyError } from "@omniojs/core";
 *
 * throw new InvalidOmnioKeyError({ input: "" });
 * ```
 */
export class InvalidOmnioKeyError extends InvalidUsageErrorBase<InvalidOmnioKeyErrorMeta> {
  static {
    this.prototype.name = "OmnioInvalidKeyError";
  }

  public constructor(args: InvalidOmnioKeyErrorArgs) {
    const { input, ...options } = args;
    const meta: InvalidOmnioKeyErrorMeta = { input };
    super(meta, () => "Invalid object key", options);
  }
}

setErrorMessage(InvalidOmnioKeyError, () => "無効なオブジェクトキーです", "ja");

/**
 * `EntityMissingError` のメタデータです。
 */
export type EntityMissingErrorMeta = {
  /** 実体を持っていたオブジェクトのキーです。 */
  readonly key: string;

  /** 実体ストレージー上のキーです。 */
  readonly entityId: string;

  /** インデックスに保存されていたハッシュ値です。存在しない場合もあります。 */
  readonly hash?: string | undefined;
};

/**
 * `EntityMissingError` のコンストラクター引数です。
 */
export type EntityMissingErrorArgs = ErrorOptions & EntityMissingErrorMeta;

/**
 * 索引には存在するが、対応する実体のバイト列が見つからないことを示すエラーです。
 *
 * 削除との競合ではなく、データ損失や不整合を示します。
 *
 * @example
 * ```
 * import { EntityMissingError } from "@omniojs/core";
 *
 * throw new EntityMissingError({ key: "foo/bar", entityId: "..." });
 * ```
 */
export class EntityMissingError extends UnexpectedErrorBase<EntityMissingErrorMeta> {
  static {
    this.prototype.name = "OmnioEntityMissingError";
  }

  public constructor(args: EntityMissingErrorArgs) {
    const { key, hash, entityId, ...options } = args;
    const meta: EntityMissingErrorMeta =
      hash === undefined
        ? {
            key,
            entityId,
          }
        : {
            key,
            hash,
            entityId,
          };
    super(
      meta,
      ({ key: missingKey, entityId: missingEntityId }) =>
        `Entity data is missing: ${missingKey} (${missingEntityId})`,
      options,
    );
  }
}

setErrorMessage(
  EntityMissingError,
  ({ key, entityId }) => `実体データが見つかりません: ${key} (${entityId})`,
  "ja",
);

/**
 * 操作が中断されたことを示すエラーです。
 *
 * 中断シグナルの reason として使い、呼び出し側が中断理由を判別できるようにします。
 */
export class OperationAbortedError extends ErrorBase<undefined> {
  static {
    this.prototype.name = "OmnioOperationAbortedError";
  }

  public constructor(options?: ErrorOptions) {
    super("Operation aborted", options);
  }
}

setErrorMessage(OperationAbortedError, () => "操作が中断されました", "ja");
