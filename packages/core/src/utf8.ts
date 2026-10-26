import { FastUtf8 } from "fast-utf8";

const KiB = 1024;

/**
 * 共有の UTF-8 エンコーダーとデコーダーです。
 *
 * z-rack と同じ設定であり、不正なバイト列ではエラーを投げ、バイトオーダーマークを無視します。
 */
const utf8 = new FastUtf8({
  strict: true,
  ignoreBOM: true,
  allocateSize: 3 * KiB,
});

export default utf8;
