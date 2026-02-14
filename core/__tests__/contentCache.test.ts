import { describe, it, expect, beforeEach } from "vitest";
import {
  ContentCache,
  type ReadOnlyContentCache,
  type ReadWriteContentCache,
} from "../mcp/contentCache.js";
import type {
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
  PromptGetInvocation,
  ToolCallInvocation,
} from "../mcp/types.js";
import type {
  ReadResourceResult,
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

// Helper functions to create test invocation objects
function createResourceReadInvocation(
  uri: string,
  timestamp: Date = new Date(),
): ResourceReadInvocation {
  return {
    uri,
    timestamp,
    result: {
      contents: [
        {
          uri: uri,
          text: `Content for ${uri}`,
        },
      ],
    } as ReadResourceResult,
  };
}

function createResourceTemplateReadInvocation(
  uriTemplate: string,
  expandedUri: string,
  params: Record<string, string> = {},
  timestamp: Date = new Date(),
): ResourceTemplateReadInvocation {
  return {
    uriTemplate,
    expandedUri,
    params,
    timestamp,
    result: {
      contents: [
        {
          uri: expandedUri,
          text: `Content for ${expandedUri}`,
        },
      ],
    } as ReadResourceResult,
  };
}

function createPromptGetInvocation(
  name: string,
  params: Record<string, string> = {},
  timestamp: Date = new Date(),
): PromptGetInvocation {
  return {
    name,
    params,
    timestamp,
    result: {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Prompt content for ${name}`,
          },
        },
      ],
    } as GetPromptResult,
  };
}

function createToolCallInvocation(
  toolName: string,
  success: boolean = true,
  params: Record<string, any> = {},
  timestamp: Date = new Date(),
): ToolCallInvocation {
  return {
    toolName,
    params,
    timestamp,
    success,
    result: success
      ? ({
          content: [
            {
              type: "text",
              text: `Result from ${toolName}`,
            },
          ],
        } as CallToolResult)
      : null,
    error: success ? undefined : "Tool call failed",
  };
}

describe("ContentCache", () => {
  let cache: ContentCache;

  beforeEach(() => {
    cache = new ContentCache();
  });

  describe("instantiation", () => {
    it("should create an empty cache", () => {
      expect(cache).toBeInstanceOf(ContentCache);
      expect(cache.getResource("test://uri")).toBeNull();
      expect(cache.getResourceTemplate("test://{path}")).toBeNull();
      expect(cache.getPrompt("testPrompt")).toBeNull();
      expect(cache.getToolCallResult("testTool")).toBeNull();
    });
  });

  describe("Resource caching", () => {
    it("should store and retrieve resource content", () => {
      const uri = "file:///test.txt";
      const invocation = createResourceReadInvocation(uri);

      cache.setResource(uri, invocation);
      const retrieved = cache.getResource(uri);

      expect(retrieved).toBe(invocation); // Object identity preserved
      expect(retrieved?.uri).toBe(uri);
      const content = retrieved?.result.contents[0];
      expect(content && "text" in content ? content.text : undefined).toBe(
        "Content for file:///test.txt",
      );
    });

    it("should return null for non-existent resource", () => {
      expect(cache.getResource("file:///nonexistent.txt")).toBeNull();
    });

    it("should replace existing resource content", () => {
      const uri = "file:///test.txt";
      const invocation1 = createResourceReadInvocation(uri, new Date(1000));
      const invocation2 = createResourceReadInvocation(uri, new Date(2000));

      cache.setResource(uri, invocation1);
      cache.setResource(uri, invocation2);

      const retrieved = cache.getResource(uri);
      expect(retrieved).toBe(invocation2);
      expect(retrieved?.timestamp.getTime()).toBe(2000);
    });

    it("should clear specific resource", () => {
      const uri1 = "file:///test1.txt";
      const uri2 = "file:///test2.txt";
      cache.setResource(uri1, createResourceReadInvocation(uri1));
      cache.setResource(uri2, createResourceReadInvocation(uri2));

      cache.clearResource(uri1);

      expect(cache.getResource(uri1)).toBeNull();
      expect(cache.getResource(uri2)).not.toBeNull();
    });

    it("should handle clearing non-existent resource", () => {
      expect(() =>
        cache.clearResource("file:///nonexistent.txt"),
      ).not.toThrow();
    });
  });

  describe("Resource template caching", () => {
    it("should store and retrieve resource template content", () => {
      const uriTemplate = "file:///{path}";
      const expandedUri = "file:///test.txt";
      const params = { path: "test.txt" };
      const invocation = createResourceTemplateReadInvocation(
        uriTemplate,
        expandedUri,
        params,
      );

      cache.setResourceTemplate(uriTemplate, invocation);
      const retrieved = cache.getResourceTemplate(uriTemplate);

      expect(retrieved).toBe(invocation); // Object identity preserved
      expect(retrieved?.uriTemplate).toBe(uriTemplate);
      expect(retrieved?.expandedUri).toBe(expandedUri);
      expect(retrieved?.params).toEqual(params);
    });

    it("should return null for non-existent resource template", () => {
      expect(cache.getResourceTemplate("file:///{path}")).toBeNull();
    });

    it("should replace existing resource template content", () => {
      const uriTemplate = "file:///{path}";
      const invocation1 = createResourceTemplateReadInvocation(
        uriTemplate,
        "file:///test1.txt",
        { path: "test1.txt" },
        new Date(1000),
      );
      const invocation2 = createResourceTemplateReadInvocation(
        uriTemplate,
        "file:///test2.txt",
        { path: "test2.txt" },
        new Date(2000),
      );

      cache.setResourceTemplate(uriTemplate, invocation1);
      cache.setResourceTemplate(uriTemplate, invocation2);

      const retrieved = cache.getResourceTemplate(uriTemplate);
      expect(retrieved).toBe(invocation2);
      expect(retrieved?.expandedUri).toBe("file:///test2.txt");
    });

    it("should clear specific resource template", () => {
      const template1 = "file:///{path1}";
      const template2 = "file:///{path2}";
      cache.setResourceTemplate(
        template1,
        createResourceTemplateReadInvocation(template1, "file:///test1.txt"),
      );
      cache.setResourceTemplate(
        template2,
        createResourceTemplateReadInvocation(template2, "file:///test2.txt"),
      );

      cache.clearResourceTemplate(template1);

      expect(cache.getResourceTemplate(template1)).toBeNull();
      expect(cache.getResourceTemplate(template2)).not.toBeNull();
    });

    it("should handle clearing non-existent resource template", () => {
      expect(() =>
        cache.clearResourceTemplate("file:///{nonexistent}"),
      ).not.toThrow();
    });
  });

  describe("Prompt caching", () => {
    it("should store and retrieve prompt content", () => {
      const name = "testPrompt";
      const params = { city: "NYC" };
      const invocation = createPromptGetInvocation(name, params);

      cache.setPrompt(name, invocation);
      const retrieved = cache.getPrompt(name);

      expect(retrieved).toBe(invocation); // Object identity preserved
      expect(retrieved?.name).toBe(name);
      expect(retrieved?.params).toEqual(params);
      const messageContent = retrieved?.result.messages[0]?.content;
      expect(
        messageContent && "text" in messageContent
          ? messageContent.text
          : undefined,
      ).toBe("Prompt content for testPrompt");
    });

    it("should return null for non-existent prompt", () => {
      expect(cache.getPrompt("nonexistentPrompt")).toBeNull();
    });

    it("should replace existing prompt content", () => {
      const name = "testPrompt";
      const invocation1 = createPromptGetInvocation(
        name,
        { city: "NYC" },
        new Date(1000),
      );
      const invocation2 = createPromptGetInvocation(
        name,
        { city: "LA" },
        new Date(2000),
      );

      cache.setPrompt(name, invocation1);
      cache.setPrompt(name, invocation2);

      const retrieved = cache.getPrompt(name);
      expect(retrieved).toBe(invocation2);
      expect(retrieved?.params?.city).toBe("LA");
    });

    it("should clear specific prompt", () => {
      const name1 = "prompt1";
      const name2 = "prompt2";
      cache.setPrompt(name1, createPromptGetInvocation(name1));
      cache.setPrompt(name2, createPromptGetInvocation(name2));

      cache.clearPrompt(name1);

      expect(cache.getPrompt(name1)).toBeNull();
      expect(cache.getPrompt(name2)).not.toBeNull();
    });

    it("should handle clearing non-existent prompt", () => {
      expect(() => cache.clearPrompt("nonexistentPrompt")).not.toThrow();
    });
  });

  describe("Tool call result caching", () => {
    it("should store and retrieve successful tool call result", () => {
      const toolName = "testTool";
      const params = { arg1: "value1" };
      const invocation = createToolCallInvocation(toolName, true, params);

      cache.setToolCallResult(toolName, invocation);
      const retrieved = cache.getToolCallResult(toolName);

      expect(retrieved).toBe(invocation); // Object identity preserved
      expect(retrieved?.toolName).toBe(toolName);
      expect(retrieved?.success).toBe(true);
      expect(retrieved?.result).not.toBeNull();
      const toolContent = retrieved?.result?.content[0];
      expect(
        toolContent && "text" in toolContent ? toolContent.text : undefined,
      ).toBe("Result from testTool");
    });

    it("should store and retrieve failed tool call result", () => {
      const toolName = "failingTool";
      const params = { arg1: "value1" };
      const invocation = createToolCallInvocation(toolName, false, params);

      cache.setToolCallResult(toolName, invocation);
      const retrieved = cache.getToolCallResult(toolName);

      expect(retrieved).toBe(invocation); // Object identity preserved
      expect(retrieved?.toolName).toBe(toolName);
      expect(retrieved?.success).toBe(false);
      expect(retrieved?.result).toBeNull();
      expect(retrieved?.error).toBe("Tool call failed");
    });

    it("should return null for non-existent tool call result", () => {
      expect(cache.getToolCallResult("nonexistentTool")).toBeNull();
    });

    it("should replace existing tool call result", () => {
      const toolName = "testTool";
      const invocation1 = createToolCallInvocation(
        toolName,
        true,
        { arg1: "value1" },
        new Date(1000),
      );
      const invocation2 = createToolCallInvocation(
        toolName,
        true,
        { arg1: "value2" },
        new Date(2000),
      );

      cache.setToolCallResult(toolName, invocation1);
      cache.setToolCallResult(toolName, invocation2);

      const retrieved = cache.getToolCallResult(toolName);
      expect(retrieved).toBe(invocation2);
      expect(retrieved?.params.arg1).toBe("value2");
    });

    it("should clear specific tool call result", () => {
      const tool1 = "tool1";
      const tool2 = "tool2";
      cache.setToolCallResult(tool1, createToolCallInvocation(tool1));
      cache.setToolCallResult(tool2, createToolCallInvocation(tool2));

      cache.clearToolCallResult(tool1);

      expect(cache.getToolCallResult(tool1)).toBeNull();
      expect(cache.getToolCallResult(tool2)).not.toBeNull();
    });

    it("should handle clearing non-existent tool call result", () => {
      expect(() => cache.clearToolCallResult("nonexistentTool")).not.toThrow();
    });
  });

  describe("clearAll", () => {
    it("should clear all cached content", () => {
      // Populate all caches
      cache.setResource(
        "file:///test.txt",
        createResourceReadInvocation("file:///test.txt"),
      );
      cache.setResourceTemplate(
        "file:///{path}",
        createResourceTemplateReadInvocation(
          "file:///{path}",
          "file:///test.txt",
        ),
      );
      cache.setPrompt("testPrompt", createPromptGetInvocation("testPrompt"));
      cache.setToolCallResult("testTool", createToolCallInvocation("testTool"));

      cache.clearAll();

      expect(cache.getResource("file:///test.txt")).toBeNull();
      expect(cache.getResourceTemplate("file:///{path}")).toBeNull();
      expect(cache.getPrompt("testPrompt")).toBeNull();
      expect(cache.getToolCallResult("testTool")).toBeNull();
    });

    it("should handle clearAll on empty cache", () => {
      expect(() => cache.clearAll()).not.toThrow();
    });
  });

  describe("Type safety", () => {
    it("should implement ReadWriteContentCache interface", () => {
      const cache: ReadWriteContentCache = new ContentCache();
      expect(cache).toBeInstanceOf(ContentCache);
    });

    it("should be assignable to ReadOnlyContentCache", () => {
      const cache: ReadOnlyContentCache = new ContentCache();
      expect(cache).toBeInstanceOf(ContentCache);
    });

    it("should maintain type safety for all cache operations", () => {
      const uri = "file:///test.txt";
      const invocation = createResourceReadInvocation(uri);

      cache.setResource(uri, invocation);
      const retrieved = cache.getResource(uri);

      // TypeScript should infer the correct types
      if (retrieved) {
        expect(typeof retrieved.uri).toBe("string");
        expect(retrieved.timestamp).toBeInstanceOf(Date);
        expect(retrieved.result).toBeDefined();
      }
    });
  });

  describe("clearByUri", () => {
    it("should clear regular resource by URI", () => {
      const uri = "file:///test.txt";
      cache.setResource(uri, createResourceReadInvocation(uri));
      expect(cache.getResource(uri)).not.toBeNull();

      cache.clearResourceAndResourceTemplate(uri);
      expect(cache.getResource(uri)).toBeNull();
    });

    it("should clear resource template with matching expandedUri", () => {
      const uriTemplate = "file:///{path}";
      const expandedUri = "file:///test.txt";
      const params = { path: "test.txt" };
      cache.setResourceTemplate(
        uriTemplate,
        createResourceTemplateReadInvocation(uriTemplate, expandedUri, params),
      );
      expect(cache.getResourceTemplate(uriTemplate)).not.toBeNull();

      cache.clearResourceAndResourceTemplate(expandedUri);
      expect(cache.getResourceTemplate(uriTemplate)).toBeNull();
    });

    it("should clear both regular resource and resource template with same URI", () => {
      const uri = "file:///test.txt";
      const uriTemplate = "file:///{path}";
      const params = { path: "test.txt" };

      // Set both a regular resource and a resource template with the same expanded URI
      cache.setResource(uri, createResourceReadInvocation(uri));
      cache.setResourceTemplate(
        uriTemplate,
        createResourceTemplateReadInvocation(uriTemplate, uri, params),
      );

      expect(cache.getResource(uri)).not.toBeNull();
      expect(cache.getResourceTemplate(uriTemplate)).not.toBeNull();

      // clearByUri should clear both
      cache.clearResourceAndResourceTemplate(uri);

      expect(cache.getResource(uri)).toBeNull();
      expect(cache.getResourceTemplate(uriTemplate)).toBeNull();
    });

    it("should not clear resource template with different expandedUri", () => {
      const uriTemplate = "file:///{path}";
      const expandedUri1 = "file:///test1.txt";
      const expandedUri2 = "file:///test2.txt";
      const params1 = { path: "test1.txt" };
      const params2 = { path: "test2.txt" };

      cache.setResourceTemplate(
        uriTemplate,
        createResourceTemplateReadInvocation(
          uriTemplate,
          expandedUri1,
          params1,
        ),
      );
      cache.setResourceTemplate(
        "file:///{other}",
        createResourceTemplateReadInvocation(
          "file:///{other}",
          expandedUri2,
          params2,
        ),
      );

      // Clear by first URI
      cache.clearResourceAndResourceTemplate(expandedUri1);

      // First template should be cleared, second should remain
      expect(cache.getResourceTemplate(uriTemplate)).toBeNull();
      expect(cache.getResourceTemplate("file:///{other}")).not.toBeNull();
    });

    it("should handle clearing non-existent URI", () => {
      expect(() =>
        cache.clearResourceAndResourceTemplate("file:///nonexistent.txt"),
      ).not.toThrow();
    });
  });

  describe("Edge cases", () => {
    it("should handle multiple operations on the same entry", () => {
      const uri = "file:///test.txt";
      const invocation1 = createResourceReadInvocation(uri, new Date(1000));
      const invocation2 = createResourceReadInvocation(uri, new Date(2000));
      const invocation3 = createResourceReadInvocation(uri, new Date(3000));

      cache.setResource(uri, invocation1);
      expect(cache.getResource(uri)).toBe(invocation1);

      cache.setResource(uri, invocation2);
      expect(cache.getResource(uri)).toBe(invocation2);

      cache.clearResource(uri);
      expect(cache.getResource(uri)).toBeNull();

      cache.setResource(uri, invocation3);
      expect(cache.getResource(uri)).toBe(invocation3);
    });

    it("should handle empty strings as keys", () => {
      const invocation = createResourceReadInvocation("");
      cache.setResource("", invocation);
      expect(cache.getResource("")).toBe(invocation);
    });

    it("should handle special characters in keys", () => {
      const uri = "file:///test with spaces & special chars.txt";
      const invocation = createResourceReadInvocation(uri);
      cache.setResource(uri, invocation);
      expect(cache.getResource(uri)).toBe(invocation);
    });
  });
});
