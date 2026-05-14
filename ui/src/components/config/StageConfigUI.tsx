import { useEffect, useMemo, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import {
  type StageConfig,
  type StageNodeData,
  type FilterOperator,
  type JoinType,
  type SortDirection,
  STAGE_COLORS,
  STAGE_LABELS,
} from "@/types/Pipeline";

interface StageConfigUIProps {
  node: { id: string; data: StageNodeData } | null;
  onUpdate: (id: string, patch: Partial<StageNodeData>) => void;
  onDelete: (id: string) => void;
  /**
   * Optional explicit-close handler. When provided, the form renders a
   * "Cancel" button next to "Save". The host decides what cancel means —
   * typically clearing the editing-node state (which dismisses the popover
   * or empties the right panel). Unsaved local edits are dropped on close.
   */
  onCancel?: () => void;
  /** When true (default), delete opens a confirmation dialog first. */
  confirmBeforeDelete?: boolean;
}

export function StageConfigUI({
  node,
  onUpdate,
  onDelete,
  onCancel,
  confirmBeforeDelete = true,
}: StageConfigUIProps) {
  if (!node) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-gray-500">
        Select a node on the canvas to configure it.
      </div>
    );
  }

  return (
    <StageConfigForm
      key={node.id}
      node={node}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onCancel={onCancel}
      confirmBeforeDelete={confirmBeforeDelete}
    />
  );
}

interface StageConfigFormProps {
  node: { id: string; data: StageNodeData };
  onUpdate: (id: string, patch: Partial<StageNodeData>) => void;
  onDelete: (id: string) => void;
  onCancel?: () => void;
  confirmBeforeDelete: boolean;
}

function StageConfigForm({
  node,
  onUpdate,
  onDelete,
  onCancel,
  confirmBeforeDelete,
}: StageConfigFormProps) {
  const [label, setLabel] = useState(node.data.label);
  const [config, setConfig] = useState<StageConfig>(node.data.config);
  const [outputTableName, setOutputTableName] = useState(
    node.data.outputTableName ?? "",
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    setLabel(node.data.label);
    setConfig(node.data.config);
    setOutputTableName(node.data.outputTableName ?? "");
  }, [node.id, node.data.label, node.data.config, node.data.outputTableName]);

  const color = STAGE_COLORS[node.data.stageType];

  const isDirty = useMemo(() => {
    if (label !== node.data.label) return true;
    const cleanOutput = outputTableName || undefined;
    if (cleanOutput !== node.data.outputTableName) return true;
    // Config is a small POJO union — JSON-string compare is fine.
    if (JSON.stringify(config) !== JSON.stringify(node.data.config)) return true;
    return false;
  }, [
    label,
    outputTableName,
    config,
    node.data.label,
    node.data.outputTableName,
    node.data.config,
  ]);

  const handleSave = () => {
    if (isDirty) {
      onUpdate(node.id, {
        label,
        config,
        outputTableName: outputTableName || undefined,
      });
    }
    onCancel?.();
  };

  const requestDelete = () => {
    if (!confirmBeforeDelete) {
      onDelete(node.id);
      return;
    }
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    setDeleteDialogOpen(false);
    onDelete(node.id);
  };

  return (
    <div className="grid h-full min-h-0 w-full flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: color }}
          >
            {STAGE_LABELS[node.data.stageType]}
          </span>
          <span className="text-xs text-gray-500">#{node.data.stageIndex}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={requestDelete}
          aria-label="Delete stage"
        >
          <Trash2 className="h-4 w-4 text-gray-500" />
        </Button>
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
        <div className="space-y-4">
          <Field label="Display label">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Filter US customers"
            />
          </Field>

          <Field label="Output table name">
            <Input
              value={outputTableName}
              onChange={(e) => setOutputTableName(e.target.value)}
              placeholder="auto-generated if blank"
            />
          </Field>

          <div className="border-t border-gray-200 pt-4">
            <ConfigFields config={config} onChange={setConfig} />
          </div>
        </div>
      </div>

      <footer className="space-y-2 border-t border-gray-200 bg-white p-3">
        {isDirty && (
          <span aria-live="polite" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </span>
        )}
        <div
          className={
            onCancel ? "grid w-full grid-cols-2 gap-2" : "grid w-full grid-cols-1"
          }
        >
          {onCancel ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="w-full justify-center"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                className="w-full justify-center gap-1.5"
              >
                <Save className="h-3.5 w-3.5 shrink-0" />
                Save
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty}
              className="w-full justify-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5 shrink-0" />
              Save
            </Button>
          )}
        </div>
      </footer>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this stage?</DialogTitle>
            <DialogDescription>
              This removes{" "}
              <span className="font-medium text-gray-700">{node.data.label}</span>
              {" "}
              and its connections from the canvas. This cannot be undone here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid w-full grid-cols-2 gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full justify-center"
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

interface ConfigFieldsProps {
  config: StageConfig;
  onChange: (next: StageConfig) => void;
}

function ConfigFields({ config, onChange }: ConfigFieldsProps) {
  switch (config.stageType) {
    case "LOAD":
      return (
        <div className="space-y-3">
          <Field label="Table name">
            <Input
              value={config.tableName}
              onChange={(e) => onChange({ ...config, tableName: e.target.value })}
            />
          </Field>
          <Field label="Source (path or URI)">
            <Input
              value={config.source ?? ""}
              onChange={(e) => onChange({ ...config, source: e.target.value })}
              placeholder="e.g. customers.csv"
            />
          </Field>
        </div>
      );

    case "FILTER":
      return (
        <div className="space-y-3">
          <Field label="Source table">
            <Input
              value={config.table}
              onChange={(e) => onChange({ ...config, table: e.target.value })}
            />
          </Field>
          <Field label="Column">
            <Input
              value={config.column}
              onChange={(e) => onChange({ ...config, column: e.target.value })}
            />
          </Field>
          <Field label="Operator">
            <Select
              value={config.operator}
              onValueChange={(v) =>
                onChange({ ...config, operator: v as FilterOperator })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN"] as const).map(
                  (op) => (
                    <SelectItem key={op} value={op}>
                      {op}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Value">
            <Input
              value={config.value}
              onChange={(e) => onChange({ ...config, value: e.target.value })}
            />
          </Field>
        </div>
      );

    case "JOIN":
      return (
        <div className="space-y-3">
          <Field label="Join type">
            <Select
              value={config.joinType}
              onValueChange={(v) =>
                onChange({ ...config, joinType: v as JoinType })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["INNER", "LEFT", "RIGHT", "FULL OUTER"] as const).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Left table">
              <Input
                value={config.leftTable}
                onChange={(e) =>
                  onChange({ ...config, leftTable: e.target.value })
                }
              />
            </Field>
            <Field label="Left key">
              <Input
                value={config.leftKey}
                onChange={(e) =>
                  onChange({ ...config, leftKey: e.target.value })
                }
              />
            </Field>
            <Field label="Right table">
              <Input
                value={config.rightTable}
                onChange={(e) =>
                  onChange({ ...config, rightTable: e.target.value })
                }
              />
            </Field>
            <Field label="Right key">
              <Input
                value={config.rightKey}
                onChange={(e) =>
                  onChange({ ...config, rightKey: e.target.value })
                }
              />
            </Field>
          </div>
        </div>
      );

    case "UNION":
      return (
        <div className="space-y-3">
          <Field label="Tables (comma-separated)">
            <Input
              value={config.tables.join(", ")}
              onChange={(e) =>
                onChange({
                  ...config,
                  tables: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={config.unionAll}
              onChange={(e) =>
                onChange({ ...config, unionAll: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300"
            />
            UNION ALL (keep duplicates)
          </label>
        </div>
      );

    case "GROUP":
      return (
        <div className="space-y-3">
          <Field label="Source table">
            <Input
              value={config.table}
              onChange={(e) => onChange({ ...config, table: e.target.value })}
            />
          </Field>
          <Field label="Group by columns (comma-separated)">
            <Input
              value={config.groupBy.join(", ")}
              onChange={(e) =>
                onChange({
                  ...config,
                  groupBy: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Aggregations (e.g. SUM:amount:total)">
            <Input
              value={config.aggregations
                .map((a) => `${a.fn}:${a.column}:${a.alias}`)
                .join(", ")}
              onChange={(e) =>
                onChange({
                  ...config,
                  aggregations: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((s) => {
                      const [fn, column, alias] = s.split(":");
                      return {
                        fn: (fn ?? "COUNT") as
                          | "COUNT"
                          | "SUM"
                          | "AVG"
                          | "MIN"
                          | "MAX",
                        column: column ?? "",
                        alias: alias ?? column ?? "",
                      };
                    }),
                })
              }
              placeholder="COUNT:*:n, SUM:amount:total"
            />
          </Field>
        </div>
      );

    case "SORT":
      return (
        <div className="space-y-3">
          <Field label="Source table">
            <Input
              value={config.table}
              onChange={(e) => onChange({ ...config, table: e.target.value })}
            />
          </Field>
          <Field label="Sort column">
            <Input
              value={config.orderBy[0]?.column ?? ""}
              onChange={(e) =>
                onChange({
                  ...config,
                  orderBy: [
                    {
                      column: e.target.value,
                      direction: config.orderBy[0]?.direction ?? "ASC",
                    },
                  ],
                })
              }
            />
          </Field>
          <Field label="Direction">
            <Select
              value={config.orderBy[0]?.direction ?? "ASC"}
              onValueChange={(v) =>
                onChange({
                  ...config,
                  orderBy: [
                    {
                      column: config.orderBy[0]?.column ?? "",
                      direction: v as SortDirection,
                    },
                  ],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ASC">ASC</SelectItem>
                <SelectItem value="DESC">DESC</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      );

    case "SELECT":
      return (
        <div className="space-y-3">
          <Field label="Source table">
            <Input
              value={config.table}
              onChange={(e) => onChange({ ...config, table: e.target.value })}
            />
          </Field>
          <Field label="Columns (comma-separated)">
            <Input
              value={config.columns.join(", ")}
              onChange={(e) =>
                onChange({
                  ...config,
                  columns: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        </div>
      );

    case "CUSTOM":
      return (
        <Field label="SQL">
          <textarea
            value={config.sql}
            onChange={(e) => onChange({ ...config, sql: e.target.value })}
            rows={8}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            placeholder="SELECT * FROM ..."
          />
        </Field>
      );
  }
}
