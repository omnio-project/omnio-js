import { type DatabaseSync, type SQLInputValue } from "node:sqlite";

import { DbQueryError } from "@omniojs/core";
import {
  type Driver,
  type Kysely,
  type Dialect,
  type QueryResult,
  type QueryCompiler,
  type DialectAdapter,
  type DatabaseConnection,
  type DatabaseIntrospector,
  CompiledQuery,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";

import { SqliteNodeDialectError } from "./errors.js";
import type { SqliteNodeDatabase } from "./schema.js";

/**
 * Node.js 標準の SQLite のデータベースハンドルです。
 */
export type SqliteNodeHandle = DatabaseSync;

/**
 * kysely のパラメーターを node:sqlite のバインド値に変換します。
 *
 * @param value kysely が渡したパラメーターです。
 *
 * @returns node:sqlite に渡せるバインド値です。
 */
function toBindable(value: unknown): SQLInputValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  throw new DbQueryError({
    cause: new Error(`Unsupported parameter type: ${typeof value}`),
    operation: "bind",
  });
}

/**
 * kysely のパラメーターを node:sqlite のバインド値に変換します。
 *
 * @param parameters kysely が渡したパラメーターの一覧です。
 *
 * @returns node:sqlite に渡せるバインド値の一覧です。
 */
function toBindableList(parameters: readonly unknown[]): SQLInputValue[] {
  return parameters.map(toBindable);
}

/**
 * SQLite の変更件数や行 ID を bigint に変換します。
 *
 * @param value 取得した値です。
 *
 * @returns bigint に変換した値です。
 */
function toCount(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

/**
 * node:sqlite 上で動作する kysely 用のデータベース接続です。
 */
class SqliteNodeConnection implements DatabaseConnection {
  readonly #db: DatabaseSync;

  /**
   * @param db node:sqlite のデータベースハンドルです。
   */
  public constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /**
   * クエリーを実行します。
   *
   * @param compiled コンパイル済みのクエリーです。
   *
   * @returns クエリー結果を解決する Promise です。
   */
  public async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const sqlText = compiled.sql;
    let statement: ReturnType<SqliteNodeHandle["prepare"]>;

    try {
      statement = this.#db.prepare(sqlText);
    } catch (ex) {
      throw new DbQueryError({
        cause: ex,
        operation: "query",
        queryText: sqlText,
      });
    }

    try {
      const bindings = toBindableList(compiled.parameters);

      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings).map((row) => ({ ...row })) as R[];

        return { rows };
      }

      const result = statement.run(...bindings);

      if (compiled.query.kind === "InsertQueryNode") {
        return {
          rows: [],
          insertId: toCount(result.lastInsertRowid),
          numAffectedRows: toCount(result.changes),
        };
      }

      return {
        rows: [],
        numAffectedRows: toCount(result.changes),
      };
    } catch (ex) {
      if (ex instanceof DbQueryError) {
        throw ex;
      }

      throw new DbQueryError({
        cause: ex,
        operation: "query",
        queryText: sqlText,
      });
    }
  }

  /**
   * ストリームクエリーは対応していません。
   *
   * @returns 常にエラーを投げます。
   */
  public streamQuery(): AsyncIterableIterator<QueryResult<never>> {
    throw new SqliteNodeDialectError({ operation: "stream" });
  }
}

/**
 * node:sqlite 上で動作する kysely 用のドライバーです。
 *
 * 単一接続であり、取得と解放は無操作です。
 */
class SqliteNodeDriver implements Driver {
  #connection: SqliteNodeConnection | undefined;

  readonly #db: DatabaseSync;

  /**
   * @param db node:sqlite のデータベースハンドルです。
   */
  public constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /**
   * ドライバーを初期化します。
   *
   * 外部キー制約を有効にし、参照の削除をカスケードさせます。
   */
  public async init(): Promise<void> {
    try {
      this.#db.exec("PRAGMA foreign_keys = ON");
    } catch (ex) {
      throw new DbQueryError({
        cause: ex,
        operation: "open",
      });
    }
  }

  /**
   * 単一の共有接続を取得します。
   *
   * @returns 共有のデータベース接続を解決する Promise です。
   */
  public async acquireConnection(): Promise<DatabaseConnection> {
    this.#connection ??= new SqliteNodeConnection(this.#db);

    return this.#connection;
  }

  /**
   * トランザクションを開始します。
   *
   * @param connection 対象のデータベース接続です。
   */
  public async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("begin"));
  }

  /**
   * トランザクションを確定します。
   *
   * @param connection 対象のデータベース接続です。
   */
  public async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }

  /**
   * トランザクションを破棄します。
   *
   * @param connection 対象のデータベース接続です。
   */
  public async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  /**
   * 接続を解放します。単一接続のため無操作です。
   */
  public async releaseConnection(): Promise<void> {}

  /**
   * ハンドルを閉じて破棄します。
   */
  public async destroy(): Promise<void> {
    this.#connection = undefined;

    if (this.#db.isOpen) {
      this.#db.close();
    }
  }
}

/**
 * node:sqlite 上で動作する kysely 用の Dialect です。
 *
 * @example
 * ```
 * import { DatabaseSync } from "node:sqlite";
 * import { Kysely } from "kysely";
 * import { SqliteNodeDialect } from "@omniojs/idx-sqlite.node";
 *
 * const db = new Kysely({ dialect: new SqliteNodeDialect(new DatabaseSync(":memory:")) });
 * ```
 */
export class SqliteNodeDialect implements Dialect {
  readonly #db: SqliteNodeHandle;

  /**
   * @param db node:sqlite のデータベースハンドルです。
   */
  public constructor(db: SqliteNodeHandle) {
    this.#db = db;
  }

  /**
   * アダプターを生成します。
   *
   * @returns SQLite 用のアダプターです。
   */
  public createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  /**
   * ドライバーを生成します。
   *
   * @returns node:sqlite 用のドライバーです。
   */
  public createDriver(): Driver {
    return new SqliteNodeDriver(this.#db);
  }

  /**
   * イントロスペクターを生成します。
   *
   * @param db kysely のインスタンスです。
   *
   * @returns SQLite 用のイントロスペクターです。
   */
  public createIntrospector(db: Kysely<SqliteNodeDatabase>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }

  /**
   * クエリーコンパイラーを生成します。
   *
   * @returns SQLite 用のクエリーコンパイラーです。
   */
  public createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }
}
