import { DbQueryError } from "@omniojs/core";
import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
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

import { SqliteWasmDialectError } from "./errors.js";
import type { SqliteWasmDatabase } from "./schema.js";

/**
 * SQLite WASM のデータベースハンドルです。
 */
export type SqliteWasmHandle = InstanceType<Sqlite3Static["oo1"]["DB"]>;

/**
 * sqlite-wasm モジュールを初期化し、静的 API を返します。
 *
 * @returns sqlite-wasm の静的 API を解決する Promise です。
 */
export function initSqliteWasm(): Promise<Sqlite3Static> {
  return sqlite3InitModule();
}

/**
 * kysely のパラメーターを sqlite-wasm のバインド値に変換します。
 *
 * @param parameters kysely が渡したパラメーターの一覧です。
 *
 * @returns sqlite-wasm に渡せるバインド値の一覧です。
 */
function toBindableList(
  parameters: readonly unknown[],
): (string | number | bigint | boolean | Uint8Array | null)[] {
  return parameters.map((value) => {
    if (value === null || value === undefined) {
      return null;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "boolean" ||
      value instanceof Uint8Array
    ) {
      return value;
    }

    throw new DbQueryError({
      cause: new Error(`Unsupported parameter type: ${typeof value}`),
      operation: "bind",
    });
  });
}

/**
 * SQLite の変更件数や行 ID を bigint に変換します。
 *
 * @param value 取得した値です。
 *
 * @returns bigint に変換した値です。数値でない場合は 0n です。
 */
function toCount(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  return 0n;
}

/**
 * sqlite-wasm 上で動作する kysely 用のデータベース接続です。
 */
class SqliteWasmConnection implements DatabaseConnection {
  readonly #db: SqliteWasmHandle;

  /**
   * @param db SQLite WASM のデータベースハンドルです。
   */
  public constructor(db: SqliteWasmHandle) {
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
    let statement: ReturnType<SqliteWasmHandle["prepare"]>;

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

      if (bindings.length > 0) {
        statement.bind(bindings);
      }

      if (statement.columnCount > 0) {
        const rows: R[] = [];

        while (statement.step()) {
          rows.push(statement.get({}) as R);
        }

        return { rows };
      }

      statement.step();

      if (compiled.query.kind === "InsertQueryNode") {
        return {
          rows: [],
          insertId: toCount(this.#db.selectValue("select last_insert_rowid()")),
          numAffectedRows: toCount(this.#db.selectValue("select changes()")),
        };
      }

      return {
        rows: [],
        numAffectedRows: toCount(this.#db.selectValue("select changes()")),
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
    } finally {
      statement.finalize();
    }
  }

  /**
   * ストリームクエリーは対応していません。
   *
   * @returns 常にエラーを投げます。
   */
  public streamQuery(): AsyncIterableIterator<QueryResult<never>> {
    throw new SqliteWasmDialectError({ operation: "stream" });
  }
}

/**
 * sqlite-wasm 上で動作する kysely 用のドライバーです。
 *
 * 単一接続であり、取得と解放は無操作です。
 */
class SqliteWasmDriver implements Driver {
  #connection: SqliteWasmConnection | undefined;

  readonly #db: SqliteWasmHandle;

  /**
   * @param db SQLite WASM のデータベースハンドルです。
   */
  public constructor(db: SqliteWasmHandle) {
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
    this.#connection ??= new SqliteWasmConnection(this.#db);

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
    this.#db.close();
  }
}

/**
 * sqlite-wasm 上で動作する kysely 用の Dialect です。
 *
 * @example
 * ```
 * import { Kysely } from "kysely";
 * import { SqliteWasmDialect, initSqliteWasm } from "@omniojs/idx-sqlite.wasm";
 *
 * const sqlite3 = await initSqliteWasm();
 * const db = new Kysely({ dialect: new SqliteWasmDialect(new sqlite3.oo1.DB()) });
 * ```
 */
export class SqliteWasmDialect implements Dialect {
  readonly #db: SqliteWasmHandle;

  /**
   * @param db SQLite WASM のデータベースハンドルです。
   */
  public constructor(db: SqliteWasmHandle) {
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
   * @returns sqlite-wasm 用のドライバーです。
   */
  public createDriver(): Driver {
    return new SqliteWasmDriver(this.#db);
  }

  /**
   * イントロスペクターを生成します。
   *
   * @param db kysely のインスタンスです。
   *
   * @returns SQLite 用のイントロスペクターです。
   */
  public createIntrospector(db: Kysely<SqliteWasmDatabase>): DatabaseIntrospector {
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
