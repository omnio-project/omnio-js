import { test, describe } from "vite-plus/test";

import { BackgroundTaskManager } from "../src/_background-task-manager.js";

describe("BackgroundTaskManager", () => {
  test("登録したタスクを順番に実行する", async ({ expect }) => {
    // 準備：
    const manager = new BackgroundTaskManager();
    const events: string[] = [];
    const release = Promise.withResolvers<void>();
    manager.schedule("first", async () => {
      events.push("first:start");
      await release.promise;
      events.push("first:end");
    });
    manager.schedule("second", async () => {
      events.push("second");
    });

    // 実行：
    release.resolve();
    await manager.wait();

    // 検証：
    expect(events).toStrictEqual(["first:start", "first:end", "second"]);
  });

  test("同じキーのタスクは後から登録したタスクで上書きする", async ({ expect }) => {
    // 準備：
    const manager = new BackgroundTaskManager();
    const events: string[] = [];
    const release = Promise.withResolvers<void>();
    manager.schedule("running", async () => {
      await release.promise;
    });
    manager.schedule("pending", async () => {
      events.push("first");
    });
    manager.schedule("pending", async () => {
      events.push("second");
    });

    // 実行：
    release.resolve();
    await manager.wait();

    // 検証：
    expect(events).toStrictEqual(["second"]);
  });

  test("失敗したタスクの後も次のタスクを実行する", async ({ expect }) => {
    // 準備：
    const manager = new BackgroundTaskManager();
    const events: string[] = [];
    manager.schedule("failed", async () => {
      throw new Error("失敗");
    });
    manager.schedule("next", async () => {
      events.push("next");
    });

    // 実行：
    await manager.wait();

    // 検証：
    expect(events).toStrictEqual(["next"]);
  });
});
