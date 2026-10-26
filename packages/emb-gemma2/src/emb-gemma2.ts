import type {
  Tensor,
  DataType,
  DeviceType,
  FeatureExtractionPipeline,
} from "@huggingface/transformers";
import {
  type IEmbedder,
  type EmbedderInfo,
  ModelLoadError,
  EmbedFailedError,
  UnsupportedModalityError,
} from "@omniojs/core";

/** 既定のモデル ID です。 */
export const DEFAULT_MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";

/** 既定の量子化形式です。 */
export const DEFAULT_DTYPE: DataType = "q4";

/** 既定のサブフォルダーです。 */
export const DEFAULT_SUBFOLDER = "onnx";

/** 既定の埋め込み次元数です。 */
export const DEFAULT_DIMS = 768;

/**
 * `Gemma2Embedder` のオプションです。
 */
export interface Gemma2EmbedderOptions {
  /** 使用するモデル ID です。 */
  readonly model?: string | undefined;

  /** 使用する量子化形式です。 */
  readonly dtype?: DataType | undefined;

  /** モデルファイルのサブフォルダーです。 */
  readonly subfolder?: string | undefined;

  /** 出力ベクトルの次元数です。先頭から切り詰めて L2 正規化します。 */
  readonly dims?: number | undefined;

  /** 推論デバイスです。 */
  readonly device?: DeviceType | undefined;
}

/**
 * EmbeddingGemma 2 による `IEmbedder` の実装です。
 *
 * テキスト埋め込みに対応します。画像などの modalities は将来対応します。
 */
export class Gemma2Embedder implements IEmbedder {
  /** 埋め込み器の能力情報です。 */
  public readonly info: EmbedderInfo;

  private loading: Promise<FeatureExtractionPipeline> | undefined;

  private readonly model: string;

  private readonly dtype: DataType;

  private readonly subfolder: string;

  private readonly dims: number;

  private readonly device: DeviceType | undefined;

  /**
   * @param options モデル ID や次元数などの設定です。
   */
  public constructor(options: Gemma2EmbedderOptions = {}) {
    const dims = options.dims ?? DEFAULT_DIMS;

    if (!Number.isInteger(dims) || dims <= 0) {
      throw new RangeError(`dims must be a positive integer, but got ${dims}`);
    }

    this.model = options.model ?? DEFAULT_MODEL_ID;
    this.dtype = options.dtype ?? DEFAULT_DTYPE;
    this.subfolder = options.subfolder ?? DEFAULT_SUBFOLDER;
    this.dims = dims;
    this.device = options.device;
    this.info = {
      dims,
      name: this.model,
      modalities: ["text"],
      normalized: true,
      multilingual: true,
    };
  }

  /**
   * 指定したモダリティーに対応しているかを確認します。
   *
   * @param c モダリティー対応を確認する操作のコンテキストです。
   *
   * @returns テキストの場合は true、そうでない場合は false です。
   */
  public supports(c: IEmbedder.SupportsContext): boolean {
    return c.modality === "text";
  }

  /**
   * 入力を埋め込みます。
   *
   * @param c 埋め込む操作のコンテキストです。
   *
   * @returns 埋め込みベクトルを解決する Promise です。
   */
  public async embed(c: IEmbedder.EmbedContext): Promise<Float32Array> {
    c.signal.throwIfAborted();

    if (c.input.kind !== "text") {
      throw new UnsupportedModalityError({
        actual: c.input.kind,
        supported: ["text"],
      });
    }

    const vectors = await this.embedBatch([c.input.text], c.signal);
    const vector = vectors[0];

    if (vector === undefined) {
      throw new EmbedFailedError({
        kind: "text",
        cause: new Error("Empty embedding result"),
      });
    }

    return vector;
  }

  /**
   * 複数の入力を埋め込みます。
   *
   * @param c 複数の入力を埋め込む操作のコンテキストです。
   *
   * @returns 埋め込みベクトルの一覧を解決する Promise です。
   */
  public async embedMany(c: IEmbedder.EmbedManyContext): Promise<Float32Array[]> {
    c.signal.throwIfAborted();

    const texts: string[] = [];

    for (const input of c.inputs) {
      if (input.kind !== "text") {
        throw new UnsupportedModalityError({
          actual: input.kind,
          supported: ["text"],
        });
      }

      texts.push(input.text);
    }

    return this.embedBatch(texts, c.signal);
  }

  /**
   * テキストを埋め込みます。
   *
   * @param c テキストを埋め込む操作のコンテキストです。
   *
   * @returns 埋め込みベクトルを解決する Promise です。
   */
  public async embedText(c: IEmbedder.EmbedTextContext): Promise<Float32Array> {
    c.signal.throwIfAborted();

    const vectors = await this.embedBatch([c.text], c.signal);
    const vector = vectors[0];

    if (vector === undefined) {
      throw new EmbedFailedError({
        kind: "text",
        cause: new Error("Empty embedding result"),
      });
    }

    return vector;
  }

  /**
   * 推論器を取得します。初回はモデルを読み込みます。
   *
   * @returns 推論器を解決する Promise です。
   */
  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    this.loading ??= this.loadExtractor();

    return this.loading;
  }

  /**
   * モデルを読み込んで推論器を作ります。
   *
   * @returns 推論器を解決する Promise です。
   */
  private async loadExtractor(): Promise<FeatureExtractionPipeline> {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      const options: {
        dtype: DataType;
        device?: DeviceType;
        subfolder: string;
      } = {
        dtype: this.dtype,
        subfolder: this.subfolder,
      };

      if (this.device !== undefined) {
        options.device = this.device;
      }

      return await pipeline("feature-extraction", this.model, options);
    } catch (error) {
      this.loading = undefined;
      throw new ModelLoadError({
        cause: error,
        model: this.model,
      });
    }
  }

  /**
   * 複数のテキストをまとめて埋め込みます。
   *
   * @param texts 埋め込むテキストの一覧です。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns 埋め込みベクトルの一覧を解決する Promise です。
   */
  private async embedBatch(texts: readonly string[], signal: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    const extractor = await this.getExtractor();

    signal.throwIfAborted();

    let output: Tensor;

    try {
      output = await extractor([...texts], {
        pooling: "mean",
        normalize: true,
      });
    } catch (error) {
      throw new EmbedFailedError({
        kind: "text",
        cause: error,
      });
    }

    const features = output.dims.at(-1) ?? 0;

    if (features <= 0 || output.data.length !== texts.length * features) {
      throw new EmbedFailedError({
        kind: "text",
        cause: new Error("Unexpected embedding shape"),
      });
    }

    const vectors: Float32Array[] = [];

    for (let index = 0; index < texts.length; index += 1) {
      const offset = index * features;
      const native = new Float32Array(features);

      for (let position = 0; position < features; position += 1) {
        native[position] = Number(output.data[offset + position]);
      }

      vectors.push(this.finalizeVector(native));
    }

    return vectors;
  }

  /**
   * ベクトルを指定した次元数に切り詰め、必要に応じて L2 正規化します。
   *
   * @param native モデルが出力したベクトルです。
   *
   * @returns 指定した次元数のベクトルです。
   */
  private finalizeVector(native: Float32Array): Float32Array {
    if (native.length <= this.dims) {
      return native.slice();
    }

    const truncated = native.slice(0, this.dims);
    let norm = 0;

    for (const value of truncated) {
      norm += value * value;
    }

    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let index = 0; index < truncated.length; index += 1) {
        truncated[index] = (truncated[index] ?? 0) / norm;
      }
    }

    return truncated;
  }
}
