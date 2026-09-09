import type { EntityTypeInput } from "@/lib/entities/schemas";

/**
 * Product and Customer, as ordinary Record Type definitions.
 *
 * These were real Postgres tables with real columns until the catalog
 * collapse. They are not privileged concepts and never were — a landlord
 * has Properties, a law firm has Cases, and none of them should have paid
 * rent on a retail-shaped schema they can't change (CLAUDE.md §4.3).
 *
 * They survive as *starter* types: a template installs them, and from that
 * moment a business can rename their fields, add its own, or delete them
 * outright. That is the entire difference between a template and a
 * primitive, and it's why this file is data rather than a table.
 *
 * The typed-field work is what made this possible. `unitPrice` was a
 * `Decimal(10,2)` column, and the old refusal to let agents write to these
 * types existed precisely because an untyped string bag couldn't safely
 * populate it. `currency` rounds to 2dp on write, so that reason is gone
 * and the read/write asymmetry goes with it.
 */
export const STARTER_RECORD_TYPES: EntityTypeInput[] = [
  {
    name: "Product",
    fields: [
      {
        name: "sku",
        description: "The product code used to identify this item",
        type: "text",
        required: true,
      },
      {
        name: "name",
        description: "What the product is called",
        type: "text",
        required: true,
      },
      {
        name: "unitPrice",
        description: "Price for a single unit",
        type: "currency",
        required: true,
      },
      {
        // Stock is a field on the product, not a separate "check
        // inventory" capability — availability is a property of the thing,
        // and the tool that used to exist for it was deleted for exactly
        // this reason (CLAUDE.md §4.5, §7).
        name: "stockQuantity",
        description: "How many units are currently in stock",
        type: "number",
        required: true,
      },
    ],
  },
  {
    name: "Customer",
    fields: [
      {
        name: "name",
        description: "The customer's full name",
        type: "text",
        required: true,
      },
      {
        name: "email",
        description: "The customer's email address",
        type: "text",
        required: true,
      },
      {
        // Optional, unlike the NOT NULL column this replaces. A customer
        // with no company was previously unrepresentable, which is wrong
        // for anyone selling to individuals.
        name: "company",
        description: "The company they buy on behalf of, if any",
        type: "text",
        required: false,
      },
    ],
  },
  {
    // Brought in by the "Sales & Enquiries" WorkflowTemplate's Lead
    // Qualifier handler (lib/workflows/built-in-workflow-templates.ts) — a
    // new enquiry logged before it's known whether it becomes a real
    // Customer.
    name: "Lead",
    fields: [
      {
        name: "name",
        description: "The lead's full name",
        type: "text",
        required: true,
      },
      {
        name: "email",
        description: "The lead's contact email",
        type: "text",
        required: true,
      },
      {
        name: "interest",
        description: "What they're enquiring about",
        type: "text",
        required: false,
      },
    ],
  },
  {
    // Brought in by the "Scheduling & Bookings" WorkflowTemplate's Booking
    // Coordinator handler.
    name: "Booking",
    fields: [
      {
        name: "reference",
        description: "The booking or order reference",
        type: "text",
        required: true,
      },
      {
        name: "customerName",
        description: "Who the booking is for",
        type: "text",
        required: true,
      },
      {
        name: "date",
        description: "The date the booking is for",
        type: "date",
        required: false,
      },
      {
        name: "status",
        description: "Where this booking currently stands",
        type: "select",
        options: ["Pending", "Confirmed", "Cancelled"],
        required: false,
      },
    ],
  },
  {
    // Brought in by the "Document & Records" WorkflowTemplate's Record
    // Filer handler — filing an inbound invoice/order/application as a
    // record needs somewhere real to write it.
    name: "Invoice",
    fields: [
      {
        name: "number",
        description: "The invoice or reference number",
        type: "text",
        required: true,
      },
      {
        name: "total",
        description: "The total amount",
        type: "currency",
        required: false,
      },
    ],
  },
];
