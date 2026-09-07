import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createMcpProxyTool } from "@/lib/mcp/tools/mcp-proxy-tool";

// Fix 6: the pass-through schema must reflect the remote tool's real
// declared type/description/required-ness where it can, but degrade
// gracefully — never throw, never break registration for the whole tool —
// when a property's declared schema is malformed or something this
// platform doesn't handle. Registration itself (createMcpProxyTool) must
// never throw regardless of what a remote server declares.

function inputSchemaOf(
  properties: Record<string, unknown>,
  required?: string[],
) {
  const tool = createMcpProxyTool("int1", "https://example.test/mcp", "tok", {
    name: "weird_tool",
    description: "A tool with an unusual schema.",
    inputSchema: { type: "object", properties, required },
    readOnlyHint: null,
  });
  return z.object(tool.inputSchema);
}

describe("createMcpProxyTool's pass-through schema", () => {
  it("maps well-formed properties to their real types, descriptions, and required-ness", () => {
    const schema = inputSchemaOf(
      {
        query: { type: "string", description: "The search query." },
        limit: { type: "number" },
        active: { type: "boolean" },
        tags: { type: "array" },
        meta: { type: "object" },
      },
      ["query"],
    );

    expect(schema.safeParse({ query: "hi" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false); // query is required
    expect(
      schema.safeParse({ query: "hi", limit: "not a number" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        query: "hi",
        limit: 3,
        active: true,
        tags: [1, 2],
        meta: { a: 1 },
      }).success,
    ).toBe(true);
  });

  it("falls back to a permissive unknown().optional() for a property with a missing type", () => {
    const schema = inputSchemaOf({ mystery: {} });
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ mystery: "anything" }).success).toBe(true);
    expect(schema.safeParse({ mystery: { nested: true } }).success).toBe(true);
  });

  it("falls back to unknown().optional() for a type it doesn't map (null, anyOf-shaped, unrecognized string)", () => {
    const schema = inputSchemaOf({
      nullable: { type: "null" },
      union: { anyOf: [{ type: "string" }, { type: "number" }] },
      exotic: { type: "some-future-json-schema-type" },
    });

    expect(
      schema.safeParse({ nullable: null, union: 5, exotic: "whatever" })
        .success,
    ).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("does not throw and falls back to unknown().optional() when a property's declared *type* is itself malformed", () => {
    expect(() =>
      inputSchemaOf({
        // type is a number instead of a string — not a valid JSON Schema
        weirdType: { type: 42 },
        // the whole property entry is not an object at all
        notAnObject: "just a string",
        nullEntry: null,
      }),
    ).not.toThrow();

    const schema = inputSchemaOf({
      weirdType: { type: 42 },
      notAnObject: "just a string",
      nullEntry: null,
    });

    // All of these fall back to a fully permissive, optional shape — an
    // empty object is still valid, and any value is accepted for each.
    expect(schema.safeParse({}).success).toBe(true);
    expect(
      schema.safeParse({
        weirdType: { anything: true },
        notAnObject: [1, 2, 3],
        nullEntry: "x",
      }).success,
    ).toBe(true);
  });

  it("ignores a malformed description while still applying a correctly-declared type — a partial degradation, not an all-or-nothing one", () => {
    const schema = inputSchemaOf({
      weirdDescription: { type: "string", description: { nested: true } },
    });

    // The type itself was valid, so it's still enforced — only the
    // malformed description was dropped, not the whole property's shape.
    expect(
      schema.safeParse({ weirdDescription: "a real string" }).success,
    ).toBe(true);
    expect(schema.safeParse({ weirdDescription: 123 }).success).toBe(false);
  });

  it("does not throw when the remote tool declares no properties at all", () => {
    expect(() =>
      createMcpProxyTool("int1", "https://example.test/mcp", "tok", {
        name: "no_params_tool",
        description: "Takes no parameters.",
        inputSchema: { type: "object" },
        readOnlyHint: true,
      }),
    ).not.toThrow();
  });
});
