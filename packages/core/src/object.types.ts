import type { OmnioKey } from "./object-key.js";

/**
 * オブジェクトのシステムメタデータです。
 */
export type OmnioSystemMetadata = {
  /** コンテンツタイプです。 */
  readonly contentType: string;

  /** 作成時刻です。ISO 8601 文字列で表します。 */
  readonly createdAt: string;

  /** バイト列のハッシュ値です。存在しない場合もあります。 */
  readonly hash?: string | undefined;

  /** バイト列のサイズです。バイト単位で表します。 */
  readonly size: number;

  /** 更新時刻です。ISO 8601 文字列で表します。 */
  readonly updatedAt: string;
};

/**
 * 埋め込みベクトルの由来です。
 */
export type EmbedSource =
  | {
      /** 由来の種類です。 */
      readonly kind: "custom";

      /** 埋め込みに使ったモデル名です。 */
      readonly model: string;
    }
  | {
      /** 由来の種類です。 */
      readonly kind: "description";

      /** 埋め込みに使ったモデル名です。 */
      readonly model: string;
    }
  | {
      /** 由来の種類です。 */
      readonly kind: "image";

      /** 埋め込みに使ったモデル名です。 */
      readonly model: string;
    }
  | {
      /** 由来の種類です。 */
      readonly kind: "vector";

      /** 埋め込みに使ったモデル名です。記録がない場合もあります。 */
      readonly model?: string | undefined;
    };

/**
 * 実体とメタデータを合わせた論理単位です。
 */
export type OmnioObject<TUserMetadata = Record<string, unknown>> = {
  /** 任意のテキスト形式の説明文です。埋め込み対象にできます。 */
  readonly description?: string | undefined;

  /** 埋め込みベクトルです。未生成の場合もあります。 */
  readonly embedding?: Float32Array | undefined;

  /** 埋め込みベクトルの次元数です。未生成の場合もあります。 */
  readonly embeddingDims?: number | undefined;

  /** 埋め込みに使ったモデル名です。未生成の場合もあります。 */
  readonly embeddingModel?: string | undefined;

  /** 埋め込みベクトルの由来です。未生成の場合もあります。 */
  readonly embeddingSource?: EmbedSource | undefined;

  /** 実体ストレージー上のキーです。UUID で表します。 */
  readonly entityId: string;

  /** オブジェクトを一意に識別するキーです。 */
  readonly key: OmnioKey;

  /** システムメタデータです。 */
  readonly system: OmnioSystemMetadata;

  /** 絞り込み用のタグ一覧です。埋め込み対象ではありません。 */
  readonly tags: readonly string[];

  /** 利用者が自由に付与するメタデータです。 */
  readonly userMetadata: TUserMetadata;
};

/**
 * メタデータによる絞り込み条件です。
 */
export type MetadataFilter = {
  /** 対象とするコンテンツタイプの一覧です。 */
  readonly contentTypes?: readonly string[] | undefined;

  /** 作成時刻の下限です。ISO 8601 文字列で表します。 */
  readonly createdAfter?: string | undefined;

  /** 作成時刻の上限です。ISO 8601 文字列で表します。 */
  readonly createdBefore?: string | undefined;

  /** 全文検索のクエリーです。 */
  readonly fullText?: string | undefined;

  /** すべて含むことを要求するタグ一覧です。 */
  readonly tagsAll?: readonly string[] | undefined;

  /** いずれかを含むことを要求するタグ一覧です。 */
  readonly tagsAny?: readonly string[] | undefined;

  /** 利用者メタデータに対する条件です。 */
  readonly userMetadata?: Record<string, unknown> | undefined;
};
