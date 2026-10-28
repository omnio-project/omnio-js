# @omniojs/idx-postgresql.node

PostgreSQL による Omnio.js 用の `IObjectIndex` 実装です。

ベクトル検索には pgvector を使います。接続先のデータベースで pgvector 拡張を利用できるようにしてください。マイグレーション時に `CREATE EXTENSION IF NOT EXISTS vector` を実行します。

[Document](https://omnio-project.github.io/omnio-js/)

## テスト

ローカルで `mise run test` を実行すると、Docker Compose で pgvector 入りの PostgreSQL 17 を起動し、テスト終了後に停止します。Docker が必要です。

PostgreSQL を起動したままテストを繰り返す場合は、次のコマンドを使います。

```sh
mise run db:start
mise run test:server
mise run db:stop
```

`DATABASE_URL` を指定した場合は、そのサーバーを使ってローカルのコンテナを起動しません。
