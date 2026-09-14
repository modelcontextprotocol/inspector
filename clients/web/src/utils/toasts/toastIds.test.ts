import { describe, expect, it } from "vitest";
import {
  bodyDroppedToastId,
  CLIENT_CONFIG_LOAD_ERROR_NOTIFICATION_ID,
} from "./toastIds";

describe("bodyDroppedToastId", () => {
  it("keys the toast per server so a storm updates one toast", () => {
    expect(bodyDroppedToastId("srv-1")).toBe("fetch-body-dropped-srv-1");
    expect(bodyDroppedToastId("srv-1")).toBe(bodyDroppedToastId("srv-1"));
    expect(bodyDroppedToastId("srv-2")).not.toBe(bodyDroppedToastId("srv-1"));
  });
});

describe("CLIENT_CONFIG_LOAD_ERROR_NOTIFICATION_ID", () => {
  it("is a stable id", () => {
    expect(CLIENT_CONFIG_LOAD_ERROR_NOTIFICATION_ID).toBe(
      "client-config-load-error",
    );
  });
});
