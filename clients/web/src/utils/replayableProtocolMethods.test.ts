import { describe, expect, it } from "vitest";
import {
  isReplayableProtocolMethod,
  REPLAYABLE_PROTOCOL_METHODS,
} from "./replayableProtocolMethods";

describe("isReplayableProtocolMethod", () => {
  it("admits every client→server read and call in the set", () => {
    for (const method of REPLAYABLE_PROTOCOL_METHODS) {
      expect(isReplayableProtocolMethod(method)).toBe(true);
    }
    expect([...REPLAYABLE_PROTOCOL_METHODS].sort()).toEqual([
      "ping",
      "prompts/get",
      "prompts/list",
      "resources/list",
      "resources/read",
      "resources/templates/list",
      "tasks/list",
      "tools/call",
      "tools/list",
    ]);
  });

  it("excludes server→client requests and side-effectful methods", () => {
    for (const method of [
      "roots/list",
      "sampling/createMessage",
      "elicitation/create",
      "logging/setLevel",
      "resources/subscribe",
      "initialize",
    ]) {
      expect(isReplayableProtocolMethod(method)).toBe(false);
    }
  });
});
