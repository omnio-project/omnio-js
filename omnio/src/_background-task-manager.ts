/**
 * バックグラウンドで実行するタスクを管理します。
 *
 * 登録したタスクは順番に実行します。同じキーのタスクを登録した場合は、後から登録したタスクで上書きします。
 * 失敗したタスクは破棄し、後続のタスクの実行を継続します。
 */
export class BackgroundTaskManager {
  readonly #pending = new Map<string, () => Promise<void>>();

  #running: Promise<void> | undefined;

  /**
   * 実行中のタスクがあるかを示します。
   */
  public get isRunning(): boolean {
    return this.#running !== undefined;
  }

  /**
   * タスクを登録します。
   *
   * 実行中のタスクがある場合は、そのタスクの完了後に実行します。
   *
   * @param key タスクを識別するキーです。同じキーのタスクは上書きします。
   * @param task 実行するタスクです。
   */
  public schedule(key: string, task: () => Promise<void>): void {
    this.#pending.set(key, task);
    this.#start();
  }

  /**
   * 登録済みのタスクがすべて完了するまで待ちます。
   */
  public async wait(): Promise<void> {
    while (this.#running !== undefined) {
      await this.#running;
    }
  }

  /**
   * タスクの実行を開始します。
   */
  #start(): void {
    if (this.#running !== undefined) {
      return;
    }

    this.#running = this.#run();
  }

  /**
   * 登録済みのタスクを実行し、終了後に次のタスクを開始します。
   */
  async #run(): Promise<void> {
    try {
      await this.#drain();
    } catch {
      // 予期しない失敗でも次のタスクを実行できるようにします。
    } finally {
      this.#running = undefined;

      if (this.#pending.size > 0) {
        this.#start();
      }
    }
  }

  /**
   * 登録済みのタスクを順番に実行します。
   */
  async #drain(): Promise<void> {
    for (;;) {
      const entry = this.#pending.entries().next().value;

      if (entry === undefined) {
        return;
      }

      const [key, task] = entry;
      this.#pending.delete(key);

      try {
        await task();
      } catch {
        // 失敗したタスクは破棄し、後続のタスクを実行します。
      }
    }
  }
}
