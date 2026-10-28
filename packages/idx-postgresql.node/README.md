# @omniojs/idx-postgresql.node

PostgreSQL による Omnio.js 用の `IObjectIndex` 実装です。

ベクトル検索には pgvector を使います。接続先のデータベースで pgvector 拡張を利用できるようにしてください。マイグレーション時に `CREATE EXTENSION IF NOT EXISTS vector` を実行します。

[Document](https://omnio-project.github.io/omnio-js/)
