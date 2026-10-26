import type { MaybePromise } from "maypromise";

import type { IActionContext } from "./context.types.js";

/**
 * 埋め込み対象のモダリティーです。
 */
export type EmbedModality = "image" | "text" | (string & {});

/**
 * 埋め込み器の能力情報です。
 */
export interface EmbedderInfo {
  /** 出力ベクトルの次元数です。 */
  readonly dims: number;

  /** 入力の最大トークン数です。制限がない場合もあります。 */
  readonly maxTokens?: number | undefined;

  /** 対応しているモダリティーの一覧です。 */
  readonly modalities: readonly EmbedModality[];

  /** 多言語に対応しているかを示します。 */
  readonly multilingual: boolean;

  /** 埋め込みモデル名です。 */
  readonly name: string;

  /** 出力ベクトルが L2 正規化されているかを示します。 */
  readonly normalized: boolean;
}

/**
 * 埋め込み器への入力です。
 */
export type EmbedInput =
  | {
      /** 入力データです。 */
      readonly data: Uint8Array<ArrayBuffer> | Blob;

      /** 入力の種類です。 */
      readonly kind: "image";

      /** 入力の MIME タイプです。 */
      readonly mimeType?: string | undefined;
    }
  | {
      /** 入力の種類です。 */
      readonly kind: "text";

      /** 埋め込むテキストです。 */
      readonly text: string;
    };

/**
 * 入力を埋め込む操作のコンテキストです。
 */
export interface IEmbedContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "embed";

  /** 埋め込む入力です。 */
  readonly input: EmbedInput;
}

/**
 * 複数の入力を埋め込む操作のコンテキストです。
 */
export interface IEmbedManyContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "embedMany";

  /** 埋め込む入力の一覧です。 */
  readonly inputs: readonly EmbedInput[];
}

/**
 * テキストを埋め込む操作のコンテキストです。
 */
export interface IEmbedTextContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "embedText";

  /** 埋め込むテキストです。 */
  readonly text: string;
}

/**
 * モダリティー対応を確認する操作のコンテキストです。
 */
export interface ISupportsContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "supports";

  /** 確認するモダリティー名です。 */
  readonly modality: EmbedModality;
}

/**
 * `IEmbedder` に関連する型定義を格納する名前空間です。
 *
 * @example
 * ```
 * import type { IEmbedder } from "@omniojs/core";
 *
 * function createContext(): IEmbedder.EmbedTextContext {
 *   return { action: "embedText", signal: new AbortController().signal, text: "夕日の海辺" };
 * }
 * ```
 */
export namespace IEmbedder {
  /**
   * 埋め込む操作のコンテキストです。
   */
  export type EmbedContext = IEmbedContext;

  /**
   * 複数の入力を埋め込む操作のコンテキストです。
   */
  export type EmbedManyContext = IEmbedManyContext;

  /**
   * テキストを埋め込む操作のコンテキストです。
   */
  export type EmbedTextContext = IEmbedTextContext;

  /**
   * モダリティー対応を確認する操作のコンテキストです。
   */
  export type SupportsContext = ISupportsContext;
}

/**
 * 埋め込み推論器の振る舞いを規定するインターフェースです。
 *
 * `@omniojs/emb-*` パッケージはこのインターフェースを実装します。
 * テキスト埋め込みは必須であり、画像などの対応は任意です。
 * すべての操作は単一のコンテキストオブジェクトを受け取ります。
 *
 * @example
 * ```
 * import type { IEmbedder } from "@omniojs/core";
 *
 * class MyEmbedder implements IEmbedder {
 *   readonly info = { dims: 3, modalities: ["text"], multilingual: false, name: "mine", normalized: true };
 *   embed(): Promise<Float32Array> {
 *     return Promise.resolve(new Float32Array(3));
 *   }
 * }
 * ```
 */
export interface IEmbedder {
  /** 埋め込み器の能力情報です。 */
  readonly info: EmbedderInfo;

  /**
   * 入力を埋め込みます。
   *
   * @param c 埋め込む操作のコンテキストです。
   *
   * @returns 埋め込みベクトルを解決する Promise です。
   */
  embed(c: IEmbedder.EmbedContext): MaybePromise<Float32Array>;

  /**
   * 複数の入力を埋め込みます。
   *
   * @param c 複数の入力を埋め込む操作のコンテキストです。
   *
   * @returns 埋め込みベクトルの一覧を解決する Promise です。
   */
  embedMany(c: IEmbedder.EmbedManyContext): MaybePromise<Float32Array[]>;

  /**
   * テキストを埋め込みます。
   *
   * @param c テキストを埋め込む操作のコンテキストです。
   *
   * @returns 埋め込みベクトルを解決する Promise です。
   */
  embedText(c: IEmbedder.EmbedTextContext): MaybePromise<Float32Array>;

  /**
   * 指定したモダリティーに対応しているかを確認します。
   *
   * @param c モダリティー対応を確認する操作のコンテキストです。
   *
   * @returns 対応している場合は true、そうでない場合は false です。
   */
  supports(c: IEmbedder.SupportsContext): boolean;
}
