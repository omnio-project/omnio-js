# Changelog

## v0.0.5

### 新機能

- 物理削除の予約を永続化して crash safety を確保する ([5dfa2eb](https://github.com/omnio-project/omnio-js/commit/5dfa2eb3be07d111e75f8302260a58466bfa88fa))
- 削除した実体の物理削除に猶予期間を設ける ([c24824d](https://github.com/omnio-project/omnio-js/commit/c24824df3664c51427b6b0ce2d664a1d50376889))
- 実体を不変化し取得時にチェックサムを検証する ([75dc09a](https://github.com/omnio-project/omnio-js/commit/75dc09a467bbf753b050c74dc04c35394cd787e2))
- headObject で取得するメタデータを選択できるようにする ([9d3ce48](https://github.com/omnio-project/omnio-js/commit/9d3ce4891c18c6c57ca28752915a7f7c735b4f34))
- MetadataFilter にハッシュの条件を追加する ([24349e8](https://github.com/omnio-project/omnio-js/commit/24349e8c447b18cca01212e473254c772e5753b9))
- MetadataFilter にタグの条件を追加する ([1d8e8a0](https://github.com/omnio-project/omnio-js/commit/1d8e8a07ec1058963e7ce847b16c40b3904022fb))
- MetadataFilter にサイズの条件を追加する ([dab6aa1](https://github.com/omnio-project/omnio-js/commit/dab6aa19a2c7bd6c88aef4666c5f377754c5fbe1))
- MetadataFilter にレコード時刻の条件を追加する ([b3bdfb9](https://github.com/omnio-project/omnio-js/commit/b3bdfb91a970e08e7714ab3365b0ecb2c882d2a3))
- MetadataFilter にレコードタイプの条件を追加する ([7eaeedc](https://github.com/omnio-project/omnio-js/commit/7eaeedc2b2d82f2e0a330b00fd2cf6aac2531bcc))
- MetadataFilter に更新時刻の条件を追加する ([811f870](https://github.com/omnio-project/omnio-js/commit/811f8703d038a1d7d69de67d67bae07d170b435f))
- MetadataFilter の作成時刻条件を createdAt に統合する ([454927d](https://github.com/omnio-project/omnio-js/commit/454927d77db57c08cd32980617bb9006815fb636))
- MetadataFilter の contentTypes を contentType に置き換える ([c68b3df](https://github.com/omnio-project/omnio-js/commit/c68b3df008e6bbc660e026979e80ddc49b5c6913))
- ベクトル検索をデータベースネイティブ機能に移行する ([49455dc](https://github.com/omnio-project/omnio-js/commit/49455dc3e457638cefc444b6fcecc3e5ff08ead7))
- idx-postgresql.node を実装する ([6ecd616](https://github.com/omnio-project/omnio-js/commit/6ecd616be0bbc11d8008e4d2de82910c7de3dc1b))
- idx-pglite を実装する ([7ffd3e0](https://github.com/omnio-project/omnio-js/commit/7ffd3e06f5236ca236b94fa4e5adb43e14e3ccf9))
- idx-sqlite.node を実装する ([1f925c5](https://github.com/omnio-project/omnio-js/commit/1f925c5aebd0c678be13bf19692d99ab4bb6b93a))
- Omnio にオブジェクトのキー変更メソッドを追加する ([01b87f9](https://github.com/omnio-project/omnio-js/commit/01b87f99b1be49bea3d5006c44c5ffe80b8f24dc))
- Omnio にオブジェクト複製メソッドを追加する ([f5fce38](https://github.com/omnio-project/omnio-js/commit/f5fce3839b538d6ad00a45fea0f22bfc60383bb7))
- Omnio に ObjectIndex のメタデータ更新メソッドを追加する ([acda9db](https://github.com/omnio-project/omnio-js/commit/acda9dbe887920d505d1751783503ece6172b4b8))
- オブジェクトの存在確認を ObjectIndex の has で行う ([5775d6c](https://github.com/omnio-project/omnio-js/commit/5775d6c0eb37cc9f3778bf0059b58ad45d86d3a3))
- インデックスにハッシュアルゴリズムを記録する ([3591fbc](https://github.com/omnio-project/omnio-js/commit/3591fbcb42e458109bdd720e8cf806c56f50cb35))
- unikvs 0.0.15 の beforeAll でチェックサムを計算する ([f7994cd](https://github.com/omnio-project/omnio-js/commit/f7994cdb785e18aa8d9142a2b0eb5a08a7f09793))
- 埋め込みモデル変更時のdirty再インデックスを追加 ([08628c1](https://github.com/omnio-project/omnio-js/commit/08628c16eba590a233d894f912213f84fbfd65c2))
- オブジェクト削除を論理削除とバックグラウンドpurgeに変更 ([e42d650](https://github.com/omnio-project/omnio-js/commit/e42d650bcf7f6b1fe6b7b23095e6c28e27dcc237))
- オブジェクト実体をUUIDのentityIdで保存 ([1899302](https://github.com/omnio-project/omnio-js/commit/18993022aab593e3e7bf8f6883a753e87fc3c1f2))
- ObjectIndexのjournalにrecord_typeとrecord_timestampを追加 ([3b70805](https://github.com/omnio-project/omnio-js/commit/3b70805102eef72894612cc57230cc9b50e385a6))
- Omnioの入力をvalibotで検証 ([34a43f1](https://github.com/omnio-project/omnio-js/commit/34a43f1c8f8e33634c354314b4a7c951bdb5f9e2))
- 中断理由にOperationAbortedErrorを追加 ([7696c90](https://github.com/omnio-project/omnio-js/commit/7696c90639b6652d90492e15d0e16517f1089dda))
- Gemma2Embedderで画像埋め込みに対応 ([021458a](https://github.com/omnio-project/omnio-js/commit/021458ad41b157d850b4dc45ca2c7544a8b1680d))
- コンストラクター引数をvalibotで検証 ([271a013](https://github.com/omnio-project/omnio-js/commit/271a0133a4e80fa34341ab0ffd31cc845f233d20))
- asyncmuxによるクラスメソッド単位の排他処理を導入 ([40a24f3](https://github.com/omnio-project/omnio-js/commit/40a24f36497b3327237e33ee3d01c030deab0277))
- @omniojs/emb-gemma2 を実装 ([f95b407](https://github.com/omnio-project/omnio-js/commit/f95b40733768008ca05cf8cd8f777d2a6d796442))
- テキスト処理に fast-utf8 を活用 ([6d26de1](https://github.com/omnio-project/omnio-js/commit/6d26de1fc3efba526fe7fe01310c0cc1fd8b97e6))
- OmnioKey クラスを実装 ([1255da6](https://github.com/omnio-project/omnio-js/commit/1255da6536dd6bc37f35a094b5f8bde6af7fbe8a))
- @omniojs/core に valibot スキーマを追加 ([9bb4905](https://github.com/omnio-project/omnio-js/commit/9bb4905ca9e32eda04280eb34d872a02321bb3b3))
- @omniojs/idx-sqlite.wasm を実装 ([1da98f6](https://github.com/omnio-project/omnio-js/commit/1da98f695787fa730f4a5d1cbfad53ef19d79915))
- @omniojs/core に db・emb 系のインターフェース型とエラーを実装 ([5a4f0d2](https://github.com/omnio-project/omnio-js/commit/5a4f0d27932b850f9773c7bdb087c556607ad513))

### バグ修正

- 実体欠落と並行削除を区別する ([8ad5bd5](https://github.com/omnio-project/omnio-js/commit/8ad5bd5524b00cf60c93beed4a76491c495c9afa))
- 同時実行・日時・WASM・埋め込みの不具合を修正する ([7c2a49e](https://github.com/omnio-project/omnio-js/commit/7c2a49e21ffc88a1f2f5e8284d75c35a861434b0))
- 別インスタンスの ChecksumSha256 によるハッシュ上書きを防ぐ ([e6b4006](https://github.com/omnio-project/omnio-js/commit/e6b400600d9053fcabba32314c2f9bd15a342925))
- ReadableStream の判定をインターフェースベースにする ([d01c09e](https://github.com/omnio-project/omnio-js/commit/d01c09e5e422736bf1e058507c55ba07b7b145fc))
- CI の Firefox 起動用に HOME を設定 ([d8d1033](https://github.com/omnio-project/omnio-js/commit/d8d103371a3526c4a34428a3b50bc521aa0552dc))
- CI の Playwright 依存関係を公式イメージで固定 ([bb0b848](https://github.com/omnio-project/omnio-js/commit/bb0b848b2ed23976409451ca9491d4597e8079c8))
- playwright 導入の停止に備えて再試行する ([ef84206](https://github.com/omnio-project/omnio-js/commit/ef84206f44a2d10b57b72cf34b8a0d27e4b726c4))
- CI テストジョブの制限時間を延長 ([b7e5632](https://github.com/omnio-project/omnio-js/commit/b7e563208142d323f55378ae95680ce3d54dc47e))
- CI マトリクスを改名後のパッケージに更新 ([45b3d9f](https://github.com/omnio-project/omnio-js/commit/45b3d9febfb4751046ad459c825170f19e1dc548))

### パフォーマンス改善

- インデックス読み取りを共有ロック化して並行性を高める ([452c572](https://github.com/omnio-project/omnio-js/commit/452c572a6af19b52ba6c61745f36689781668f10))
- ベクトル検索とキー生成を高速化する ([2fecb12](https://github.com/omnio-project/omnio-js/commit/2fecb1264bf1e8c1c43d2d9d19d81ddd731ebe2c))

### リファクタリング

- SQL インデックスのマイグレーションを 1 つに統合する ([4cdff17](https://github.com/omnio-project/omnio-js/commit/4cdff17b0d45be1f9244b3c708c037dbf1c80d17))
- copyObject で unikvs の copy を使う ([e6505b2](https://github.com/omnio-project/omnio-js/commit/e6505b2d1bcf8d62fa5099de357980080c05d404))
- バックグラウンドタスクを専用クラスで管理する ([e3a70f3](https://github.com/omnio-project/omnio-js/commit/e3a70f3e50dee8b17c1bbc3048ec6f6d8d5cd003))
- OmnioObject のシステムメタデータをフラット化する ([1c260d5](https://github.com/omnio-project/omnio-js/commit/1c260d514dac53b10f89188175530d0d7cae363e))
- MetadataFilter の Condition 型を名前空間にまとめる ([abe782c](https://github.com/omnio-project/omnio-js/commit/abe782c33dc1dfa3ec1c0630625869befc6fa084))
- MetadataFilter から tagsAll と tagsAny を削除する ([9b18cf5](https://github.com/omnio-project/omnio-js/commit/9b18cf54885d83f476a17b7ab21b7c5274573bb2))
- MetadataFilter から userMetadata を削除する ([4e10a55](https://github.com/omnio-project/omnio-js/commit/4e10a5536ed578035d0c76f01c8fd0d070ee9627))
- ベクトル類似度の計算方式をコサインと L2 に限定する ([9f9f3ba](https://github.com/omnio-project/omnio-js/commit/9f9f3baee7174a80ee6e6aa0c9d4c217e501fda4))
- パッケージ間の重複と責務を整理する ([204e60a](https://github.com/omnio-project/omnio-js/commit/204e60af8e405f1c1f0252954378014308108566))
- Omnio の操作ロックを共有ロックに変更する ([6eeb186](https://github.com/omnio-project/omnio-js/commit/6eeb1863652f4ad6615985dff614ee016f24b6e6))
- Omnio の実体参照を entityId に統一する ([f70d5fd](https://github.com/omnio-project/omnio-js/commit/f70d5fdc159e92398911f2c3dad824cb58f849d7))
- idx-sqlite.wasm の object_tags テーブルを object_tag に改名 ([31b39e7](https://github.com/omnio-project/omnio-js/commit/31b39e7699f0cea8896b3b107f039a9ebdebb166))
- idx-sqlite.wasmのマイグレーションを1つに統合 ([8aa3e12](https://github.com/omnio-project/omnio-js/commit/8aa3e12afa77989ab361c94db258bf6c0cda533b))
- SQLiteインデックスのobjectsテーブルをjournalに改名 ([262296f](https://github.com/omnio-project/omnio-js/commit/262296f73bc5a949863a87476c857cfe22e1e711))
- unikvsを0.0.13に更新しIOmnioEntityへ改名 ([63e0183](https://github.com/omnio-project/omnio-js/commit/63e0183f8996a8290160647a213a88e196fab900))
- 操作の中断シグナル合成を調整 ([db53f35](https://github.com/omnio-project/omnio-js/commit/db53f35268db8da44f91932cfe3724b03b595bef))
- 中断シグナルと型定義の扱いを整理 ([a050b36](https://github.com/omnio-project/omnio-js/commit/a050b36e0bc789c9e4f3e6ab5920019af4df6bcf))
- 内部利用のUTF-8モジュールを_接頭辞にリネーム ([a05ea1a](https://github.com/omnio-project/omnio-js/commit/a05ea1a9296882b34e14b9e379a20c36e1644820))
- 重複処理を共通化し、保存失敗時の整合性を改善 ([40bb9b9](https://github.com/omnio-project/omnio-js/commit/40bb9b919ca6618c27fc21974ccdfd221c945cec))
- asyncmuxのロック解放をusing構文に簡略化 ([5b93f2c](https://github.com/omnio-project/omnio-js/commit/5b93f2c1e1683d66783f76a1651974fb1dd69179))
- プライベートメンバーを#構文に統一 ([a43e4cc](https://github.com/omnio-project/omnio-js/commit/a43e4cce878424662f5099dd5edf9ed4e5554b91))
- idx 系の名称に統一 ([42631a3](https://github.com/omnio-project/omnio-js/commit/42631a340ef963e2df67b5421ca06a45b26bb1e9))

### テスト

- PostgreSQL のテストファイルを直列に実行する ([f7cfbdf](https://github.com/omnio-project/omnio-js/commit/f7cfbdf6c3d367fa3855a0429da03ec2738c7d01))
- PGlite のテストタイムアウトを延長する ([f31464c](https://github.com/omnio-project/omnio-js/commit/f31464c25d8f248361cc71ec1906519082d80562))
- ローカルで PostgreSQL を起動してテストできるようにする ([e921a86](https://github.com/omnio-project/omnio-js/commit/e921a86812af90d818fa2c88d40ee4d587908d06))
- unikvs を名前空間 import に統一する ([17534f3](https://github.com/omnio-project/omnio-js/commit/17534f3dd0c1b2bafed486b8eeee52339aea3536))
- 全パッケージのカバレッジを改善する ([c8a4fc5](https://github.com/omnio-project/omnio-js/commit/c8a4fc5a64b48e9f62b49acca3645173193ec85b))

### ビルド・CI

- postgresql サーバーを使えるようにする ([ae63b55](https://github.com/omnio-project/omnio-js/commit/ae63b55d4bef45f69b0846f25fe94295200d296b))
- コンテナーの git で safe.directory を設定する ([44a01b0](https://github.com/omnio-project/omnio-js/commit/44a01b0e53e3e6fa24450a5b036b778af50b1669))
- ステップ名を修正 ([86cccec](https://github.com/omnio-project/omnio-js/commit/86cccecf1ba40a880683483302e04d5f4acbf6f8))
- playwright イメージ内でリリース処理を実行する ([703764d](https://github.com/omnio-project/omnio-js/commit/703764d36cff699a1f2ce8020f5bf27595fbd73a))

### その他

- idx-postgresql.node の雛形を追加 ([7dd4120](https://github.com/omnio-project/omnio-js/commit/7dd412023eea2c50d12b942a8d740288bb953ee0))
- idx-sqlite.node の雛形を追加 ([473f52d](https://github.com/omnio-project/omnio-js/commit/473f52df14e523d3c1ef3262ef019c8bc1b60224))
- "import/no-namespace" を off にする ([331d8ae](https://github.com/omnio-project/omnio-js/commit/331d8aeacfef471021e4242f5b7b2eb79f40f9be))
- 仕様書を削除 ([64e3559](https://github.com/omnio-project/omnio-js/commit/64e355969d837fddcef306a4111099799c02c9d0))
- vp-lint-pluginsをv0.0.10に上げcatch-param-nameをerrorに ([61c0c25](https://github.com/omnio-project/omnio-js/commit/61c0c25948afbfc9f0c695b894ab3ccd97cc8290))
- miseにghを追加 ([3d4b62b](https://github.com/omnio-project/omnio-js/commit/3d4b62bd1d569fcaa952c75dbf179e807ce6390f))
- 設定の軽微な修正 ([9c43296](https://github.com/omnio-project/omnio-js/commit/9c43296a244c92ce7e860465f9ac29bc8cae642b))
- core パッケージを追加しておく ([ae026d1](https://github.com/omnio-project/omnio-js/commit/ae026d1f568e13cdc1f288dcd73d628935c545dd))
- 初期化 ([a848b0c](https://github.com/omnio-project/omnio-js/commit/a848b0c4ac0d9a034999c2c3afef5890c6a4cfa2))

**Full Changelog**: https://github.com/omnio-project/omnio-js/commits/@omniojs/core@0.0.5
