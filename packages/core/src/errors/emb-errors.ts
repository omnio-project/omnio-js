import { type ErrorMeta, type ErrorOptions, setErrorMessage } from "i18n-error-base";

import { ErrorBase } from "./errors.js";

/**
 * `@omniojs/emb-*` パッケージにおけるエラークラスの基底です。
 *
 * @example
 * ```
 * import { EmbErrorBase } from "@omniojs/core";
 *
 * class MyEmbError extends EmbErrorBase<{ readonly detail: string }> {}
 * ```
 */
export class EmbErrorBase<
  TMeta extends ErrorMeta | undefined = ErrorMeta | undefined,
> extends ErrorBase<TMeta> {}

/**
 * `UnsupportedModalityError` のメタデータです。
 */
export type UnsupportedModalityErrorMeta = {
  /** 要求されたモダリティー名です。 */
  readonly actual: string;

  /** 対応しているモダリティー名の一覧です。 */
  readonly supported: readonly string[];
};

/**
 * `UnsupportedModalityError` のコンストラクター引数です。
 */
export type UnsupportedModalityErrorArgs = ErrorOptions & UnsupportedModalityErrorMeta;

/**
 * 埋め込み器が対応していないモダリティーを要求したことを示すエラーです。
 *
 * @example
 * ```
 * import { UnsupportedModalityError } from "@omniojs/core";
 *
 * throw new UnsupportedModalityError({ actual: "image", supported: ["text"] });
 * ```
 */
export class UnsupportedModalityError extends EmbErrorBase<UnsupportedModalityErrorMeta> {
  static {
    this.prototype.name = "OmnioUnsupportedModalityError";
  }

  public constructor(args: UnsupportedModalityErrorArgs) {
    const { actual, supported, ...options } = args;
    const meta: UnsupportedModalityErrorMeta = {
      actual,
      supported: Object.freeze([...supported]),
    };
    super(
      meta,
      ({ actual: actualModality, supported: supportedModalities }) =>
        `Unsupported modality: ${actualModality} (supported: ${supportedModalities.join(", ")})`,
      options,
    );
  }
}

setErrorMessage(
  UnsupportedModalityError,
  ({ actual, supported }) =>
    `対応していないモダリティーです: ${actual} (対応: ${supported.join("、")})`,
  "ja",
);

/**
 * `EmbedFailedError` のメタデータです。
 */
export type EmbedFailedErrorMeta = {
  /** 埋め込みに失敗した入力の種類です。 */
  readonly kind: string;
};

/**
 * `EmbedFailedError` のコンストラクター引数です。
 */
export type EmbedFailedErrorArgs = ErrorOptions & EmbedFailedErrorMeta;

/**
 * 入力の埋め込みに失敗したことを示すエラーです。
 *
 * @example
 * ```
 * import { EmbedFailedError } from "@omniojs/core";
 *
 * throw new EmbedFailedError({ kind: "text", cause: originalError });
 * ```
 */
export class EmbedFailedError extends EmbErrorBase<EmbedFailedErrorMeta> {
  static {
    this.prototype.name = "OmnioEmbedFailedError";
  }

  public constructor(args: EmbedFailedErrorArgs) {
    const { kind, ...options } = args;
    const meta: EmbedFailedErrorMeta = { kind };
    super(meta, ({ kind: failedKind }) => `Failed to embed input of kind: ${failedKind}`, options);
  }
}

setErrorMessage(
  EmbedFailedError,
  ({ kind }) => `種類 ${kind} の入力の埋め込みに失敗しました`,
  "ja",
);

/**
 * `ModelLoadError` のメタデータです。
 */
export type ModelLoadErrorMeta = {
  /** 読み込みに失敗したモデル名です。 */
  readonly model: string;
};

/**
 * `ModelLoadError` のコンストラクター引数です。
 */
export type ModelLoadErrorArgs = ErrorOptions & ModelLoadErrorMeta;

/**
 * 埋め込みモデルの読み込みに失敗したことを示すエラーです。
 *
 * @example
 * ```
 * import { ModelLoadError } from "@omniojs/core";
 *
 * throw new ModelLoadError({ model: "embeddinggemma-2", cause: originalError });
 * ```
 */
export class ModelLoadError extends EmbErrorBase<ModelLoadErrorMeta> {
  static {
    this.prototype.name = "OmnioModelLoadError";
  }

  public constructor(args: ModelLoadErrorArgs) {
    const { model, ...options } = args;
    const meta: ModelLoadErrorMeta = { model };
    super(
      meta,
      ({ model: failedModel }) => `Failed to load embedding model: ${failedModel}`,
      options,
    );
  }
}

setErrorMessage(
  ModelLoadError,
  ({ model }) => `埋め込みモデルの読み込みに失敗しました: ${model}`,
  "ja",
);
