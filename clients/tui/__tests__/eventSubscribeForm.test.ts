import { describe, it, expect } from "vitest";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import {
  decodeSubscribeValues,
  deliveryFieldName,
  eventSubscribeForm,
  subscribableModes,
} from "../src/utils/eventSubscribeForm.js";

const eventType = (over: Partial<EventType> = {}): EventType => ({
  name: "deploy.completed",
  delivery: ["poll", "push"],
  inputSchema: {
    type: "object",
    properties: { region: { type: "string" }, env: { type: "string" } },
    required: ["region"],
  },
  ...over,
});

describe("subscribableModes", () => {
  it("keeps poll and push, poll first, and drops webhook and unknown modes", () => {
    expect(
      subscribableModes(eventType({ delivery: ["push", "webhook", "poll"] })),
    ).toEqual(["poll", "push"]);
    expect(subscribableModes(eventType({ delivery: ["webhook"] }))).toEqual([]);
    expect(
      subscribableModes(eventType({ delivery: ["carrier-pigeon", "push"] })),
    ).toEqual(["push"]);
  });
});

describe("deliveryFieldName", () => {
  it("is `delivery` unless an argument already has that name", () => {
    expect(deliveryFieldName({ properties: { region: {} } })).toBe("delivery");
    expect(
      deliveryFieldName({ properties: { delivery: {}, _delivery: {} } }),
    ).toBe("__delivery");
  });

  it("tolerates a schema with no properties", () => {
    expect(deliveryFieldName({ type: "object" })).toBe("delivery");
    expect(deliveryFieldName({ properties: null })).toBe("delivery");
    expect(deliveryFieldName(null)).toBe("delivery");
  });
});

describe("eventSubscribeForm", () => {
  it("puts a delivery picker first, then the arguments", () => {
    const built = eventSubscribeForm(eventType())!;
    expect(built.deliveryField).toBe("delivery");
    expect(built.modes).toEqual(["poll", "push"]);
    expect(built.form.title).toBe("Subscribe: deploy.completed");
    const [delivery, args] = built.form.sections;
    expect(delivery!.title).toBe("Delivery");
    expect(delivery!.fields[0]).toMatchObject({
      type: "select",
      name: "delivery",
      initialValue: "poll",
      options: [
        { label: "poll", value: "poll" },
        { label: "push", value: "push" },
      ],
    });
    expect(args!.title).toBe("Arguments");
    expect(args!.fields.map((f) => f.name)).toEqual(["region", "env"]);
  });

  it("keeps a root union's own section titles", () => {
    const built = eventSubscribeForm(
      eventType({
        inputSchema: {
          type: "object",
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "email" },
                address: { type: "string" },
              },
              required: ["kind", "address"],
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", const: "sms" },
                phone: { type: "string" },
              },
              required: ["kind", "phone"],
            },
          ],
        },
      }),
    )!;
    const titles = built.form.sections.map((s) => s.title);
    // The base section is renamed; each alternative keeps its own label.
    expect(titles.slice(0, 2)).toEqual(["Delivery", "Arguments"]);
    expect(titles.length).toBeGreaterThan(2);
    expect(titles.slice(2)).not.toContain("Parameters");
  });

  it("is null for a type the TUI cannot subscribe to", () => {
    expect(eventSubscribeForm(eventType({ delivery: ["webhook"] }))).toBeNull();
  });
});

describe("decodeSubscribeValues", () => {
  const type = eventType();
  const built = eventSubscribeForm(type)!;

  it("splits the chosen mode off the arguments", () => {
    expect(
      decodeSubscribeValues(type, built, {
        delivery: "push",
        region: "us-west1",
      }),
    ).toEqual({ ok: true, mode: "push", arguments: { region: "us-west1" } });
  });

  it("refuses a missing required argument", () => {
    expect(decodeSubscribeValues(type, built, { delivery: "poll" })).toEqual({
      ok: false,
      error: "Missing required argument: region",
    });
    const both = eventType({
      inputSchema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
    });
    expect(
      decodeSubscribeValues(both, eventSubscribeForm(both)!, {
        delivery: "poll",
      }),
    ).toEqual({ ok: false, error: "Missing required arguments: a, b" });
  });

  it("refuses a mode the type does not offer", () => {
    expect(
      decodeSubscribeValues(type, built, { delivery: "webhook", region: "x" }),
    ).toEqual({ ok: false, error: "Choose a delivery mode." });
  });
});
