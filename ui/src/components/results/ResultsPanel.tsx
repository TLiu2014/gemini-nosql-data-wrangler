import { useMemo, useState } from "react";
import { JsonView } from "@/components/views/JsonView";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { SAMPLE_MFLIX_EMBEDDED_MOVIES } from "@/samples/sampleData";
import DocumentsTable from "./DocumentsTable";
import type { PipelineSchema } from "@/Schema";
import type { ResultsMessage } from "@/types/ws";

interface ResultsPanelProps {
  schema: PipelineSchema | null;
  results: ResultsMessage[];
  showSchemaJson: boolean;
  /** When true, show a "Sample data" tab seeded from sample_mflix.embedded_movies. */
  showSampleData: boolean;
}

const SAMPLE_TAB_ID = "__sample__";
const SCHEMA_TAB_ID = "__schema__";

export default function ResultsPanel({
  schema,
  results,
  showSchemaJson,
  showSampleData,
}: ResultsPanelProps) {
  const tabs = useMemo(() => {
    return results.map((r) => ({
      id: r.stageId,
      label: r.label ?? r.stageId,
      rows: r.rows,
    }));
  }, [results]);

  // Default to: latest result if any, else sample data, else schema.
  const defaultTab =
    tabs.length > 0
      ? tabs[tabs.length - 1].id
      : showSampleData
        ? SAMPLE_TAB_ID
        : showSchemaJson
          ? SCHEMA_TAB_ID
          : tabs[0]?.id ?? (showSampleData ? SAMPLE_TAB_ID : SCHEMA_TAB_ID);

  const [active, setActive] = useState<string>(defaultTab);

  // If the tab we'd default to has appeared / disappeared, follow it.
  const effectiveActive = useMemo(() => {
    const stillValid =
      tabs.some((t) => t.id === active) ||
      (active === SCHEMA_TAB_ID && showSchemaJson) ||
      (active === SAMPLE_TAB_ID && showSampleData);
    return stillValid ? active : defaultTab;
  }, [active, tabs, showSchemaJson, showSampleData, defaultTab]);

  return (
    <Tabs
      value={effectiveActive}
      onValueChange={setActive}
      className="flex h-full flex-col bg-white"
    >
      <TabsList className="shrink-0">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
            <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">
              {t.rows.length}
            </span>
          </TabsTrigger>
        ))}
        {showSampleData && (
          <TabsTrigger value={SAMPLE_TAB_ID}>
            Sample data
            <span className="ml-1 rounded bg-emerald-50 px-1 py-0.5 text-[10px] text-emerald-700">
              {SAMPLE_MFLIX_EMBEDDED_MOVIES.length}
            </span>
          </TabsTrigger>
        )}
        {showSchemaJson && (
          <TabsTrigger value={SCHEMA_TAB_ID}>Pipeline schema</TabsTrigger>
        )}
        {tabs.length === 0 && !showSampleData && !showSchemaJson && (
          <span className="ml-2 self-center text-[11px] italic text-slate-400">
            No results yet — ask the agent to find something.
          </span>
        )}
      </TabsList>

      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="min-h-0">
          <DocumentsTable rows={t.rows} />
        </TabsContent>
      ))}

      {showSampleData && (
        <TabsContent value={SAMPLE_TAB_ID} className="min-h-0">
          <DocumentsTable rows={SAMPLE_MFLIX_EMBEDDED_MOVIES} />
        </TabsContent>
      )}

      {showSchemaJson && (
        <TabsContent value={SCHEMA_TAB_ID} className="min-h-0">
          {schema ? (
            <JsonView schema={schema} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              Pipeline schema will appear here once the agent builds the first stage.
            </div>
          )}
        </TabsContent>
      )}
    </Tabs>
  );
}
