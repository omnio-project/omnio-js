import type { IValueStream, UniKvsBuildOptions } from "unikvs";

/**
 * 実体ストレージーの操作に渡す実行時変数です。
 */
export type IOmnioEntityVariables =
  | Readonly<Record<string, unknown>>
  | Iterable<readonly [name: string, value: unknown]>;

/**
 * 実体ストレージーの読み取りオプションです。
 */
export type IOmnioEntityReadOptions = {
  /** 中断シグナルです。 */
  readonly signal?: AbortSignal | undefined;

  /**
   * 実行時変数です。
   *
   * チェックサムの期待値を渡すと、実体ストレージーのミドルウェアが読み取り時に検証します。
   */
  readonly vars?: IOmnioEntityVariables | undefined;
};

/**
 * `Omnio` が実体の保存に使うストレージーの JavaScript インターフェースです。
 *
 * unikvs ビルダーが `build()` で作成した `UniKvs` インスタンスがこの形を満たします。
 * キーは文字列であり、値はバイト列です。
 *
 * `Omnio` は一度保存した `entityId` のバイト列を変更しません。
 * 同じ `entityId` の内容が変わることはないという前提で読み取ります。
 */
export interface IOmnioEntity {
  /**
   * ストレージーを開きます。
   *
   * @param options 中断シグナルなどの任意項目です。
   */
  open(options?: { signal?: AbortSignal }): Promise<void>;

  /**
   * ストレージーを閉じます。
   *
   * @param options 中断シグナルなどの任意項目です。
   */
  close(options?: { signal?: AbortSignal }): Promise<void>;

  /**
   * キーが存在するかを確認します。
   *
   * @param key 確認するキーです。
   * @param options 中断シグナルなどの任意項目です。
   *
   * @returns 存在する場合は true、そうでない場合は false です。
   */
  has(key: string, options?: { signal?: AbortSignal }): Promise<boolean>;

  /**
   * バイト列を取得します。存在しない場合はエラーを投げます。
   *
   * @param key 取得するキーです。
   * @param options 中断シグナルと実行時変数などの任意項目です。
   *
   * @returns バイト列を解決する Promise です。
   */
  get(key: string, options?: IOmnioEntityReadOptions): Promise<Uint8Array>;

  /**
   * バイト列を保存します。
   *
   * @param key 保存するキーです。
   * @param value 保存するバイト列またはそのストリームです。
   * @param options 中断シグナルと実行時変数などの任意項目です。
   */
  set(
    key: string,
    value: Uint8Array | ReadableStream<Uint8Array>,
    options?: {
      vars?: IOmnioEntityVariables | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<void>;

  /**
   * バイト列を別のキーへ複製します。
   *
   * 複製先が既に存在する場合は上書きします。
   *
   * @param key 複製元のキーです。
   * @param destinationKey 複製先のキーです。
   * @param options 中断シグナルなどの任意項目です。
   */
  copy(key: string, destinationKey: string, options?: { signal?: AbortSignal }): Promise<void>;

  /**
   * バイト列を削除します。存在しない場合は何もしません。
   *
   * @param key 削除するキーです。
   * @param options 中断シグナルなどの任意項目です。
   */
  delete(key: string, options?: { signal?: AbortSignal }): Promise<void>;

  /**
   * バイト列をストリームで取得します。存在しない場合はエラーを投げます。
   *
   * @param key 取得するキーです。
   * @param options 中断シグナルと実行時変数などの任意項目です。
   *
   * @returns バイト列のストリームを解決する Promise です。
   */
  stream(key: string, options?: IOmnioEntityReadOptions): Promise<IValueStream<Uint8Array>>;
}

/**
 * `Omnio` が実体の保存に使うストレージーを構築するビルダーの JavaScript インターフェースです。
 *
 * unikvs の `persist()` まで構成したビルダーがこの形を満たします。
 * `Omnio` はコンストラクターで `build()` を実行します。
 */
export interface IOmnioEntityBuilder {
  /**
   * 実体ストレージーを構築します。
   *
   * `Omnio` は SHA-256 チェックサムを計算・検証するミドルウェアを `beforeAll` に指定して呼び出します。
   * 実体ビルダーに別の `ChecksumSha256` が含まれていても、`Omnio` が指定したインスタンスの結果だけを使います。
   * 実装はこのオプションを unikvs の `build()` に引き渡してください。
   *
   * @param options ビルドオプションです。
   *
   * @returns 構築した実体ストレージーです。
   */
  build(options?: UniKvsBuildOptions): IOmnioEntity;
}
