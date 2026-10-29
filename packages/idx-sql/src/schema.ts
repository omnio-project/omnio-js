/**
 * SQL インデックスの `journal` テーブルの行です。
 *
 * サイズはデータベースによって数値または文字列で返るため、両方を受け付けます。
 */
export type SqlObjectRow = {
  /** コンテンツタイプです。削除フラグ付きレコードでは null です。 */
  readonly content_type: string | null;

  /** 作成時刻です。ISO 8601 文字列で表します。削除フラグ付きレコードでは null です。 */
  readonly created_at: string | null;

  /** 任意のテキスト形式の説明文です。存在しない場合もあります。 */
  readonly description: string | null;

  /**
   * 埋め込みベクトルです。
   *
   * SQLite ではリトルエンディアンのバイト列、PostgreSQL と PGlite では pgvector の `vector` 型の文字列表現で表します。存在しない場合もあります。
   */
  readonly embedding: Uint8Array | string | null;

  /** 埋め込みベクトルの次元数です。存在しない場合もあります。 */
  readonly embedding_dims: number | null;

  /** 埋め込みに使ったモデル名です。存在しない場合もあります。 */
  readonly embedding_model: string | null;

  /** 埋め込みベクトルの由来です。JSON 文字列で表します。存在しない場合もあります。 */
  readonly embedding_source: string | null;

  /** 再インデックスが必要な場合は 1、不要な場合は 0 です。 */
  readonly dirty: number;

  /** バイト列のハッシュ値です。存在しない場合もあります。 */
  readonly hash: string | null;

  /**
   * ハッシュ値の計算に使ったアルゴリズムです。存在しない場合もあります。
   *
   * `"sha256"` のような識別子を保存します。
   */
  readonly hash_algorithm: string | null;

  /** 実体ストレージー上のキーです。UUID で表します。 */
  readonly entity_id: string;

  /** オブジェクトを一意に識別するキーです。 */
  readonly key: string;

  /** レコードの種類です。`CREATE`、`UPDATE_METADATA`、`DELETE` を保存します。 */
  readonly record_type: string;

  /** レコードの時刻です。ISO 8601 文字列で表します。 */
  readonly record_timestamp: string;

  /** バイト列のサイズです。バイト単位で表します。削除フラグ付きレコードでは null です。 */
  readonly size: number | string | null;

  /** 更新時刻です。ISO 8601 文字列で表します。削除フラグ付きレコードでは null です。 */
  readonly updated_at: string | null;

  /** 利用者が自由に付与するメタデータです。JSON 文字列で表します。削除フラグ付きレコードでは null です。 */
  readonly user_metadata: string | null;
};

/**
 * SQL インデックスの `object_tag` テーブルの行です。
 */
export type SqlObjectTagRow = {
  /** タグが付いたオブジェクトのキーです。 */
  readonly key: string;

  /** 絞り込み用のタグです。 */
  readonly tag: string;
};

/**
 * 物理削除を待つ実体の表の行です。
 */
export type SqlPendingPurgeRow = {
  /** 物理削除を待つ実体 ID です。 */
  readonly entity_id: string;

  /** 予約に保存されたオブジェクトのキーです。実体が移動した場合は更新されます。 */
  readonly key: string;

  /** 予約時刻です。ISO 8601 文字列で表します。 */
  readonly created_at: string;
};

/**
 * SQL インデックスが扱うデータベースの表定義です。
 */
export type SqlIndexDatabase = {
  /** オブジェクトの表です。 */
  readonly journal: SqlObjectRow;

  /** タグの表です。 */
  readonly object_tag: SqlObjectTagRow;

  /** 物理削除を待つ実体の表です。 */
  readonly pending_purge: SqlPendingPurgeRow;
};
