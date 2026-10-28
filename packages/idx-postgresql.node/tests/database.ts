import { Client } from "pg";

/** インデックスのテストで使うスキーマ名です。 */
export const INDEX_TEST_SCHEMA = "omnio_test_index";

/** マイグレーションのテストで使うスキーマ名です。 */
export const MIGRATIONS_TEST_SCHEMA = "omnio_test_migrations";

/** テスト用データベースの既定の接続文字列です。 */
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres";

/** スキーマーの初期化を直列化するための advisory lock のキーです。 */
const SCHEMA_RESET_LOCK_KEY = 1_330_798_153;

/**
 * テスト用の接続文字列を作ります。
 *
 * 検索パスをテスト専用のスキーマに限定し、public スキーマのデータに影響しないようにします。
 *
 * @param schema 利用するスキーマ名です。
 *
 * @returns 検索パスを設定した接続文字列です。
 */
export function getTestConnectionString(schema: string): string {
  const url = new URL(process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema},public`);

  return url.toString();
}

/**
 * テスト用のスキーマを初期状態に戻します。
 *
 * 前のテストのテーブルとデータが残らないよう、スキーマーごと削除して作り直します。
 *
 * @param schema 初期化するスキーマ名です。
 */
export async function resetTestSchema(schema: string): Promise<void> {
  const client = new Client({
    connectionString: process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL,
  });
  await client.connect();

  try {
    // CREATE EXTENSION IF NOT EXISTS は同時実行に弱いため、初期化を直列化します。
    await client.query("select pg_advisory_lock($1)", [SCHEMA_RESET_LOCK_KEY]);
    await client.query(`drop schema if exists ${schema} cascade`);
    await client.query(`create schema ${schema}`);
    await client.query("create extension if not exists vector schema public");
  } finally {
    await client.end();
  }
}
