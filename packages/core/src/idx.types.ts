import type { MaybePromise } from "maypromise";

import type { IOpenContext, ICloseContext, IActionContext } from "./context.types.js";
import type { OmnioKey } from "./object-key.js";
import type { OmnioObject, MetadataFilter } from "./object.types.js";

/**
 * ベクトル類似度の計算方式です。
 */
export type VectorMetric = "cosine" | "dot" | "l2";

/**
 * 類似度付きのオブジェクトです。
 */
export type IndexedObject<TUserMetadata = Record<string, unknown>> = OmnioObject<TUserMetadata> & {
  /** クエリーとの類似度です。存在しない場合もあります。 */
  readonly score?: number | undefined;
};

/**
 * オブジェクトを保存する操作のコンテキストです。
 */
export interface IUpsertContext<TUserMetadata = Record<string, unknown>> extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "upsert";

  /** 保存するオブジェクトです。 */
  readonly object: OmnioObject<TUserMetadata>;
}

/**
 * オブジェクトを取得する操作のコンテキストです。
 */
export interface IGetContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "get";

  /** 取得するオブジェクトのキーです。 */
  readonly key: OmnioKey;
}

/**
 * オブジェクトを削除する操作のコンテキストです。
 */
export interface IDeleteContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "delete";

  /** 削除するオブジェクトのキーです。 */
  readonly key: OmnioKey;
}

/**
 * 削除フラグが立ったオブジェクトを物理削除する操作のコンテキストです。
 */
export interface IPurgeContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "purge";

  /** 物理削除するオブジェクトの実体 ID です。 */
  readonly entityId: string;

  /** 物理削除するオブジェクトのキーです。 */
  readonly key: OmnioKey;
}

/**
 * オブジェクトを一覧する操作のコンテキストです。
 */
export interface IListContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "list";

  /** 続きを取得するためのカーソルです。 */
  readonly cursor?: string | null | undefined;

  /** 絞り込み条件です。 */
  readonly filter?: MetadataFilter | undefined;

  /** 取得する最大件数です。 */
  readonly limit?: number | undefined;
}

/**
 * 再インデックスが必要なオブジェクトに dirty フラグを立てる操作のコンテキストです。
 */
export interface IMarkDirtyContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "markDirty";

  /** 現在使っている埋め込みモデル名です。 */
  readonly embeddingModel: string;
}

/**
 * dirty フラグが立ったオブジェクトを一覧する操作のコンテキストです。
 */
export interface IListDirtyContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "listDirty";

  /** 取得する最大件数です。 */
  readonly limit?: number | undefined;
}

/**
 * ベクトル検索する操作のコンテキストです。
 */
export interface ISearchContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "search";

  /** 対象とする埋め込みモデル名です。 */
  readonly embeddingModel?: string | undefined;

  /** 類似度計算の前に適用する絞り込み条件です。 */
  readonly filter?: MetadataFilter | undefined;

  /** ベクトル類似度の計算方式です。 */
  readonly metric?: VectorMetric | undefined;

  /** 結果に含める最小スコアです。 */
  readonly minScore?: number | undefined;

  /** 取得する最大件数です。 */
  readonly topK: number;

  /** 検索クエリーのベクトルです。 */
  readonly vector: Float32Array;
}

/**
 * `IObjectIndex` に関連する型定義を格納する名前空間です。
 *
 * @example
 * ```
 * import type { IObjectIndex } from "@omniojs/core";
 *
 * function createContext(): IObjectIndex.OpenContext {
 *   return { action: "open", signal: new AbortController().signal };
 * }
 * ```
 */
export namespace IObjectIndex {
  /**
   * 閉じる操作のコンテキストです。
   */
  export type CloseContext = ICloseContext;

  /**
   * 削除する操作のコンテキストです。
   */
  export type DeleteContext = IDeleteContext;

  /**
   * 取得する操作のコンテキストです。
   */
  export type GetContext = IGetContext;

  /**
   * 一覧する操作のコンテキストです。
   */
  export type ListContext = IListContext;

  /**
   * オブジェクトの一覧結果です。
   */
  export type ListResult<TUserMetadata = Record<string, unknown>> = {
    /** 取得したオブジェクトの一覧です。 */
    readonly items: readonly OmnioObject<TUserMetadata>[];

    /** 次の取得に使うカーソルです。続きがない場合は null です。 */
    readonly nextCursor: string | null;
  };

  /**
   * dirty フラグが立ったオブジェクトを一覧する操作のコンテキストです。
   */
  export type ListDirtyContext = IListDirtyContext;

  /**
   * 再インデックスが必要なオブジェクトに dirty フラグを立てる操作のコンテキストです。
   */
  export type MarkDirtyContext = IMarkDirtyContext;

  /**
   * 開く操作のコンテキストです。
   */
  export type OpenContext = IOpenContext;

  /**
   * 物理削除する操作のコンテキストです。
   */
  export type PurgeContext = IPurgeContext;

  /**
   * 検索する操作のコンテキストです。
   */
  export type SearchContext = ISearchContext;

  /**
   * 保存する操作のコンテキストです。
   */
  export type UpsertContext<TUserMetadata = Record<string, unknown>> =
    IUpsertContext<TUserMetadata>;
}

/**
 * メタデータとベクトルの保存先の振る舞いを規定するインターフェースです。
 *
 * `@omniojs/db-*` パッケージはこのインターフェースを実装します。
 * すべての操作は単一のコンテキストオブジェクトを受け取ります。
 *
 * @example
 * ```
 * import type { IObjectIndex } from "@omniojs/core";
 *
 * class MyIndex implements IObjectIndex {
 *   readonly isOpen = true;
 *   open(): Promise<void> {
 *     return Promise.resolve();
 *   }
 * }
 * ```
 */
export interface IObjectIndex {
  /** インデックスが現在開いているかを示します。 */
  readonly isOpen: boolean;

  /**
   * インデックスを開きます。
   *
   * @param c 開く操作のコンテキストです。
   *
   * @returns 開く処理の完了を示す Promise です。
   */
  open(c: IObjectIndex.OpenContext): MaybePromise<void>;

  /**
   * インデックスを閉じます。
   *
   * @param c 閉じる操作のコンテキストです。
   *
   * @returns 閉じる処理の完了を示す Promise です。
   */
  close(c: IObjectIndex.CloseContext): MaybePromise<void>;

  /**
   * オブジェクトを保存します。
   *
   * @param c 保存する操作のコンテキストです。
   *
   * @returns 保存処理の完了を示す Promise です。
   */
  upsert<TUserMetadata>(c: IObjectIndex.UpsertContext<TUserMetadata>): MaybePromise<void>;

  /**
   * オブジェクトを取得します。
   *
   * @param c 取得する操作のコンテキストです。
   *
   * @returns 取得したオブジェクト、存在しない場合は null を解決する Promise です。
   */
  get<TUserMetadata>(c: IObjectIndex.GetContext): MaybePromise<OmnioObject<TUserMetadata> | null>;

  /**
   * オブジェクトに削除フラグを立てます。
   *
   * 実体の削除は行いません。削除フラグが立ったレコードは通常の取得や検索から除外されます。
   *
   * @param c 削除する操作のコンテキストです。
   *
   * @returns 削除フラグを立てた場合は true、存在しなかった場合は false を解決する Promise です。
   */
  delete(c: IObjectIndex.DeleteContext): MaybePromise<boolean>;

  /**
   * 削除フラグが立ったオブジェクトを物理削除します。
   *
   * `entityId` とキーが一致する削除フラグ付きレコードだけを削除します。
   *
   * @param c 物理削除する操作のコンテキストです。
   *
   * @returns 物理削除した場合は true、対象が存在しなかった場合は false を解決する Promise です。
   */
  purge(c: IObjectIndex.PurgeContext): MaybePromise<boolean>;

  /**
   * オブジェクトを一覧します。
   *
   * @param c 一覧する操作のコンテキストです。
   *
   * @returns 一覧結果を解決する Promise です。
   */
  list<TUserMetadata>(
    c: IObjectIndex.ListContext,
  ): MaybePromise<IObjectIndex.ListResult<TUserMetadata>>;

  /**
   * 埋め込みモデルが変わったオブジェクトに dirty フラグを立てます。
   *
   * 保存済みの埋め込みモデルが `embeddingModel` と異なり、説明文を持つ有効なオブジェクトが対象です。
   *
   * @param c dirty フラグを立てる操作のコンテキストです。
   *
   * @returns dirty フラグを立てた件数を解決する Promise です。
   */
  markDirty(c: IObjectIndex.MarkDirtyContext): MaybePromise<number>;

  /**
   * dirty フラグが立ったオブジェクトを一覧します。
   *
   * 再インデックスできるよう、説明文を持つ有効なオブジェクトだけを返します。
   *
   * @param c dirty フラグが立ったオブジェクトを一覧する操作のコンテキストです。
   *
   * @returns dirty フラグが立ったオブジェクト一覧を解決する Promise です。
   */
  listDirty<TUserMetadata>(
    c: IObjectIndex.ListDirtyContext,
  ): MaybePromise<OmnioObject<TUserMetadata>[]>;

  /**
   * ベクトル検索します。
   *
   * dirty フラグまたは削除フラグが立ったオブジェクトは結果に含めません。
   *
   * @param c 検索する操作のコンテキストです。
   *
   * @returns 類似度付きのオブジェクト一覧を解決する Promise です。
   */
  search<TUserMetadata>(
    c: IObjectIndex.SearchContext,
  ): MaybePromise<IndexedObject<TUserMetadata>[]>;
}
