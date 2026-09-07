"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DeleteRecordButton } from "@/components/entities/delete-record-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatRecordValue,
  recordSearchText,
  type ReferenceTarget,
} from "@/lib/entities/format-record-value";
import type { EntityFieldConfig } from "@/lib/entities/schemas";

interface RecordRow {
  id: string;
  data: Record<string, unknown>;
}

function renderCell(
  field: EntityFieldConfig,
  value: unknown,
  currencyCode: string,
  referenceTargets: Record<string, ReferenceTarget>,
) {
  const cell = formatRecordValue(field, value, currencyCode, referenceTargets);
  switch (cell.kind) {
    case "empty":
      return <span className="text-muted-foreground">—</span>;
    case "text":
      return cell.text;
    case "boolean":
      return (
        <Badge variant={cell.value ? "default" : "outline"}>
          {cell.value ? "Yes" : "No"}
        </Badge>
      );
    case "reference":
      return (
        <Link href={cell.href} className="text-primary hover:underline">
          {cell.label}
        </Link>
      );
  }
}

export function EntityRecordTable({
  entityTypeId,
  fields,
  records,
  currencyCode,
  referenceTargets,
}: {
  entityTypeId: string;
  fields: EntityFieldConfig[];
  records: RecordRow[];
  currencyCode: string;
  referenceTargets: Record<string, ReferenceTarget>;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((record) =>
      recordSearchText(record.data, fields, referenceTargets).includes(q),
    );
  }, [records, fields, referenceTargets, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search records…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query ? "No records match your search." : "No records yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {fields.map((field) => (
                  <th key={field.name} className="px-4 py-2 font-medium">
                    {field.name}
                  </th>
                ))}
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((record) => (
                <tr
                  key={record.id}
                  className="border-b border-border last:border-0 hover:bg-muted/40"
                >
                  {fields.map((field) => (
                    <td key={field.name} className="px-4 py-2">
                      {renderCell(
                        field,
                        record.data[field.name],
                        currencyCode,
                        referenceTargets,
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <Link
                            href={`/catalog/${entityTypeId}/records/${record.id}/edit`}
                          />
                        }
                      >
                        Edit
                      </Button>
                      <DeleteRecordButton
                        entityTypeId={entityTypeId}
                        recordId={record.id}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
