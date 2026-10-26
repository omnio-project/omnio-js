import type { ValueStream } from "unikvs";

/**
 * `Omnio` が実体の保存に使うストレージーの JavaScript インターフェースです。
 *
 * unikvs の `UniKvs` インスタンスがこの形を満たします。
 * キーは文字列であり、値はバイト列です。
 */
export interface OmnioEntity {
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
   * @param options 中断シグナルなどの任意項目です。
   *
   * @returns バイト列を解決する Promise です。
   */
  get(key: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>;

  /**
   * バイト列を保存します。
   *
   * @param key 保存するキーです。
   * @param value 保存するバイト列またはそのストリームです。
   * @param options 中断シグナルなどの任意項目です。
   */
  set(
    key: string,
    value: Uint8Array | ReadableStream<Uint8Array>,
    options?: { signal?: AbortSignal },
  ): Promise<void>;

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
   * @param options 中断シグナルなどの任意項目です。
   *
   * @returns バイト列のストリームを解決する Promise です。
   */
  stream(key: string, options?: { signal?: AbortSignal }): Promise<ValueStream<Uint8Array>>;
}
