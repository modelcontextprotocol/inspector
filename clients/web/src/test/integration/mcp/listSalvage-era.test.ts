import { describe, it, expect, afterEach } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import { ToolSchema } from "@modelcontextprotocol/core";
import {
  describeIssues,
  toolItemSchemaForEra,
} from "@inspector/core/mcp/listSalvage.js";

/**
 * The era item contract the salvage fallback validates tools against (#1909).
 *
 * `toolItemSchemaForEra` replicates two rules that live in the SDK's internal
 * per-era wire schemas, which are not exported. That is a real cost, and these
 * tests are what makes it safe to pay: each one asserts the STRICT path's
 * observed behavior on a real connection, so if a future SDK closes or widens a
 * divergence, the test fails and the replicated rule gets revisited instead of
 * silently rotting.
 *
 * The failure being prevented: the fallback keeping an entry the strict path
 * refused, which the user would then see — and could call — on a connection
 * whose era says it isn't valid.
 */

const ARRAY_OUTPUT_TOOL = {
  name: "array_output",
  inputSchema: { type: "object" },
  outputSchema: { type: "array" },
};

const EXECUTION_TOOL = {
  name: "with_execution",
  inputSchema: { type: "object" },
  execution: { taskSupport: "optional" },
};

function startToolsServer(
  tools: unknown[],
  modern: boolean,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    if (raw.length === 0) {
      res.writeHead(405).end();
      return;
    }
    const body = JSON.parse(raw) as { id?: unknown; method: string };
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const envelope = modern
      ? { resultType: "complete", ttlMs: 0, cacheScope: "public" }
      : {};
    const send = (result: object) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { ...envelope, ...result },
        }),
      );
    };
    if (body.method === "initialize") {
      send({
        protocolVersion: modern ? "2026-07-28" : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "era-contract-server", version: "1.0.0" },
      });
      return;
    }
    if (body.method === "server/discover") {
      send({
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {} },
        serverInfo: { name: "era-contract-server", version: "1.0.0" },
      });
      return;
    }
    if (body.method === "tools/list") {
      send({ tools });
      return;
    }
    send({});
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      /* v8 ignore next -- listen() on a fresh server always yields an AddressInfo */
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        stop: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

describe("salvage era item contract (#1909)", () => {
  let client: InspectorClient | null = null;
  let stop: (() => Promise<void>) | null = null;

  afterEach(async () => {
    try {
      await client?.disconnect();
    } catch {
      // Teardown only.
    }
    client = null;
    await stop?.();
    stop = null;
  });

  async function connect(url: string, era: "legacy" | "modern") {
    client = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(era),
      },
    );
    await client.connect();
    return client;
  }

  it("legacy: the era rule is what rejects a non-object outputSchema (pins it)", async () => {
    // The rule lives in the SDK's high-level aggregate (the era codec), not in
    // the neutral schema the single-page call uses — which is precisely the
    // divergence `toolItemSchemaForEra` exists to close.
    //
    // This tool is the page's ONLY problem, so the observable outcome is
    // entirely the SDK's rule talking: the strict aggregate refuses the page,
    // the fallback runs, and our contract agrees the tool is not era-valid. If
    // a future SDK accepts it, the aggregate succeeds instead and this fails —
    // which is the signal to revisit the replicated rule.
    const server = await startToolsServer([ARRAY_OUTPUT_TOOL], false);
    stop = server.stop;
    const connected = await connect(server.url, "legacy");

    const { tools } = await connected.listAllTools();
    expect(tools).toEqual([]);
    expect(
      connected.getMalformedListItems().map((entry) => entry.label),
    ).toEqual(["array_output"]);
  });

  it("modern: the era rule accepts a tool but strips execution (pins it)", async () => {
    // The mirror image: here the strict aggregate SUCCEEDS, so no salvage runs
    // and what comes back is the SDK's own normalization. If it ever stops
    // stripping, `execution` reappears here and this fails.
    const server = await startToolsServer([EXECUTION_TOOL], true);
    stop = server.stop;
    const connected = await connect(server.url, "modern");

    const { tools } = await connected.listAllTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).not.toHaveProperty("execution");
    expect(connected.getMalformedListItems()).toEqual([]);
  });

  it("the neutral ToolSchema is looser than both, which is why the contract exists", () => {
    expect(ToolSchema.safeParse(ARRAY_OUTPUT_TOOL).success).toBe(true);
    const neutral = ToolSchema.safeParse(EXECUTION_TOOL);
    expect(neutral.success).toBe(true);
    expect(neutral.success && neutral.data).toHaveProperty("execution");
  });

  it("names the offending field, not just 'invalid tool'", () => {
    // The era contract validates through a wire schema and forwards its issues,
    // so the PATH has to survive that hop — it is the whole diagnostic value of
    // the report, and a collapsed "Invalid input" would still pass every
    // accept/reject assertion above.
    const parsed = toolItemSchemaForEra(false).safeParse({
      name: "t",
      inputSchema: { type: "array" },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success || describeIssues(parsed.error)).toMatch(
      /^inputSchema\.type: .*object/,
    );
  });

  it("strips unknown fields the way the strict codec does", async () => {
    // The contract validates through a wire schema; returning the ORIGINAL
    // value rather than the parsed one would leave salvaged tools carrying
    // fields the strict path drops, so the two paths would hand the UI
    // differently-shaped tools for the same server.
    const strayTool = {
      name: "stray",
      inputSchema: { type: "object" },
      notAToolField: "should not survive",
    };
    const parsed = toolItemSchemaForEra(false).safeParse(strayTool);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty("notAToolField");

    // And the strict path agrees — this is the shape being matched, not an
    // invented rule.
    const server = await startToolsServer([strayTool], false);
    stop = server.stop;
    const connected = await connect(server.url, "legacy");
    const { tools } = await connected.listAllTools();
    expect(tools[0]).not.toHaveProperty("notAToolField");
  });

  it("the era contract matches the strict path on both divergences", () => {
    // Legacy: rejected, exactly as the strict parse above rejected it.
    expect(
      toolItemSchemaForEra(false).safeParse(ARRAY_OUTPUT_TOOL).success,
    ).toBe(false);
    // Modern: accepted, with `execution` stripped, exactly as above.
    const modern = toolItemSchemaForEra(true).safeParse(EXECUTION_TOOL);
    expect(modern.success).toBe(true);
    expect(modern.success && modern.data).not.toHaveProperty("execution");
  });

  /**
   * What the STRICT path did with a tool, decided without consulting our own
   * contract: the SDK accepted it only if the tool came back and nothing was
   * reported malformed. (If the SDK rejects and our contract accepts, salvage
   * finds nothing per-item wrong and rethrows — also a "reject" observation.)
   */
  async function strictVerdict(
    tool: unknown,
    era: "legacy" | "modern",
  ): Promise<"accept" | "reject"> {
    const server = await startToolsServer([tool], era === "modern");
    stop = server.stop;
    const connected = await connect(server.url, era);
    try {
      const { tools } = await connected.listAllTools();
      return tools.length === 1 &&
        connected.getMalformedListItems().length === 0
        ? "accept"
        : "reject";
    } catch {
      return "reject";
    }
  }

  const withInput = (inputSchema: unknown) => ({ name: "t", inputSchema });
  const withOutput = (outputSchema: unknown) => ({
    name: "t",
    inputSchema: { type: "object" },
    outputSchema,
  });

  /**
   * Every measured divergence between the two eras and the neutral schema.
   *
   * Each row is checked twice: that the SDK still behaves this way, and that
   * our replicated contract agrees with it. The two directions both matter —
   * an `accept` we reject means salvage would drop a tool the strict path kept
   * and report a conforming server as malformed; a `reject` we accept means
   * salvage readmits an entry the era refused.
   */
  const ERA_CASES: {
    label: string;
    tool: unknown;
    legacy: "accept" | "reject";
    modern: "accept" | "reject";
  }[] = [
    {
      label: "inputSchema.type: array",
      tool: withInput({ type: "array" }),
      legacy: "reject",
      modern: "reject",
    },
    {
      label: "inputSchema.properties: 5",
      tool: withInput({ type: "object", properties: 5 }),
      legacy: "reject",
      modern: "accept",
    },
    {
      label: "inputSchema.required: [1]",
      tool: withInput({ type: "object", required: [1] }),
      legacy: "reject",
      modern: "accept",
    },
    {
      label: "inputSchema.$schema: 5",
      tool: withInput({ type: "object", $schema: 5 }),
      legacy: "accept",
      modern: "reject",
    },
    {
      label: "outputSchema.type: array",
      tool: withOutput({ type: "array" }),
      legacy: "reject",
      modern: "accept",
    },
    {
      label: "outputSchema.properties: 5",
      tool: withOutput({ type: "object", properties: 5 }),
      legacy: "reject",
      modern: "accept",
    },
    {
      label: "outputSchema.required: [1]",
      tool: withOutput({ type: "object", required: [1] }),
      legacy: "reject",
      modern: "accept",
    },
    {
      label: "outputSchema.$schema: 5",
      tool: withOutput({ type: "object", $schema: 5 }),
      legacy: "accept",
      modern: "reject",
    },
  ];

  for (const era of ["legacy", "modern"] as const) {
    for (const { label, tool, ...expected } of ERA_CASES) {
      it(`${era}: ${label} — contract agrees with the strict path`, async () => {
        const observed = await strictVerdict(tool, era);
        // Pins the SDK: if this fails, the era rule changed and the replicated
        // contract below needs revisiting rather than the test relaxing.
        expect(observed).toBe(expected[era]);
        // Pins our agreement with it, in whichever direction it differs.
        expect(
          toolItemSchemaForEra(era === "modern").safeParse(tool).success,
        ).toBe(expected[era] === "accept");
      });
    }
  }

  it("keeps only era-valid tools when salvaging beside a malformed one", async () => {
    // The end-to-end shape of the defect: a malformed entry trips the
    // fallback, and the array-output tool must NOT ride along on the strength
    // of the neutral schema accepting it.
    const server = await startToolsServer(
      [
        { name: "ok_tool", inputSchema: { type: "object" } },
        ARRAY_OUTPUT_TOOL,
        { name: "broken", inputSchema: "not-a-schema" },
      ],
      false,
    );
    stop = server.stop;
    const connected = await connect(server.url, "legacy");

    const { tools } = await connected.listAllTools();
    expect(tools.map((tool) => tool.name)).toEqual(["ok_tool"]);
    expect(
      connected.getMalformedListItems().map((entry) => entry.label),
    ).toEqual(["array_output", "broken"]);
  });
});
