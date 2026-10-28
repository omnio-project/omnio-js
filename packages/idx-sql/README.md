# @omniojs/idx-sql

SQL データベースによる Omnio.js 用 ObjectIndex の共通実装です。

`@omniojs/idx-pglite`、`@omniojs/idx-postgresql.node`、`@omniojs/idx-sqlite.node`、`@omniojs/idx-sqlite.wasm` が共有します。

ベクトル検索は、派生クラスがデータベースネイティブの実装を提供しない場合は JavaScript の総当たり計算にフォールバックします。
