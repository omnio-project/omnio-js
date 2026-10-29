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

  /**
   * ハッシュ値の計算に使ったアルゴリズムです。存在しない場合もあります。
   *
   * `"sha256"` のような識別子で表します。ハッシュ値はアルゴリズムごとの形式で表現します。
   */
  readonly hashAlgorithm?: string | undefined;

  /** バイト列のサイズです。バイト単位で表します。 */
  readonly size: number;

  /** 更新時刻です。ISO 8601 文字列で表します。 */
  readonly updatedAt: string;
};

/**
 * オブジェクトの変更可能なメタデータです。
 *
 * 実体のバイト列に由来する `size` や `hash`、作成時刻などは含みません。
 * 省略した項目は変更しません。
 */
export type ObjectMetadataPatch<TUserMetadata = Record<string, unknown>> = {
  /** コンテンツタイプです。省略時は変更しません。 */
  readonly contentType?: string | undefined;

  /** 説明文です。省略時は変更しません。 */
  readonly description?: string | undefined;

  /** 絞り込み用のタグ一覧です。省略時は変更しません。空配列を指定するとすべて削除します。 */
  readonly tags?: readonly string[] | undefined;

  /** 利用者が自由に付与するメタデータです。省略時は変更しません。 */
  readonly userMetadata?: TUserMetadata | undefined;

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
export type OmnioObject<TUserMetadata = Record<string, unknown>> = OmnioSystemMetadata & {
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

  /**
   * 実体ストレージー上のキーです。UUID で表します。
   *
   * `putObject` と `copyObject` で実体を書き込むと新しい値になり、`renameObject` では維持されます。
   * 同じ `entityId` のバイト列は変更されません。
   */
  readonly entityId: string;

  /** オブジェクトを一意に識別するキーです。 */
  readonly key: OmnioKey;

  /** 絞り込み用のタグ一覧です。埋め込み対象ではありません。 */
  readonly tags: readonly string[];

  /** 利用者が自由に付与するメタデータです。 */
  readonly userMetadata: TUserMetadata;
};

/**
 * レコードの種類です。
 *
 * - `"CREATE"`: オブジェクトを新規作成したレコードです。
 * - `"UPDATE_METADATA"`: オブジェクトのメタデータを更新したレコードです。
 * - `"DELETE"`: オブジェクトを削除したレコードです。
 */
export type RecordType = "CREATE" | "UPDATE_METADATA" | "DELETE";

/**
 * `MetadataFilter` に関連する型定義を格納する名前空間です。
 *
 * @example
 * ```
 * import type { MetadataFilter } from "@omniojs/core";
 *
 * const condition: MetadataFilter.Condition = { startsWith: "image/" };
 * ```
 */
export namespace MetadataFilter {
  /**
   * メタデータの文字列に対する絞り込み条件です。
   *
   * 複数のプロパティーを指定した場合は、すべての条件を満たす必要があります。
   */
  export type Condition = {
    /** 部分一致を要求する値です。 */
    readonly contains?: string | undefined;

    /** 後方一致を要求する値です。 */
    readonly endsWith?: string | undefined;

    /** 完全一致を要求する値です。 */
    readonly equals?: string | undefined;

    /** いずれかに一致することを要求する値の一覧です。 */
    readonly in?: readonly string[] | undefined;

    /** 一致しないことを要求する値です。 */
    readonly not?: string | undefined;

    /** いずれにも一致しないことを要求する値の一覧です。 */
    readonly notIn?: readonly string[] | undefined;

    /** 前方一致を要求する値です。 */
    readonly startsWith?: string | undefined;
  };

  /**
   * メタデータのレコードタイプに対する絞り込み条件です。
   *
   * 複数のプロパティーを指定した場合は、すべての条件を満たす必要があります。
   */
  export type RecordTypeCondition = {
    /** いずれかに一致することを要求するレコードタイプです。単一のレコードタイプも指定できます。 */
    readonly in?: RecordType | readonly RecordType[] | undefined;

    /** 一致しないことを要求するレコードタイプです。単一のレコードタイプも指定できます。 */
    readonly not?: RecordType | readonly RecordType[] | undefined;
  };

  /**
   * メタデータの日時に対する絞り込み条件です。
   *
   * 複数のプロパティーを指定した場合は、すべての条件を満たす必要があります。
   */
  export type DateCondition = {
    /** 完全一致を要求する日時です。 */
    readonly equals?: string | Date | undefined;

    /** 指定日時より後であることを要求する日時です。 */
    readonly gt?: string | Date | undefined;

    /** 指定日時以降であることを要求する日時です。 */
    readonly gte?: string | Date | undefined;

    /** いずれかに一致することを要求する日時の一覧です。単一の日時も指定できます。 */
    readonly in?: string | Date | readonly (string | Date)[] | undefined;

    /** 指定日時より前であることを要求する日時です。 */
    readonly lt?: string | Date | undefined;

    /** 指定日時以前であることを要求する日時です。 */
    readonly lte?: string | Date | undefined;

    /** 一致しないことを要求する日時です。 */
    readonly not?: string | Date | undefined;

    /** いずれにも一致しないことを要求する日時の一覧です。単一の日時も指定できます。 */
    readonly notIn?: string | Date | readonly (string | Date)[] | undefined;
  };

  /**
   * メタデータのサイズに対する絞り込み条件です。
   *
   * 複数のプロパティーを指定した場合は、すべての条件を満たす必要があります。
   */
  export type SizeCondition = {
    /** 完全一致を要求するサイズです。 */
    readonly equals?: number | bigint | undefined;

    /** 指定サイズより大きいことを要求するサイズです。 */
    readonly gt?: number | bigint | undefined;

    /** 指定サイズ以上であることを要求するサイズです。 */
    readonly gte?: number | bigint | undefined;

    /** いずれかに一致することを要求するサイズの一覧です。単一のサイズも指定できます。 */
    readonly in?: number | bigint | readonly (number | bigint)[] | undefined;

    /** 指定サイズより小さいことを要求するサイズです。 */
    readonly lt?: number | bigint | undefined;

    /** 指定サイズ以下であることを要求するサイズです。 */
    readonly lte?: number | bigint | undefined;

    /** 一致しないことを要求するサイズです。単一のサイズも指定できます。 */
    readonly not?: number | bigint | readonly (number | bigint)[] | undefined;

    /** いずれにも一致しないことを要求するサイズの一覧です。 */
    readonly notIn?: readonly (number | bigint)[] | undefined;
  };

  /**
   * メタデータのタグに対する絞り込み条件です。
   *
   * 複数のプロパティーを指定した場合は、すべての条件を満たす必要があります。
   */
  export type TagsCondition = {
    /** タグ一覧全体が一致することを要求するタグ一覧です。順序は問いません。 */
    readonly equals?: readonly string[] | undefined;

    /** 含まれることを要求するタグです。 */
    readonly has?: string | undefined;

    /** 指定したタグがすべて含まれることを要求するタグ一覧です。 */
    readonly hasEvery?: readonly string[] | undefined;

    /** 指定したタグのいずれかが含まれることを要求するタグ一覧です。 */
    readonly hasSome?: readonly string[] | undefined;

    /** 空であることを要求する場合は true、空でないことを要求する場合は false です。 */
    readonly isEmpty?: boolean | undefined;
  };
}

/**
 * メタデータによる絞り込み条件です。
 */
export interface MetadataFilter {
  /** コンテンツタイプの条件です。文字列を指定すると完全一致を要求します。 */
  readonly contentType?: string | MetadataFilter.Condition | undefined;

  /**
   * 作成時刻の条件です。文字列または Date を指定すると完全一致を要求します。
   *
   * 日時は ISO 8601 形式で指定します。
   */
  readonly createdAt?: string | Date | MetadataFilter.DateCondition | undefined;

  /** 全文検索のクエリーです。 */
  readonly fullText?: string | undefined;

  /** ハッシュ値の条件です。文字列を指定すると完全一致を要求します。 */
  readonly hash?: string | MetadataFilter.Condition | undefined;

  /**
   * レコード時刻の条件です。文字列または Date を指定すると完全一致を要求します。
   *
   * 日時は ISO 8601 形式で指定します。
   */
  readonly recordTimestamp?: string | Date | MetadataFilter.DateCondition | undefined;

  /** レコードタイプの条件です。レコードタイプを指定すると完全一致を要求します。 */
  readonly recordType?: RecordType | MetadataFilter.RecordTypeCondition | undefined;

  /** サイズの条件です。数値または bigint を指定すると完全一致を要求します。 */
  readonly size?: number | bigint | MetadataFilter.SizeCondition | undefined;

  /** タグの条件です。文字列を指定するとそのタグを含むことを要求します。 */
  readonly tags?: string | MetadataFilter.TagsCondition | undefined;

  /**
   * 更新時刻の条件です。文字列または Date を指定すると完全一致を要求します。
   *
   * 日時は ISO 8601 形式で指定します。
   */
  readonly updatedAt?: string | Date | MetadataFilter.DateCondition | undefined;
}
