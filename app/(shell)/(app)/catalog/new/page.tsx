import { EntityTypeForm } from "@/components/entities/entity-type-form";

export default function NewEntityTypePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Create entity type</h1>
      <EntityTypeForm />
    </div>
  );
}
