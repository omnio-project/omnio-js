// oxlint-disable import/no-namespace
import type {
  Tensor,
  DataType,
  RawImage,
  DeviceType,
  EmbeddingGemma2Model,
  EmbeddingGemma2Processor,
  FeatureExtractionPipeline,
} from "@huggingface/transformers";
import {
  type IEmbedder,
  type EmbedderInfo,
  ModelLoadError,
  EmbedFailedError,
  UnsupportedModalityError,
} from "@omniojs/core";
import { asyncmux } from "asyncmux";
import * as v from "valibot";

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
 * `Gemma2Embedder` のコンストラクター引数を検証するスキーマです。
 */
const Gemma2EmbedderOptionsSchema = v.object({
  dims: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
  dtype: v.optional(
    v.picklist([
      "auto",
      "fp32",
      "fp16",
      "q8",
      "int8",
      "uint8",
      "q4",
      "bnb4",
      "q4f16",
      "q2",
      "q2f16",
      "q1",
      "q1f16",
    ]),
  ),
  model: v.optional(v.pipe(v.string(), v.minLength(1))),
  device: v.optional(
    v.picklist([
      "auto",
      "gpu",
      "cpu",
      "wasm",
      "webgpu",
      "cuda",
      "dml",
      "coreml",
      "webnn",
      "webnn-npu",
      "webnn-gpu",
      "webnn-cpu",
    ]),
  ),
  subfolder: v.optional(v.pipe(v.string(), v.minLength(1))),
});

/**
 * 画像埋め込みに使うプロセッサーとモデルの組です。
 */
interface ImageBackend {
  readonly processor: EmbeddingGemma2Processor;
  readonly model: EmbeddingGemma2Model;
}

/**
 * EmbeddingGemma 2 による `IEmbedder` の実装です。
 *
 * テキストと画像の埋め込みに対応します。両者は共有の埋め込み空間に写像します。
 *
 * すべての非同期メソッドは `asyncmux` によりインスタンス単位で排他します。
 * データの整合性のためではなく、推論器の初期化と埋め込み操作が同時実行されないためです。
 */
export class Gemma2Embedder implements IEmbedder {
  /** 埋め込み器の能力情報です。 */
  public readonly info: EmbedderInfo;

  #loading: Promise<FeatureExtractionPipeline> | undefined;

  #imageBackend: Promise<ImageBackend> | undefined;

  readonly #model: string;

  readonly #dtype: DataType;

  readonly #subfolder: string;

  readonly #dims: number;

  readonly #device: DeviceType | undefined;

  /**
   * @param options モデル ID や次元数などの設定です。
   */
  public constructor(options: Gemma2EmbedderOptions = {}) {
    const parsed = v.parse(Gemma2EmbedderOptionsSchema, options);
    const dims = parsed.dims ?? DEFAULT_DIMS;
    this.#model = parsed.model ?? DEFAULT_MODEL_ID;
    this.#dtype = parsed.dtype ?? DEFAULT_DTYPE;
    this.#subfolder = parsed.subfolder ?? DEFAULT_SUBFOLDER;
    this.#dims = dims;
    this.#device = parsed.device;
    this.info = {
      dims,
      name: this.#model,
      modalities: ["text", "image"],
      normalized: true,
      multilingual: true,
    };
  }

  /**
   * 指定したモダリティーに対応しているかを確認します。
   *
   * @param c モダリティー対応を確認する操作のコンテキストです。
   *
   * @returns テキストまたは画像の場合は true、そうでない場合は false です。
   */
  public supports(c: IEmbedder.SupportsContext): boolean {
    return c.modality === "text" || c.modality === "image";
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

    using _lock = await asyncmux(this, c.signal);

    if (c.input.kind === "text") {
      const vectors = await this.#embedBatch([c.input.text], c.signal);

      return this.#requireVector(vectors[0], "text");
    }

    if (c.input.kind === "image") {
      const rawImage = await this.#decodeImage(c.input.data, c.input.mimeType, c.signal);
      const vectors = await this.#embedImages([rawImage], c.signal);

      return this.#requireVector(vectors[0], "image");
    }

    const kind: string = (c.input as { kind: string }).kind;

    throw new UnsupportedModalityError({
      actual: kind,
      supported: ["text", "image"],
    });
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

    using _lock = await asyncmux(this, c.signal);

    const texts: {
      text: string;
      index: number;
    }[] = [];
    const images: {
      image: RawImage;
      index: number;
    }[] = [];

    for (const [index, input] of c.inputs.entries()) {
      if (input.kind === "text") {
        texts.push({
          text: input.text,
          index,
        });

        continue;
      }

      if (input.kind === "image") {
        images.push({
          image: await this.#decodeImage(input.data, input.mimeType, c.signal),
          index,
        });

        continue;
      }

      const kind: string = (input as { kind: string }).kind;

      throw new UnsupportedModalityError({
        actual: kind,
        supported: ["text", "image"],
      });
    }

    if (texts.length === 0 && images.length === 0) {
      return [];
    }

    const textVectors =
      texts.length === 0
        ? []
        : await this.#embedBatch(
            texts.map((entry) => entry.text),
            c.signal,
          );
    const imageVectors =
      images.length === 0
        ? []
        : await this.#embedImages(
            images.map((entry) => entry.image),
            c.signal,
          );
    const vectors: Float32Array[] = [];

    for (const [position, entry] of texts.entries()) {
      vectors[entry.index] = this.#requireVector(textVectors[position], "text");
    }

    for (const [position, entry] of images.entries()) {
      vectors[entry.index] = this.#requireVector(imageVectors[position], "image");
    }

    return vectors;
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

    using _lock = await asyncmux(this, c.signal);

    const vectors = await this.#embedBatch([c.text], c.signal);

    return this.#requireVector(vectors[0], "text");
  }

  /**
   * 推論器を取得します。初回はモデルを読み込みます。
   *
   * @returns 推論器を解決する Promise です。
   */
  async #getExtractor(): Promise<FeatureExtractionPipeline> {
    this.#loading ??= this.#loadExtractor();

    return this.#loading;
  }

  /**
   * 画像用のプロセッサーとモデルを取得します。初回は読み込みます。
   *
   * @returns プロセッサーとモデルの組を解決する Promise です。
   */
  async #getImageBackend(): Promise<ImageBackend> {
    this.#imageBackend ??= this.#loadImageBackend();

    return this.#imageBackend;
  }

  /**
   * モデルの読み込み設定を作ります。
   *
   * @returns dtype、device、subfolder を含む読み込み設定です。
   */
  #modelLoadOptions(): {
    dtype: DataType;
    device?: DeviceType;
    subfolder: string;
  } {
    const options: {
      dtype: DataType;
      device?: DeviceType;
      subfolder: string;
    } = {
      dtype: this.#dtype,
      subfolder: this.#subfolder,
    };

    if (this.#device !== undefined) {
      options.device = this.#device;
    }

    return options;
  }

  /**
   * モデルを読み込んで推論器を作ります。
   *
   * @returns 推論器を解決する Promise です。
   */
  async #loadExtractor(): Promise<FeatureExtractionPipeline> {
    try {
      const { pipeline } = await import("@huggingface/transformers");

      return await pipeline("feature-extraction", this.#model, this.#modelLoadOptions());
    } catch (ex) {
      this.#loading = undefined;
      throw new ModelLoadError({
        cause: ex,
        model: this.#model,
      });
    }
  }

  /**
   * 画像用のプロセッサーとモデルを読み込みます。
   *
   * テキスト用のパイプラインとは別に読み込みます。
   * 非テキストの埋め込みにはパイプラインではなく直接の呼び出しが必要です。
   *
   * @returns プロセッサーとモデルの組を解決する Promise です。
   */
  async #loadImageBackend(): Promise<ImageBackend> {
    try {
      const { AutoModel, AutoProcessor } = await import("@huggingface/transformers");
      const options = this.#modelLoadOptions();
      const processor = await AutoProcessor.from_pretrained(this.#model, options);
      const model = await AutoModel.from_pretrained(this.#model, options);

      return {
        model: model as EmbeddingGemma2Model,
        processor: processor as EmbeddingGemma2Processor,
      };
    } catch (ex) {
      this.#imageBackend = undefined;
      throw new ModelLoadError({
        cause: ex,
        model: this.#model,
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
  async #embedBatch(texts: readonly string[], signal: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    const extractor = await this.#getExtractor();

    signal.throwIfAborted();

    let output: Tensor;

    try {
      output = await extractor([...texts], {
        pooling: "mean",
        normalize: true,
      });
    } catch (ex) {
      throw new EmbedFailedError({
        kind: "text",
        cause: ex,
      });
    }

    return this.#decodeEmbeddings(output, texts.length, "text");
  }

  /**
   * 画像データを復号して `RawImage` に変換します。
   *
   * @param data 復号する画像データです。
   * @param mimeType 画像の MIME タイプです。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns 復号した画像を解決する Promise です。
   */
  async #decodeImage(
    data: Uint8Array<ArrayBuffer> | Blob,
    mimeType: string | undefined,
    signal: AbortSignal,
  ): Promise<RawImage> {
    const { RawImage: ImageReader } = await import("@huggingface/transformers");

    try {
      const source = data instanceof Blob ? data : new Blob([data], { type: mimeType ?? "" });
      const image = await ImageReader.read(source);

      signal.throwIfAborted();

      return image;
    } catch (ex) {
      signal.throwIfAborted();
      throw new EmbedFailedError({
        kind: "image",
        cause: ex,
      });
    }
  }

  /**
   * 複数の画像をまとめて埋め込みます。
   *
   * @param rawImages 埋め込む画像の一覧です。
   * @param signal 処理を中断するための中断シグナルです。
   *
   * @returns 埋め込みベクトルの一覧を解決する Promise です。
   */
  async #embedImages(rawImages: readonly RawImage[], signal: AbortSignal): Promise<Float32Array[]> {
    const first = rawImages[0];

    if (rawImages.length === 0 || first === undefined) {
      return [];
    }

    const backend = await this.#getImageBackend();

    signal.throwIfAborted();

    let output: Tensor;

    try {
      const inputs =
        rawImages.length === 1
          ? await backend.processor(null, first)
          : await backend.processor(
              null,
              rawImages.map((image) => [image]),
            );
      const { sentence_embedding }: { sentence_embedding: Tensor } = await backend.model(inputs);
      output = sentence_embedding;
    } catch (ex) {
      throw new EmbedFailedError({
        kind: "image",
        cause: ex,
      });
    }

    return this.#decodeEmbeddings(output, rawImages.length, "image");
  }

  /**
   * モデルの出力テンソルをベクトルの一覧に変換します。
   *
   * @param output モデルが出力したテンソルです。
   * @param count 期待するベクトルの件数です。
   * @param kind 埋め込んだ入力の種類です。
   *
   * @returns 埋め込みベクトルの一覧です。
   */
  #decodeEmbeddings(output: Tensor, count: number, kind: string): Float32Array[] {
    const features = output.dims.at(-1) ?? 0;

    if (features <= 0 || output.data.length !== count * features) {
      throw new EmbedFailedError({
        kind,
        cause: new Error("Unexpected embedding shape"),
      });
    }

    const vectors: Float32Array[] = [];

    for (let index = 0; index < count; index += 1) {
      const offset = index * features;
      const native = new Float32Array(features);

      for (let position = 0; position < features; position += 1) {
        native[position] = Number(output.data[offset + position]);
      }

      vectors.push(this.#finalizeVector(native));
    }

    return vectors;
  }

  /**
   * 単一の埋め込み結果を検証します。
   *
   * @param vector 埋め込み結果です。
   * @param kind 埋め込んだ入力の種類です。
   *
   * @returns 検証済みの埋め込みベクトルです。
   */
  #requireVector(vector: Float32Array | undefined, kind: string): Float32Array {
    if (vector === undefined) {
      throw new EmbedFailedError({
        kind,
        cause: new Error("Empty embedding result"),
      });
    }

    return vector;
  }

  /**
   * ベクトルを指定した次元数に切り詰め、必要に応じて L2 正規化します。
   *
   * @param native モデルが出力したベクトルです。
   *
   * @returns 指定した次元数のベクトルです。
   */
  #finalizeVector(native: Float32Array): Float32Array {
    if (native.length <= this.#dims) {
      return native.slice();
    }

    const truncated = native.slice(0, this.#dims);
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
