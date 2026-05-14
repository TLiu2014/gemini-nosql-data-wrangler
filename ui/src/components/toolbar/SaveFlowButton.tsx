import { Download } from "lucide-react";
import type { Edge, Node } from "@xyflow/react";
import { Button } from "@/components/ui/Button";
import type { StageNodeData } from "@/types/Pipeline";
import { serializePipeline, type PipelineSchema } from "@/Schema";

export interface SaveFlowButtonProps {
  name: string;
  description?: string;
  nodes: Node<StageNodeData>[];
  edges: Edge[];
  /** Called with the serialized schema. If omitted, the schema is downloaded as JSON. */
  onSave?: (schema: PipelineSchema) => void;
  /** Force a download even when onSave is provided. Default: download only when onSave is missing. */
  download?: boolean;
  label?: string;
}

export function SaveFlowButton({
  name,
  description,
  nodes,
  edges,
  onSave,
  download,
  label = "Save flow",
}: SaveFlowButtonProps) {
  const handleSave = () => {
    const schema = serializePipeline(nodes, edges, { name, description });

    if (onSave) onSave(schema);

    const shouldDownload = download ?? !onSave;
    if (shouldDownload) downloadJson(schema, `${name || "pipeline"}-schema.json`);
  };

  return (
    <Button onClick={handleSave} size="sm" className="gap-1.5">
      <Download className="h-4 w-4" />
      {label}
    </Button>
  );
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
