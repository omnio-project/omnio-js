# @omniojs/idx-sqlite.node

Node.js 標準の SQLite による Omnio.js 用の `IObjectIndex` 実装です。

ベクトル検索には sqlite-vec を使います。sqlite-vec を読み込めない環境では JavaScript の総当たり検索にフォールバックします。

[Document](https://omnio-project.github.io/omnio-js/)
