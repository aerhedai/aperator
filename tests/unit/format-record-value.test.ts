import { describe, expect, it } from "vitest";

import {
  formatRecordValue,
  recordSearchText,
} from "@/lib/entities/format-record-value";
import type { EntityFieldConfig } from "@/lib/entities/schemas";

function field(overrides: Partial<EntityFieldConfig>): EntityFieldConfig {
  return {
    name: "field",
    description: "d",
    required: true,
    type: "text",
    ...overrides,
  } as EntityFieldConfig;
}

describe("formatRecordValue", () => {
  it("treats undefined, null, and empty string as empty for every type", () => {
    for (const type of ["text", "number", "currency", "date"] as const) {
      for (const value of [undefined, null, ""]) {
        expect(formatRecordValue(field({ type }), value, "GBP", {})).toEqual({
          kind: "empty",
        });
      }
    }
  });

  it("formats currency with the organisation's symbol, rounded to 2dp", () => {
    expect(
      formatRecordValue(field({ type: "currency" }), 849.9, "GBP", {}),
    ).toEqual({ kind: "text", text: "£849.90" });
    expect(
      formatRecordValue(field({ type: "currency" }), 12, "USD", {}),
    ).toEqual({ kind: "text", text: "$12.00" });
  });

  it("falls back to an unrecognised currency code as its own symbol", () => {
    expect(
      formatRecordValue(field({ type: "currency" }), 5, "JPY", {}),
    ).toEqual({ kind: "text", text: "JPY5.00" });
  });

  it("formats a number with locale grouping", () => {
    expect(
      formatRecordValue(field({ type: "number" }), 1000, "GBP", {}),
    ).toEqual({ kind: "text", text: "1,000" });
  });

  it("formats a boolean as its own kind, not text, so the table can render a chip", () => {
    expect(
      formatRecordValue(field({ type: "boolean" }), true, "GBP", {}),
    ).toEqual({ kind: "boolean", value: true });
    expect(
      formatRecordValue(field({ type: "boolean" }), false, "GBP", {}),
    ).toEqual({ kind: "boolean", value: false });
  });

  it("formats a stored ISO date string as a locale date, not the raw ISO string", () => {
    const result = formatRecordValue(
      field({ type: "date" }),
      "2026-03-05T00:00:00.000Z",
      "GBP",
      {},
    );
    expect(result.kind).toBe("text");
    expect(result).not.toEqual({
      kind: "text",
      text: "2026-03-05T00:00:00.000Z",
    });
  });

  it("falls back to the raw value for a date string that doesn't parse", () => {
    expect(
      formatRecordValue(field({ type: "date" }), "not-a-date", "GBP", {}),
    ).toEqual({ kind: "text", text: "not-a-date" });
  });

  it("resolves a reference to its target's label and edit link", () => {
    const result = formatRecordValue(
      field({ name: "customer", type: "reference", recordType: "Customer" }),
      "cust_1",
      "GBP",
      { customer: { entityTypeId: "et_customer", labels: { cust_1: "Acme Co" } } },
    );
    expect(result).toEqual({
      kind: "reference",
      label: "Acme Co",
      href: "/catalog/et_customer/records/cust_1/edit",
    });
  });

  it("falls back to the raw id when a reference target has no label for it", () => {
    const result = formatRecordValue(
      field({ name: "customer", type: "reference", recordType: "Customer" }),
      "cust_missing",
      "GBP",
      { customer: { entityTypeId: "et_customer", labels: {} } },
    );
    expect(result).toEqual({
      kind: "reference",
      label: "cust_missing",
      href: "/catalog/et_customer/records/cust_missing/edit",
    });
  });

  it("falls back to plain text when a reference field's target type couldn't be resolved", () => {
    // The target type/records lookup happens in the page component; a
    // missing entry here means that resolution failed (e.g. the target
    // type was deleted), not that the value itself is wrong.
    const result = formatRecordValue(
      field({ name: "customer", type: "reference", recordType: "Customer" }),
      "cust_1",
      "GBP",
      {},
    );
    expect(result).toEqual({ kind: "text", text: "cust_1" });
  });
});

describe("recordSearchText", () => {
  const fields: EntityFieldConfig[] = [
    field({ name: "name", type: "text" }),
    field({ name: "customer", type: "reference", recordType: "Customer" }),
  ];

  it("joins every field's plain value, lowercased", () => {
    const text = recordSearchText(
      { name: "Server Rack", customer: null },
      fields,
      {},
    );
    expect(text).toContain("server rack");
  });

  it("includes a reference field's resolved label, not its opaque id", () => {
    const text = recordSearchText(
      { name: "Order #1", customer: "cust_1" },
      fields,
      { customer: { entityTypeId: "et_customer", labels: { cust_1: "Acme Co" } } },
    );
    expect(text).toContain("acme co");
    expect(text).not.toContain("cust_1");
  });
});
