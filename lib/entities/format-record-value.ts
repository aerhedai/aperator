import { currencySymbol } from "@/lib/currency/currency-symbols";
import type { EntityFieldConfig } from "@/lib/entities/schemas";

export interface ReferenceTarget {
  entityTypeId: string;
  // Referenced record id -> a human label (its target type's first
  // non-reference field, falling back to the id itself).
  labels: Record<string, string>;
}

export type FormattedCell =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "reference"; label: string; href: string };

/**
 * Pure, DOM-free formatting for one record field's value — kept separate
 * from entity-record-table.tsx specifically so it's unit-testable without
 * a component-rendering setup, which this project doesn't otherwise have
 * (no jsdom/testing-library; every other test is either pure-logic or a
 * real-DB integration test). The table component turns the "reference"
 * and "boolean" kinds into real JSX; every other kind is already
 * display-ready text.
 */
export function formatRecordValue(
  field: EntityFieldConfig,
  value: unknown,
  currencyCode: string,
  referenceTargets: Record<string, ReferenceTarget>,
): FormattedCell {
  if (value === undefined || value === null || value === "") {
    return { kind: "empty" };
  }

  switch (field.type) {
    case "currency":
      return {
        kind: "text",
        text:
          typeof value === "number"
            ? `${currencySymbol(currencyCode)}${value.toFixed(2)}`
            : String(value),
      };
    case "number":
      return {
        kind: "text",
        text: typeof value === "number" ? value.toLocaleString() : String(value),
      };
    case "boolean":
      return { kind: "boolean", value: Boolean(value) };
    case "date": {
      const date = new Date(value as string);
      return {
        kind: "text",
        text: Number.isNaN(date.getTime())
          ? String(value)
          : date.toLocaleDateString(),
      };
    }
    case "reference": {
      const target = referenceTargets[field.name];
      if (!target || typeof value !== "string") {
        return { kind: "text", text: String(value) };
      }
      return {
        kind: "reference",
        label: target.labels[value] ?? value,
        href: `/catalog/${target.entityTypeId}/records/${value}/edit`,
      };
    }
    default:
      return { kind: "text", text: String(value) };
  }
}

// A record's plain-text content, for client-side search — includes resolved
// reference labels so searching "Acme" finds an Order whose customer field
// merely stores a Customer id, not the literal string "Acme".
export function recordSearchText(
  data: Record<string, unknown>,
  fields: EntityFieldConfig[],
  referenceTargets: Record<string, ReferenceTarget>,
): string {
  return fields
    .map((field) => {
      const value = data[field.name];
      if (value === undefined || value === null) return "";
      if (field.type === "reference" && typeof value === "string") {
        return referenceTargets[field.name]?.labels[value] ?? value;
      }
      return String(value);
    })
    .join(" ")
    .toLowerCase();
}
