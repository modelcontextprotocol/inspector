import { describe, expect, it } from "vitest";
import { TaskProgressRouter } from "@inspector/core/extension/tasks/progress.js";

describe("TaskProgressRouter", () => {
  it("routes nothing for a token no task call owns", () => {
    expect(new TaskProgressRouter().route("t")).toBeUndefined();
  });

  it("owns a token from acquire, before any task is correlated", () => {
    const router = new TaskProgressRouter();
    router.acquire("t");
    expect(router.route("t")).toEqual([]);
  });

  it("delivers a shared token's progress to every correlated task", () => {
    const router = new TaskProgressRouter();
    router.acquire("t");
    router.acquire("t");
    router.correlate("t", "a");
    router.correlate("t", "b");
    expect(router.route("t")).toEqual(["a", "b"]);

    // One owner settles: only its own task is released.
    router.release("t", "a");
    expect(router.route("t")).toEqual(["b"]);

    router.release("t", "b");
    expect(router.route("t")).toBeUndefined();
  });

  it("releases an owner that never saw a task", () => {
    const router = new TaskProgressRouter();
    router.acquire("t");
    router.release("t");
    expect(router.route("t")).toBeUndefined();
  });

  it("forgets everything on clear", () => {
    const router = new TaskProgressRouter();
    router.acquire(1);
    router.correlate(1, "a");
    router.clear();
    expect(router.route(1)).toBeUndefined();
  });
});
