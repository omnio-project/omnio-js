# Omnio.js 仕様書

本書は Omnio.js プロジェクトの方針、パッケージ構成、技術選定、インターフェースを定める仕様書です。
Omnio は Omni と IO を組み合わせた造語であり、オブジェクトストレージーのように動作しながら、ブラウザーからエッジ、サーバーまで幅広く使用できる IO 層を目指します。

- 対象読者: Omnio.js の設計者と実装者です。
- 言語: 本書は日本語を正文とします。英語版が必要になった場合は本書から翻訳します。
- スコープ表記: 本文中のパッケージ名は `@omniojs/*` で統一します。

## 1. 背景と目的

前身となるプロジェクトは https://github.com/tai-kun/z-rack です。
z-rack は `description` に対する検索にとどまり、意味の類似性を扱えませんでした。

Omnio.js は次の 3 点を同時に満たすことを目的とします。

1. オブジェクトストレージーのようにバイト列を保存、取得、削除できること。
2. ファイルサイズ、ファイルタイプ、タグ、ユーザーメタデータなどのメタデータを付随させ、条件で絞り込めること。
3. 埋め込み表現により、自然言語による意味検索ができること。

さらに、次の移植性要件を満たします。

- オブジェクトの実体とメタデータの保存場所を個別に変更できること。
- ブラウザー、エッジ、サーバーで同一のインターフェースが動作すること。

## 2. プロジェクト方針

1. **ポータブルなコア**を維持します。`@omniojs/core` は Node.js やブラウザーの API に直接依存しません。保存処理と推論処理はインターフェースに分離します。
2. **実体とインデックスを分離**します。実体の保存には `unikvs` を採用し、メタデータとベクトルの保存には専用の `ObjectIndex` アダプターを使います。利用者は両者を個別に選べます。
3. **既定の組み合わせを用意しません**。`Omnio` インスタンスの作成時は、データベースと埋め込み、ストレージーの指定を必須とします。暗黙のモデル選択や暗黙の保存先を作りません。
4. **マルチモーダル対応はアダプターに委ねます**。コアはテキスト埋め込みを最小要件とし、画像などの modalities はアダプターが拡張します。テキスト形式の説明文は任意のメタデータとして付随でき、その説明文の埋め込みを検索対象にできます。
5. **意味検索とタグ絞り込みを分離**します。タグは埋め込み対象ではなく、完全一致によるフィルターとして扱います。自動結合した検索用テキストは作りません。
6. **エラーを多言語化**します。エラーは `i18n-error-base` によるエラークラスで表現し、日本語と英語のメッセージを必ず用意します。
7. **型安全と明示性**を優先します。すべての公開 API に TypeScript のシグネチャーを定義します。呼び出し側がベクトルを直接渡す経路も用意し、埋め込み器に依存しない利用を可能にします。

## 3. 用語定義

| 用語          | 意味                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Object        | 実体とメタデータを合わせた論理単位です。`key` で一意に識別します。                                       |
| Entity        | オブジェクトのバイト列です。`unikvs` に `Uint8Array` として保存します。                                  |
| Metadata      | サイズ、コンテンツタイプ、説明文、タグ、ユーザーメタデータ、時刻などです。                               |
| Description   | 任意のテキスト形式の説明文です。埋め込み対象にできるメタデータです。                                     |
| Tags          | 絞り込み用の文字列配列です。埋め込み対象ではありません。                                                 |
| User metadata | 利用者が自由に付与する JSON 値です。既定では埋め込み対象ではありません。                                 |
| Embedder      | 入力を固定長の `Float32Array` に変換する推論器です。テキスト対応は必須であり、画像などの対応は任意です。 |
| ObjectIndex   | メタデータとベクトルの保存先です。SQLite、PGLite、Postgres などが該当します。                            |
| Omnio         | `unikvs` と `ObjectIndex` と `Embedder` を束ねるファサードです。利用者が直接操作する入口になります。     |

`Searchable text` という概念は採用しません。
タイトルやユーザーメタデータを自動結合して埋め込む方式は、マルチモーダル埋め込みと相性が悪く、検索の再現性を損なうためです。
何を埋め込むかは呼び出し時の入力で明示します。

## 4. 全体アーキテクチャー

```text
+----------------+      put / get / delete      +------------------+
|     Omnio      | --------------------------> |      unikvs      |
|    (facade)    | <-------------------------- |     (entity)     |
+-------+--------+        Uint8Array           +-------+----------+
        |                                             |
        | upsert / get / search                       | @unikvs/memory
        v                                             | @unikvs/opfs
+-------+--------+                                    | @unikvs/fs.node
|  ObjectIndex   |                                    | @unikvs/s3.node など
| (metadata +    |                                    |
|  vector)       |                                    |
+-------+--------+                                    |
        ^                                             |
        | embed / vector                              |
+-------+--------+                                    |
|    Embedder    |                                    |
| (text required,|                                    |
|  others opt.)  |                                    |
+----------------+                                    |
```

- 実体の入出力はすべて `unikvs` クライアントを経由します。Omnio は独自の `EntityStore` を定義しません。
- メタデータとベクトルの入出力は `ObjectIndex` を経由します。
- 埋め込みの生成は `Embedder` を経由します。呼び出し側がベクトルを直接渡すこともできます。
- `Omnio` は 3 者の配線と、ハッシュ計算や時刻付与などの調整のみを担当します。

## 5. パッケージ構成

### 5.1 パッケージ一覧

| パッケージ                 | 役割                                                                                              | 備考                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `omnio`                    | 再公開用のエントリーポイントです。`core` の型と各アダプターの工場関数をまとめます。               | 暗黙の既定構成は持ちません。                                               |
| `@omniojs/core`            | 型、`Omnio` クラス、エラー基底、`ObjectIndex` と `Embedder` のインターフェースを定義します。      | 依存ゼロを目指します。`unikvs` と `i18n-error-base` の型のみに依存します。 |
| `@omniojs/db-pglite`       | PGLite と `pgvector` による `ObjectIndex` 実装です。                                              | ブラウザー、エッジ、Node.js を対象とします。                               |
| `@omniojs/idx-sqlite.wasm` | WASM 版 SQLite と kysely による `ObjectIndex` 実装です。ブラウザーと Node.js の両方で動作します。 | 既定はメモリーです。ファイル保存は将来対応します。                         |
| `@omniojs/emb-gemma2`      | EmbeddingGemma 2 による `Embedder` 実装です。                                                     | テキスト埋め込みを必須とし、画像対応はモデルの対応範囲で拡張します。       |

実体保存用の独自パッケージは作りません。
`unikvs` 本体と `@unikvs/*` のストレージーパッケージをそのまま利用します。

| 用途                 | 利用するパッケージ例                                      |
| -------------------- | --------------------------------------------------------- |
| テストと少量デモ     | `@unikvs/memory`                                          |
| ブラウザー本番       | `@unikvs/opfs`、`@unikvs/indexeddb`                       |
| Node.js 単体         | `@unikvs/fs.node`                                         |
| エッジとサーバー本番 | `@unikvs/s3.node`、`@unikvs/s3.bun`、`@unikvs/redis.node` |
| 透過的な圧縮や検証   | `@unikvs/compression`、`@unikvs/checksum`                 |

### 5.2 将来のパッケージ候補

| パッケージ候補         | 役割                                                       | 優先度 |
| ---------------------- | ---------------------------------------------------------- | ------ |
| `@omniojs/db-d1`       | Cloudflare D1 と Vectorize による `ObjectIndex` 実装です。 | 中     |
| `@omniojs/db-postgres` | 外部 Postgres による `ObjectIndex` 実装です。              | 中     |
| `@omniojs/emb-openai`  | 外部埋め込み API による `Embedder` 実装です。              | 中     |
| `@omniojs/emb-mini`    | さらに軽量なモデルによる代替 `Embedder` 実装です。         | 低     |

`core` に特定ベンダーの SDK を入れない方針は維持します。

## 6. 技術選定

### 6.1 言語とツールチェーン

- TypeScript を必須とし、厳格な型設定を維持します。
- ビルド、テスト、リントは現行の Vite+ 構成を継続します。
- ブラウザーとサーバーのテストは、既存の `vite.client.config.ts` と `vite.server.config.ts` で分離します。

### 6.2 実体保存: `unikvs`

Entity の保存には https://tai-kun.github.io/unikvs/ を採用します。
理由は、メモリー、OPFS、ファイルシステム、S3 などを同一のインターフェースで切り替えでき、圧縮やチェックサムをトランスフォーマーとして透過的に追加できるためです。

Omnio が要求する `unikvs` の値型は次のとおりです。

```ts
import { UniKvs, type Value } from "unikvs";

type OmnioEntitySchema = {
  [key: string]: Value<Uint8Array<ArrayBuffer>>;
};
```

`Value<Uint8Array<ArrayBuffer>>` を使うことで、通常取得の `get` とストリーム取得の `stream` の両方に対応します。
動的キーを使う場合は、Valibot による配列形式スキーマを使います。

```ts
import { StreamValue, UniKvs } from "unikvs";
import * as v from "valibot";

const entity = UniKvs.config({
  schema: [[v.string(), StreamValue(v.instance(Uint8Array))]],
})
  .persist(storage)
  .create();
```

ライフサイクルは `unikvs` に合わせます。
`Omnio` は `open()` と `close()` を公開し、内部で `unikvs` クライアントと `ObjectIndex` の初期化と終了処理を呼び出します。

### 6.3 メタデータとベクトル保存

| 選択肢                              | 用途                                 | 理由                                                                                   | 注意点                                                                       |
| ----------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| PGLite と `pgvector`                | ブラウザー、エッジ、サーバーの選択肢 | Postgres 互換であり、JSONB によるメタデータ検索とベクトル検索を 1 つで扱えます。       | WASM の初期サイズが大きく、OPFS との併用設計が必要です。                     |
| `@sqlite.org/sqlite-wasm` と kysely | ブラウザーと Node.js の軽量な選択肢  | WASM で動作し、DB サーバーが不要です。SQL 構築とマイグレーションは kysely で行います。 | ベクトル検索は当面 JavaScript で総当たり計算します。永続化は将来対応します。 |
| 外部 Postgres と `pgvector`         | サーバー本番の選択肢                 | PGLite と SQL 互換性があります。                                                       | 接続プールとマイグレーションの扱いを別途定めます。                           |

ベクトル距離は既定でコサイン類似度とします。内積と L2 距離はオプションで切り替えます。

### 6.4 埋め込み: EmbeddingGemma 2

`@omniojs/emb-gemma2` は、Google DeepMind が 2026 年 10 月 6 日に公開した軽量かつオープンなマルチモーダル埋め込みモデルである EmbeddingGemma 2 を使用します。
具体的には Transformers.js 用の ONNX 版である `onnx-community/embeddinggemma-2-ONNX` を読み込みます。

実装要件は次のとおりです。

- Hugging Face Transformers.js（`@huggingface/transformers`）による ONNX 推論であること。
- 既定の量子化形式は q4 とし、次元数は 768 とします。`dims` オプションで先頭からの切り詰めに対応し、切り詰め後は L2 再正規化します。
- 日本語と英語の検索品質を優先し、多言語対応を明示すること。
- 次元数、量子化方式、最大トークン長、正規化の有無を `EmbedderInfo` として公開すること。
- モデル取得元、ライセンス、キャッシュ方法を文書化すること。
- v1 ではテキスト埋め込みのみに対応し、画像などの modalities は将来対応とします。

次元数は実装で固定値とせず、モデルの定義値を使います。
DB 側のカラム定義は `EmbedderInfo.dims` と一致させ、モデル名と次元数をレコードごとに保存します。

### 6.5 エラー: `i18n-error-base`

エラーは `i18n-error-base` の `I18nErrorBase` を基底とする専用クラスで表現します。
Valibot の `lang` 設定と連動し、`message` の読み取り時に日本語と英語を切り替えます。
未登録の言語はコンストラクターの既定メッセージを使います。

## 7. データモデル

### 7.1 オブジェクトレコード

```ts
class OmnioKey {
  static parse(objectKey: string): OmnioKey;
  static check(objectKey: string): boolean;
  get key(): string;
  get segments(): [...string[], string];
  get prefix(): string;
  get basename(): string;
  get filename(): string;
  get extname(): string;
}

type OmnioSystemMetadata = {
  size: number;
  contentType: string;
  hash?: string;
  createdAt: string;
  updatedAt: string;
};

type OmnioObject<TUserMetadata = Record<string, unknown>> = {
  key: OmnioKey;
  system: OmnioSystemMetadata;
  description?: string;
  tags: string[];
  userMetadata: TUserMetadata;
  embedding?: Float32Array;
  embeddingModel?: string;
  embeddingDims?: number;
  embeddingSource?: EmbedSource;
};

type EmbedSource =
  | { kind: "description"; model: string }
  | { kind: "vector"; model?: string }
  | { kind: "image"; model: string }
  | { kind: "custom"; model: string };
```

設計上の注意は次のとおりです。

- `OmnioKey` は z-rack の `ObjectKey` を参考にしたクラスです。`key` には文字列ではなくインスタンスを持ちます。1 文字以上 1024 文字以下であり、正しい UTF-8 で 1024 バイト以下です。無効な値は `InvalidOmnioKeyError` となります。
- `description` は任意項目です。指定された場合のみ埋め込み対象にできます。
- `tags` と `userMetadata` は既定では埋め込み対象ではありません。タグは絞り込みに使います。
- `hash` は既定で SHA-256 とし、重複検出と完全性確認に使います。
- 時刻は ISO 8601 文字列で保存します。
- `embeddingModel` と `embeddingDims` は、モデル混在時の誤検索を防ぐために保存します。

### 7.2 埋め込み入力の明示

自動結合した検索用テキストは作りません。
呼び出し側は次のいずれかで埋め込み内容を明示します。

1. `description` を渡し、サーバー側でテキスト埋め込みを生成する。
2. 画像などの入力を渡し、対応アダプターで埋め込みを生成する。
3. 事前に計算した `Float32Array` を直接渡す。

### 7.3 検証規則

`@omniojs/core` の `schemas` は valibot による検証スキーマを提供します。
S3 の制限と z-rack の慣習を参考にしています。

- オブジェクトキー: 1 文字以上 1024 文字以下であり、正しい UTF-8 で 1024 バイト以下です。
- タグ: 1 文字以上 128 文字以下であり、正しい UTF-8 で 128 バイト以下です。
- タグ配列: 最大 10 件です。
- サイズ: 0 以上 5 TiB 以下の安全な整数です。
- 時刻: ISO 8601 文字列です。
- ハッシュ値: SHA-256 の 16 進数表記です。
- コンテンツタイプ: 小文字に正規化します。

## 8. インターフェース仕様

### 8.1 `IEmbedder`

テキスト埋め込みはすべての `IEmbedder` が実装します。
画像などの modalities はアダプターが任意で拡張します。

```ts
type EmbedModality = "text" | "image" | (string & {});

type EmbedderInfo = {
  name: string;
  dims: number;
  maxTokens?: number;
  normalized: boolean;
  modalities: EmbedModality[];
};

type EmbedInput =
  | { kind: "text"; text: string }
  | { kind: "image"; data: Uint8Array<ArrayBuffer> | Blob; mimeType?: string };

interface IEmbedder {
  readonly info: EmbedderInfo;
  embed(c: IEmbedder.EmbedContext): Promise<Float32Array>;
  embedMany(c: IEmbedder.EmbedManyContext): Promise<Float32Array[]>;
  embedText(c: IEmbedder.EmbedTextContext): Promise<Float32Array>;
  supports(c: IEmbedder.SupportsContext): boolean;
}

type IEmbedderContext =
  | { action: "embed"; signal: AbortSignal; input: EmbedInput }
  | { action: "embedMany"; signal: AbortSignal; inputs: readonly EmbedInput[] }
  | { action: "embedText"; signal: AbortSignal; text: string }
  | { action: "supports"; signal: AbortSignal; modality: EmbedModality };
```

すべての操作は単一のコンテキストオブジェクトを受け取ります。
コンテキストは操作種別を示す `action` と中断用の `signal`、操作固有のデータを持ちます（unikvs の Context 形式）。

実装要件は次のとおりです。

- 出力は常に `info.dims` と同じ長さにします。
- 既定では L2 正規化済みベクトルを返します。
- 未対応の `kind` が渡された場合は `UnsupportedModalityError` を投げます。
- `@omniojs/emb-gemma2` は `text` に必ず対応します。`image` への対応有無はパッケージの文書で明示します。

### 8.2 `IObjectIndex`

```ts
type MetadataFilter = {
  contentTypes?: string[];
  tagsAll?: string[];
  tagsAny?: string[];
  createdAfter?: string;
  createdBefore?: string;
  userMetadata?: Record<string, unknown>;
  fullText?: string;
};

type IndexedObject<T = Record<string, unknown>> = OmnioObject<T> & {
  score?: number;
};

interface IObjectIndex {
  readonly isOpen: boolean;
  open(c: IObjectIndex.OpenContext): Promise<void>;
  close(c: IObjectIndex.CloseContext): Promise<void>;
  upsert<T>(c: IObjectIndex.UpsertContext<T>): Promise<void>;
  get<T>(c: IObjectIndex.GetContext): Promise<OmnioObject<T> | null>;
  delete(c: IObjectIndex.DeleteContext): Promise<boolean>;
  list<T>(c: IObjectIndex.ListContext): Promise<IObjectIndex.ListResult<T>>;
  search<T>(c: IObjectIndex.SearchContext): Promise<IndexedObject<T>[]>;
}

type IObjectIndexContext =
  | { action: "open"; signal: AbortSignal }
  | { action: "close"; signal: AbortSignal }
  | { action: "upsert"; signal: AbortSignal; object: OmnioObject }
  | { action: "get"; signal: AbortSignal; key: OmnioKey }
  | { action: "delete"; signal: AbortSignal; key: OmnioKey }
  | {
      action: "list";
      signal: AbortSignal;
      limit?: number;
      cursor?: string | null;
      filter?: MetadataFilter;
    }
  | {
      action: "search";
      signal: AbortSignal;
      vector: Float32Array;
      topK: number;
      minScore?: number;
      metric?: "cosine" | "dot" | "l2";
      filter?: MetadataFilter;
      embeddingModel?: string;
    };
```

`tagsAll` はすべてのタグを含む条件であり、`tagsAny` はいずれかのタグを含む条件です。
タグ条件はベクトル類似度の計算前に適用し、候補を絞ります。

`@omniojs/idx-sqlite.wasm` の表定義は次のとおりです。kysely のマイグレーション `001_create_objects` で作成し、`open` 時に `migrateToLatest` で適用します。

- `objects` 表: `key`（主キー）、`content_type`、`size`、`hash`、`description`、`user_metadata`（JSON 文字列）、`embedding_model`、`embedding_dims`、`embedding_source`（JSON 文字列）、`embedding`（Float32 リトルエンディアンの BLOB）、`created_at`、`updated_at`（いずれも ISO 8601 文字列）を持ちます。
- `object_tags` 表: `key` と `tag` の複合主キーです。`objects.key` への外部キーであり、`ON DELETE CASCADE` で連動削除します。
- 索引: `object_tags(tag)`、`objects(content_type)`、`objects(created_at)` を作ります。
- ベクトル検索は当面 JavaScript で総当たり計算します。`sqlite-vec` などの拡張は将来対応します。
- 永続化は当面メモリーのみです。ファイル保存は将来対応します。

### 8.3 `Omnio` ファサード

データベースと埋め込み、ストレージーの指定はいずれも必須です。
既定値による省略はできません。

```ts
import type { UniKvs, Value } from "unikvs";

type OmnioEntity = UniKvs<{
  [key: string]: Value<Uint8Array<ArrayBuffer>>;
}>;

type PutObjectInput<T = Record<string, unknown>> = {
  key: OmnioKey;
  data: Uint8Array<ArrayBuffer> | Blob | ReadableStream<Uint8Array<ArrayBuffer>>;
  contentType: string;
  description?: string;
  tags?: string[];
  userMetadata?: T;
  embedding?: Float32Array;
  embed?: boolean;
};

type ObjectSearchQuery =
  | { text: string }
  | { image: Uint8Array<ArrayBuffer> | Blob; mimeType?: string }
  | { vector: Float32Array };

type SearchObjectsInput = {
  query: ObjectSearchQuery;
  topK?: number;
  minScore?: number;
  filter?: MetadataFilter;
  includeEmbedding?: boolean;
};

type OmnioOptions = {
  entity: OmnioEntity;
  index: IObjectIndex;
  embedder: IEmbedder;
};

class Omnio {
  constructor(options: OmnioOptions);

  open(): Promise<void>;
  close(): Promise<void>;

  putObject<T>(input: PutObjectInput<T>): Promise<OmnioObject<T>>;
  getObject(key: OmnioKey): Promise<Uint8Array<ArrayBuffer> | null>;
  streamObject(key: OmnioKey): Promise<ReadableStream<Uint8Array> | null>;
  headObject<T>(key: OmnioKey): Promise<OmnioObject<T> | null>;
  deleteObject(key: OmnioKey): Promise<boolean>;
  listObjects<T>(options?: {
    limit?: number;
    cursor?: string | null;
    filter?: MetadataFilter;
  }): Promise<{
    items: OmnioObject<T>[];
    nextCursor: string | null;
  }>;
  searchObjects<T>(input: SearchObjectsInput): Promise<IndexedObject<T>[]>;
  reindexObject<T>(key: OmnioKey): Promise<OmnioObject<T> | null>;
}
```

動作は次のとおりです。

1. `putObject` は実体を `unikvs` に保存し、サイズとハッシュを求めます。
2. `embedding` が直接渡された場合はその値を使います。
3. `embedding` がなく、`embed` が真であり、`description` がある場合は `Embedder` でテキスト埋め込みを生成します。
4. 画像入力の埋め込みは、対応する `Embedder` アダプターがある場合のみ使えます。
5. メタデータとベクトルを `ObjectIndex` に保存します。
6. `searchObjects` はクエリーをベクトルに変換し、`ObjectIndex.search` にフィルター付きで委譲します。
7. `reindexObject` はモデル変更時に既存オブジェクトの埋め込みを作り直します。
8. `open` と `close` は、シグナル未指定時に 30 秒でタイムアウトします。指定時はそのシグナルに従います。
9. それ以外の操作は、呼び出し側のシグナルと `close` 時に中断されるライフサイクルシグナルを合成し、先に中断された方に従います。シグナル未指定時はライフサイクルシグナルを使います。`close` 時の中断理由には `OperationAbortedError` を使います。

`embed: false` を指定した場合は埋め込みを生成せず、メタデータのみ保存します。
実体のみ先に保存し、埋め込みは後でバッチ処理する用途に対応します。

### 8.4 配線例

既定構成はないため、利用者は 3 者を明示的に組み立てます。

```ts
import { Omnio } from "@omniojs/core";
import { createPgliteIndex } from "@omniojs/db-pglite";
import { createGemma2Embedder } from "@omniojs/emb-gemma2";
import { Memory } from "@unikvs/memory";
import { UniKvs, type Value } from "unikvs";

const entity = UniKvs.config<{
  [key: string]: Value<Uint8Array<ArrayBuffer>>;
}>()
  .persist(new Memory())
  .create();

const omnio = new Omnio({
  entity,
  index: await createPgliteIndex({ dataDir: "opfs://omnio" }),
  embedder: await createGemma2Embedder(),
});

await omnio.open();

await omnio.putObject({
  key: "photos/sunset.jpg",
  data: sunsetBytes,
  contentType: "image/jpeg",
  description: "夕焼けの海と赤い雲",
  tags: ["photo", "sea"],
});

const hits = await omnio.searchObjects({
  query: { text: "夕日の海辺" },
  topK: 20,
  filter: { tagsAny: ["photo"] },
});

await omnio.close();
```

`omnio` パッケージはこのような配線の雛形を提供しますが、モデルや保存先の選択を肩代わりしません。

## 9. 検索仕様

1. テキスト検索は、クエリー文を検索時と同じ埋め込みモデルでベクトル化します。
2. モデル名が異なるレコードは検索対象から除外するか、呼び出し側に警告します。無言で混在させません。
3. タグなどのフィルターはベクトル類似度の計算前に適用します。
4. 既定の並べ替えはスコアの降順とし、`topK` の既定値は 20 とします。
5. `description` の埋め込み検索とタグ絞り込みは独立に組み合わせできます。
6. 全文検索とベクトル検索の併用時は、単純な相互順位付けから開始し、複雑な再ランキングは後回しにします。

## 10. エラー設計

すべての公開エラーは `i18n-error-base` を継承します。
`code` で判別でき、`meta` に `key` や `model` などの診断情報を保持します。

```ts
import { I18nErrorBase } from "i18n-error-base";

type OmnioErrorMeta = {
  code: OmnioErrorCode;
  key?: string;
  model?: string;
};

type OmnioErrorCode =
  | "ENTITY_PUT_FAILED"
  | "ENTITY_NOT_FOUND"
  | "INDEX_WRITE_FAILED"
  | "EMBED_FAILED"
  | "EMBED_UNSUPPORTED_MODALITY"
  | "MODEL_MISMATCH"
  | "INVALID_INPUT";

class OmnioError extends I18nErrorBase<OmnioErrorMeta> {
  static prefix = "[omnio]";
}
```

メッセージ登録の例は次のとおりです。

```ts
import { setErrorMessage } from "i18n-error-base";

setErrorMessage(
  OmnioError,
  ({ code, key }) => `オブジェクトの保存に失敗しました: ${key ?? "(unknown)"} (${code})`,
  "ja",
);

setErrorMessage(
  OmnioError,
  ({ code, key }) => `Failed to save the object: ${key ?? "(unknown)"} (${code})`,
  "en",
);
```

- 日本語と英語のメッセージ登録を必須とします。
- `cause` には `unikvs` や DB ドライバーの元エラーを保持します。
- `close` 時の中断理由には `OperationAbortedError` を使います。
- 実体の保存成功後にインデックス保存が失敗した場合は、可能な限り実体を削除する補償処理を行います。

## 11. ランタイム対応表

| 組み合わせ                          | ブラウザー | Cloudflare Workers | Node.js |
| ----------------------------------- | ---------- | ------------------ | ------- |
| PGLite と EmbeddingGemma 2          | 推奨       | 条件付き推奨       | 可能    |
| idx-sqlite.wasm と EmbeddingGemma 2 | 可能       | 条件付き推奨       | 推奨    |
| 外部 Postgres と外部埋め込み API    | 可能       | 推奨               | 推奨    |

ブラウザーではモデルファイルの初回取得が重いため、Cache Storage による永続化と進捗コールバックを必須機能とします。

## 12. ロードマップ案

1. **M1**: `core` の型と `Omnio` クラス、`unikvs` 配線、単体テストを完成させます。
2. **M2**: idx-sqlite.wasm 実装と PGLite 実装でメタデータ検索とタグ絞り込みを完成させます。
3. **M3**: EmbeddingGemma 2 とベクトル検索を接続し、`description` 埋め込みによる自然言語検索のデモを作ります。
4. **M4**: OPFS、ファイルシステム、S3 互換の実体保存レシピを追加します。
5. **M5**: ドキュメント、ベンチマーク、移行ガイドを整備し、v1.0 とします。
