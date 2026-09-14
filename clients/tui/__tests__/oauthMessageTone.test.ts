import { describe, it, expect } from "vitest";
import { oauthMessageToneFor } from "../src/oauthMessageTone.js";

const WARNING =
  "Cleared locally, but revoking the grant at the authorization server failed.";

describe("oauthMessageToneFor", () => {
  it("warns while the message it was raised for is showing", () => {
    expect(oauthMessageToneFor(WARNING, WARNING)).toBe("warning");
  });

  // The bug this replaced (#2144): a stored tone survived the message that
  // earned it, so every later ordinary note rendered as a warning.
  it("returns to informational as soon as any other message replaces it", () => {
    expect(oauthMessageToneFor("Authorization updated.", WARNING)).toBe("info");
  });

  it("is informational when nothing has ever warned", () => {
    expect(oauthMessageToneFor("Authorization updated.", null)).toBe("info");
  });

  // `null === null` must not read as a warning — with no message on screen
  // there is nothing to colour, and the previous warning is long gone.
  it("is informational when there is no message", () => {
    expect(oauthMessageToneFor(null, null)).toBe("info");
    expect(oauthMessageToneFor(null, WARNING)).toBe("info");
  });
});
