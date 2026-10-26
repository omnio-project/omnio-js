/**
 * `objects` テーブルの行です。
 */
export type ObjectRow = {
  /** コンテンツタイプです。 */
  readonly content_type: string;

  /** 作成時刻です。ISO 8601 文字列で表します。 */
  readonly created_at: string;

  /** 任意のテキスト形式の説明文です。存在しない場合もあります。 */
  readonly description: string | null;

  /** 埋め込みベクトルです。リトルエンディアンのバイト列で表します。存在しない場合もあります。 */
  readonly embedding: Uint8Array<ArrayBuffer> | null;

  /** 埋め込みベクトルの次元数です。存在しない場合もあります。 */
  readonly embedding_dims: number | null;

  /** 埋め込みに使ったモデル名です。存在しない場合もあります。 */
  readonly embedding_model: string | null;

  /** 埋め込みベクトルの由来です。JSON 文字列で表します。存在しない場合もあります。 */
  readonly embedding_source: string | null;

  /** バイト列のハッシュ値です。存在しない場合もあります。 */
  readonly hash: string | null;

  /** オブジェクトを一意に識別するキーです。 */
  readonly key: string;

  /** バイト列のサイズです。バイト単位で表します。 */
  readonly size: number;

  /** 更新時刻です。ISO 8601 文字列で表します。 */
  readonly updated_at: string;

  /** 利用者が自由に付与するメタデータです。JSON 文字列で表します。 */
  readonly user_metadata: string;
};

/**
 * `object_tags` テーブルの行です。
 */
export type ObjectTagRow = {
  /** タグが付いたオブジェクトのキーです。 */
  readonly key: string;

  /** 絞り込み用のタグです。 */
  readonly tag: string;
};

/**
 * kysely が扱うデータベースの表定義です。
 */
export type SqliteWasmDatabase = {
  /** オブジェクトの表です。 */
  readonly objects: ObjectRow;

  /** タグの表です。 */
  readonly object_tags: ObjectTagRow;
};
