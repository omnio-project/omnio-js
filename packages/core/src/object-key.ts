import { safeParse } from "valibot";

import utf8 from "./_utf8.js";
import { InvalidOmnioKeyError } from "./errors/errors.js";
import { ObjectKeySchema } from "./schemas.js";

/** "." の UTF-8 コードポイントです。 */
const DOT = 46;

/** "/" の UTF-8 コードポイントです。 */
const SLASH = 47;

/**
 * オブジェクトキーを解析するためのクラスです。
 *
 * z-rack の `ObjectKey` を参考にしています。
 * 内部利用のための検証省略フラグは持たず、常に検証します。
 * 接頭辞は空の接頭辞を `""` とします。
 *
 * @example
 * ```
 * import { OmnioKey } from "@omniojs/core";
 *
 * const key = OmnioKey.parse("foo/bar/baz.txt");
 * key.segments; // => ["foo", "bar", "baz.txt"]
 * key.basename; // => "baz.txt"
 * key.filename; // => "baz"
 * key.extname;  // => ".txt"
 * key.prefix;   // => "foo/bar/"
 * key.toJSON(); // => "foo/bar/baz.txt"
 * ```
 */
export class OmnioKey {
  // 一覧取得などで大量に生成するため、`#` ではなく TypeScript の private を使います。
  // ES2020 への変換時に WeakMap ベースのヘルパーが入るのを避けるためです。

  /** オブジェクトキーの UTF-8 バイト列です。 */
  private readonly buffer: Uint8Array<ArrayBuffer>;

  /** オブジェクトキーの完全な文字列表現です。 */
  private readonly keyText: string;

  /** キーセグメントの配列です。 */
  private segmentList: readonly string[] | undefined;

  /** 接頭辞です。 */
  private prefixText: string | undefined;

  /** ベース名の UTF-8 バイト列です。 */
  private baseBuffer: Uint8Array<ArrayBuffer> | null | undefined;

  /** ベース名です。 */
  private basenameText: string | undefined;

  /** 拡張子なしのオブジェクト名です。 */
  private filenameText: string | undefined;

  /** 拡張子です。 */
  private extensionText: string | undefined;

  /**
   * @param objectKey オブジェクトキー文字列です。
   */
  public constructor(objectKey: string) {
    const parsed = safeParse(ObjectKeySchema, objectKey);

    if (!parsed.success) {
      throw new InvalidOmnioKeyError({ input: objectKey });
    }

    this.buffer = utf8.encode(parsed.output);
    this.keyText = parsed.output;
  }

  /**
   * 指定された文字列が有効なオブジェクトキーであるかを確認します。
   *
   * @param objectKey 検証対象のオブジェクトキー文字列です。
   *
   * @returns 有効なキーであれば true、そうでない場合は false です。
   *
   * @example
   * ```
   * OmnioKey.check("valid/key");   // => true
   * OmnioKey.check("");           // => false
   * OmnioKey.check(" ".repeat(9999)); // => false
   * ```
   */
  public static check(objectKey: string): boolean {
    // インスタンスを生成せず、オブジェクトキーの検証だけを行います。
    return safeParse(ObjectKeySchema, objectKey).success;
  }

  /**
   * オブジェクトキー文字列を解析し、OmnioKey インスタンスを生成します。
   *
   * @param objectKey 解析対象のオブジェクトキー文字列です。
   *
   * @returns 生成された OmnioKey インスタンスです。
   *
   * @example
   * ```
   * const key = OmnioKey.parse("data/file.json");
   * key.key; // => "data/file.json"
   * ```
   */
  public static parse(objectKey: string): OmnioKey {
    return new OmnioKey(objectKey);
  }

  /**
   * オブジェクトキーです。
   */
  public get key(): string {
    return this.keyText;
  }

  /**
   * オブジェクトキーをスラッシュで区切ったセグメントの配列を取得します。
   *
   * 配列は少なくとも 1 つの要素を含んでいます。
   *
   * @example
   * ```
   * OmnioKey.parse("a/b/c").segments; // => ["a", "b", "c"]
   * ```
   */
  public get segments(): [...string[], string] {
    if (this.segmentList === undefined) {
      const bytes = this.buffer;
      const segments: string[] = [];
      let start = 0;

      for (let index = 0; index < bytes.length; index += 1) {
        if ((bytes[index] ?? 0) === SLASH) {
          segments.push(utf8.decode(bytes.subarray(start, index)));
          start = index + 1;
        }
      }

      segments.push(utf8.decode(bytes.subarray(start)));
      this.baseBuffer = bytes.subarray(start);
      this.segmentList = segments;
    }

    // 破壊的に変更されないように、常にコピーを返します。
    return this.segmentList.slice() as [...string[], string];
  }

  /**
   * オブジェクトキーの接頭辞です。
   *
   * 接頭辞はセグメントをスラッシュで結合した文字列です。
   *
   * @example
   * ```
   * OmnioKey.parse("a/b/c").prefix; // => "a/b/"
   * OmnioKey.parse("root").prefix;  // => ""
   * ```
   */
  public get prefix(): string {
    if (this.prefixText === undefined) {
      const head = this.segments.slice(0, -1);
      this.prefixText = head.length === 0 ? "" : `${head.join("/")}/`;
    }

    return this.prefixText;
  }

  /**
   * オブジェクトキーをスラッシュで区切ったときの末尾部分です。
   *
   * @example
   * ```
   * OmnioKey.parse("a/b/file.txt").basename; // => "file.txt"
   * ```
   */
  public get basename(): string {
    return (this.basenameText ??= this.segments.at(-1) ?? "");
  }

  /**
   * オブジェクトキーをファイルパスとみなしたときの、拡張子を除いたファイル名を取得します。
   *
   * ファイル名はベース名から拡張子を取り除いた文字列です。
   *
   * @example
   * ```
   * OmnioKey.parse("archive.tar.gz").filename; // => "archive.tar"
   * OmnioKey.parse(".hidden").filename;        // => ".hidden"
   * OmnioKey.parse("Makefile").filename;       // => "Makefile"
   * ```
   */
  public get filename(): string {
    if (this.filenameText === undefined) {
      // segments の計算で basebuff も確定します。
      this.segments;

      const basebuff = this.baseBuffer ?? new Uint8Array();
      const lastDotIndex = basebuff.lastIndexOf(DOT);
      let filename: string;
      let extname: string;

      if (lastDotIndex === -1 || lastDotIndex === 0) {
        // 例えば拡張子なしの Makefile や隠しファイルの .bashrc などです。
        filename = utf8.decode(basebuff);
        extname = "";
      } else {
        // ドットの前後でファイル名と拡張子を分割してデコードします。
        filename = utf8.decode(basebuff.subarray(0, lastDotIndex));
        extname = utf8.decode(basebuff.subarray(lastDotIndex));
      }

      this.filenameText = filename;
      this.extensionText = extname;
      this.baseBuffer = null;
    }

    return this.filenameText;
  }

  /**
   * ファイル名の拡張子（ドットを含む）を取得します。
   *
   * @example
   * ```
   * OmnioKey.parse("archive.tar.gz").extname; // => ".gz"
   * OmnioKey.parse(".hidden").extname;        // => ""
   * ```
   */
  public get extname(): string {
    if (this.extensionText === undefined) {
      // filename ゲッターを呼び出すことで、同時に拡張子の解析も行われます。
      this.filename;
    }

    return this.extensionText ?? "";
  }

  /**
   * JSON シリアライズ時に呼び出され、オブジェクトキーを返します。
   *
   * @returns オブジェクトキーです。
   *
   * @example
   * ```
   * JSON.stringify(OmnioKey.parse("foo/bar")); // => '"foo/bar"'
   * ```
   */
  public toJSON(): string {
    return this.keyText;
  }

  /**
   * オブジェクトを文字列に変換する際に呼び出され、オブジェクトキーを返します。
   *
   * @returns オブジェクトキーです。
   *
   * @example
   * ```
   * String(OmnioKey.parse("foo/bar")); // => "foo/bar"
   * ```
   */
  public toString(): string {
    return this.keyText;
  }
}
