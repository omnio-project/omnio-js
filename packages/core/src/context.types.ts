/**
 * 操作コンテキストの種別です。
 */
export type ContextAction =
  | "close"
  | "delete"
  | "embed"
  | "embedMany"
  | "embedText"
  | "get"
  | "has"
  | "list"
  | "listDirty"
  | "markDirty"
  | "open"
  | "purge"
  | "search"
  | "supports"
  | "upsert";

/**
 * すべての操作コンテキストの基底です。
 *
 * 操作の種別と中断シグナルを持ちます。
 * 各操作の固有データは派生コンテキストが持ちます。
 */
export interface IActionContext {
  /** 操作の種別です。 */
  readonly action: ContextAction;

  /** 処理を中断するための中断シグナルです。 */
  readonly signal: AbortSignal;
}

/**
 * ライフサイクル操作のコンテキストの基底です。
 */
export interface ILifecycleContext extends IActionContext {
  /** 操作の種別です。 */
  readonly action: "close" | "open";
}

/**
 * 開く操作のコンテキストです。
 */
export interface IOpenContext extends ILifecycleContext {
  /** 操作の種別です。 */
  readonly action: "open";
}

/**
 * 閉じる操作のコンテキストです。
 */
export interface ICloseContext extends ILifecycleContext {
  /** 操作の種別です。 */
  readonly action: "close";
}
