import { describe, it, expect, vi } from "vitest";

// A writeFile double whose calls settle only when the test says so, so the
// queue is observed directly: a second write must not BEGIN while the first
// is pending, whatever the filesystem's own timing would have been.
const writes: Array<{
  path: string;
  resolve: () => void;
  reject: (e: unknown) => void;
}> = [];
vi.mock("node:fs/promises", () => ({
  writeFile: (path: string) =>
    new Promise<void>((resolve, reject) => {
      writes.push({ path, resolve, reject });
    }),
}));

import { saveResultToFile } from "../src/utils/saveResult.js";

const TEXT = { content: [{ type: "text", text: "hi" }] };

const flush = async () => {
  for (let i = 0; i < 5; i++)
    await new Promise((resolve) => setImmediate(resolve));
};

describe("saveResultToFile queueing (#2571)", () => {
  it("starts each write only after the previous one has settled", async () => {
    const order: string[] = [];
    const first = saveResultToFile(TEXT, "a.json", "json", "/d").then(() => {
      order.push("a");
    });
    const second = saveResultToFile(TEXT, "b.json", "json", "/d").then(() => {
      order.push("b");
    });
    await flush();
    expect(writes.map((w) => w.path)).toEqual(["/d/a.json"]);
    writes[0]!.resolve();
    await first;
    await flush();
    expect(writes.map((w) => w.path)).toEqual(["/d/a.json", "/d/b.json"]);
    writes[1]!.resolve();
    await second;
    expect(order).toEqual(["a", "b"]);
  });

  it("a failed save does not hold up the ones queued after it", async () => {
    writes.length = 0;
    const failed = saveResultToFile(TEXT, "x.json", "json", "/d");
    const next = saveResultToFile(TEXT, "y.json", "json", "/d");
    await flush();
    expect(writes).toHaveLength(1);
    writes[0]!.reject(new Error("EACCES"));
    await expect(failed).rejects.toThrow("Could not write /d/x.json: EACCES");
    await flush();
    expect(writes).toHaveLength(2);
    writes[1]!.resolve();
    await expect(next).resolves.toMatchObject({ path: "/d/y.json" });
  });
});
