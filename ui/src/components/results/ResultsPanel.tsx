import { useEffect, useMemo, useRef, useState } from "react";
import { Database, ListTree, RefreshCw } from "lucide-react";
import { JsonView } from "@/components/views/JsonView";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { MFLIX_COLLECTIONS } from "@/samples/mflixCollections";
import { useDragResize } from "@/hooks/useDragResize";
import { cn } from "@/lib/Utils";
import DocumentsTreeView from "./DocumentsTreeView";
import type { PipelineSchema } from "@/Schema";
import type { MflixCollectionsMessage, ResultsMessage } from "@/types/ws";

interface ResultsPanelProps {
  schema: PipelineSchema | null;
  results: ResultsMessage[];
  showSchemaJson: boolean;
  /** When true, show a "Mflix collections" reference tab listing the sample_mflix collections. */
  showMflixCollections: boolean;
  /** Most-recent live refresh from Atlas (overrides the static catalog); null until requested. */
  mflixRefresh?: MflixCollectionsMessage | null;
  /** Refresh request is in flight. */
  mflixRefreshing?: boolean;
  /** Fire a refresh from the live Atlas connection. The button is disabled if Atlas isn't connected. */
  onRefreshMflix?: () => void;
  /** Used to enable/disable the refresh button. */
  atlasConnected?: boolean;
  /** Optional controlled active tab id. When provided, the parent decides
   *  which tab is shown — used by the canvas's "view output" links so a click
   *  on a stage node can switch the result panel to that stage's tab. */
  activeTab?: string | null;
  onActiveTabChange?: (tabId: string) => void;
  /** Orientation for the document table / JSON pane split inside each tab.
   *  `horizontal` (default) = table left, JSON right.
   *  `vertical`             = table top, JSON bottom. */
  splitOrientation?: "horizontal" | "vertical";
}

const SCHEMA_TAB_ID = "__schema__";
const MFLIX_TAB_ID = "__mflix__";

const SPLIT_DEFAULT = 50;
const SPLIT_MIN = 20;
const SPLIT_MAX = 80;

export default function ResultsPanel({
  schema,
  results,
  showSchemaJson,
  showMflixCollections,
  mflixRefresh,
  mflixRefreshing,
  onRefreshMflix,
  atlasConnected,
  activeTab,
  onActiveTabChange,
  splitOrientation = "horizontal",
}: ResultsPanelProps) {
  // Tabs are sourced from the canvas (one per stage), so every node's
  // "view output" link always has a tab to land on, regardless of whether
  // real results have arrived yet. The label uses `stage.output` (the same
  // string the node renders as its link) so the canvas and the tab strip
  // stay consistent.
  //
  // A `ResultsMessage` for a given stageId overlays its rows on top of the
  // placeholder; if a results message arrives for a stage no longer on the
  // canvas (e.g. agent removed it), we surface that one too rather than
  // dropping it.
  const tabs = useMemo(() => {
    // Defensive coercion — the agent occasionally ships non-string values
    // where strings are required, which crashes React when we try to render
    // them as tab labels.
    const str = (v: unknown, fallback: string): string =>
      typeof v === "string" && v.trim() ? v : fallback;
    const resultsById = new Map(results.map((r) => [r.stageId, r] as const));
    const stageIds = new Set<string>();
    const fromStages = (schema?.stages ?? []).map((s, i) => {
      const id = str(s.id, `stage_${i + 1}`);
      stageIds.add(id);
      const r = resultsById.get(id);
      return {
        id,
        label: str(s.output, str(s.name, id)),
        rows: r?.rows ?? null,
        placeholder: !r,
      };
    });
    const orphans = results
      .filter((r) => !stageIds.has(r.stageId))
      .map((r) => ({
        id: r.stageId,
        label: str(r.label, r.stageId),
        rows: r.rows,
        placeholder: false,
      }));
    return [...fromStages, ...orphans];
  }, [schema, results]);

  // Prefer the most recently arrived real result, so the user lands on the
  // stage they just executed. Otherwise fall back to the leftmost tab: Mflix
  // collections (if shown) → first stage tab → Pipeline schema.
  const defaultTab = useMemo(() => {
    if (results.length > 0) return results[results.length - 1].stageId;
    if (showMflixCollections) return MFLIX_TAB_ID;
    if (tabs.length > 0) return tabs[0].id;
    if (showSchemaJson) return SCHEMA_TAB_ID;
    return MFLIX_TAB_ID;
  }, [results, tabs, showMflixCollections, showSchemaJson]);

  // Internal state is a fallback for when the host doesn't pass `activeTab`.
  // When `activeTab` IS passed we still keep this in sync so onValueChange
  // from user clicks updates the host on the same tick.
  const [internalActive, setInternalActive] = useState<string>(defaultTab);
  const active = activeTab ?? internalActive;

  const handleChange = (next: string) => {
    setInternalActive(next);
    onActiveTabChange?.(next);
  };

  const effectiveActive = useMemo(() => {
    const stillValid =
      tabs.some((t) => t.id === active) ||
      (active === SCHEMA_TAB_ID && showSchemaJson) ||
      (active === MFLIX_TAB_ID && showMflixCollections);
    return stillValid ? active : defaultTab;
  }, [active, tabs, showSchemaJson, showMflixCollections, defaultTab]);

  return (
    <Tabs
      value={effectiveActive}
      onValueChange={handleChange}
      className="flex h-full flex-col bg-white"
    >
      <TabsList className="shrink-0">
        {showMflixCollections && (
          <TabsTrigger value={MFLIX_TAB_ID}>
            <Database className="mr-1 inline h-3 w-3" />
            Mflix collections
            <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-700">
              {MFLIX_COLLECTIONS.length}
            </span>
          </TabsTrigger>
        )}
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
            <span
              className={
                t.placeholder
                  ? "ml-1 rounded bg-slate-50 px-1 py-0.5 text-[10px] italic text-slate-400"
                  : "ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500"
              }
            >
              {t.placeholder ? "—" : t.rows?.length ?? 0}
            </span>
          </TabsTrigger>
        ))}
        {showSchemaJson && (
          <TabsTrigger value={SCHEMA_TAB_ID}>
            <ListTree className="mr-1 inline h-3 w-3" />
            Pipeline schema
          </TabsTrigger>
        )}
        {tabs.length === 0 && !showSchemaJson && !showMflixCollections && (
          <span className="ml-2 self-center text-[11px] italic text-slate-400">
            No results yet — ask the agent to find something.
          </span>
        )}
      </TabsList>

      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="min-h-0">
          {t.placeholder ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs italic text-slate-400">
              Waiting for results — this tab will populate once the agent runs
              the <span className="not-italic font-mono text-slate-500">{t.label}</span> stage.
            </div>
          ) : (
            <DocumentsSplitView
              rows={t.rows ?? []}
              label={t.label}
              orientation={splitOrientation}
            />
          )}
        </TabsContent>
      ))}

      {showMflixCollections && (
        <TabsContent value={MFLIX_TAB_ID} className="min-h-0">
          <MflixCollectionsView
            refresh={mflixRefresh ?? null}
            refreshing={!!mflixRefreshing}
            onRefresh={onRefreshMflix}
            atlasConnected={!!atlasConnected}
            orientation={splitOrientation}
          />
        </TabsContent>
      )}

      {showSchemaJson && (
        <TabsContent value={SCHEMA_TAB_ID} className="min-h-0">
          {schema ? (
            <JsonView
              data={schema}
              title={schema.pipeline.name || "pipeline"}
              info={
                <>
                  {schema.stages.length} stages
                  {" · "}
                  {Object.keys(schema.datasets).length} datasets
                </>
              }
              downloadName={`${schema.pipeline.name || "pipeline"}-schema`}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs italic text-slate-400">
              Pipeline schema will appear here once the agent builds the first stage.
            </div>
          )}
        </TabsContent>
      )}
    </Tabs>
  );
}

/**
 * Document table + JSON pane with a draggable border. Orientation switches
 * between left/right (`horizontal`) and top/bottom (`vertical`) — used by
 * the two main layouts: stacked (canvas-on-top) keeps documents left+right;
 * side-by-side (canvas-on-left) flips them to top+bottom so each occupies
 * half of the right-hand column.
 *
 * Clicking a row in the table focuses its document in the JSON pane;
 * clicking the same row again deselects.
 */
function DocumentsSplitView({
  rows,
  label,
  orientation = "horizontal",
}: {
  rows: unknown[];
  label: string;
  orientation?: "horizontal" | "vertical";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Reset selection when the underlying rows change (new query results land).
  useEffect(() => {
    setSelectedIndex(null);
  }, [rows]);

  const split = useDragResize<number>(
    SPLIT_DEFAULT,
    orientation === "horizontal" ? "x" : "y",
    (e) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return SPLIT_DEFAULT;
      const pct =
        orientation === "horizontal"
          ? ((e.clientX - rect.left) / rect.width) * 100
          : ((e.clientY - rect.top) / rect.height) * 100;
      return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct));
    },
  );

  const focused = selectedIndex !== null ? rows[selectedIndex] : null;
  const jsonData = focused ?? rows;
  const jsonTitle =
    focused != null ? `${label} · doc #${selectedIndex}` : `${label}`;
  const jsonInfo =
    focused != null ? (
      <button
        type="button"
        onClick={() => setSelectedIndex(null)}
        className="text-blue-600 underline-offset-2 hover:underline"
      >
        ← back to all {rows.length} rows
      </button>
    ) : (
      `${rows.length} document${rows.length === 1 ? "" : "s"}`
    );

  const isHorizontal = orientation === "horizontal";
  const firstSize: React.CSSProperties = isHorizontal
    ? { width: `${split.value}%` }
    : { height: `${split.value}%` };
  const secondSize: React.CSSProperties = isHorizontal
    ? { width: `${100 - split.value}%` }
    : { height: `${100 - split.value}%` };

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full min-h-0 min-w-0",
        isHorizontal ? "flex-row" : "flex-col",
      )}
    >
      <div
        className="flex min-h-0 min-w-0 flex-col"
        style={firstSize}
      >
        <DocumentsTreeView
          rows={rows}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
        />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={split.onMouseDown}
        className={cn(
          "shrink-0 bg-slate-200 transition-colors hover:bg-blue-400",
          isHorizontal
            ? "w-1 cursor-col-resize"
            : "h-1 cursor-row-resize",
        )}
        title="Drag to resize"
      />

      <div
        className="flex min-h-0 min-w-0 flex-col"
        style={secondSize}
      >
        <JsonView
          data={jsonData}
          title={jsonTitle}
          info={jsonInfo}
          downloadName={focused != null ? `${label}-doc-${selectedIndex}` : label}
          emptyHint="No documents."
        />
      </div>
    </div>
  );
}

/**
 * Reference view: list of `sample_mflix` collections on the left, example
 * document (with shape and types) for the selected collection on the right.
 *
 * Two sources of truth: a static fallback catalog (`MFLIX_COLLECTIONS`) that
 * always renders, and an optional `refresh` payload from a live Atlas query.
 * When `refresh` is present we merge: live counts and example docs override
 * the static values for matching collection names; collections that exist
 * only live (e.g. user has extras) are appended; descriptions stay from the
 * static catalog so the panel always has narrative copy.
 */
function MflixCollectionsView({
  refresh,
  refreshing,
  onRefresh,
  atlasConnected,
  orientation = "horizontal",
}: {
  refresh: MflixCollectionsMessage | null;
  refreshing: boolean;
  onRefresh?: () => void;
  atlasConnected: boolean;
  orientation?: "horizontal" | "vertical";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const split = useDragResize<number>(
    SPLIT_DEFAULT,
    orientation === "horizontal" ? "x" : "y",
    (e) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return SPLIT_DEFAULT;
      const pct =
        orientation === "horizontal"
          ? ((e.clientX - rect.left) / rect.width) * 100
          : ((e.clientY - rect.top) / rect.height) * 100;
      return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct));
    },
  );

  // Build the merged list each render. Cheap (<10 entries) so no memo needed.
  const items = useMemo(() => {
    const liveByName = new Map(
      (refresh?.collections ?? []).map((c) => [c.name, c] as const),
    );
    const merged: Array<{
      name: string;
      estimatedCount: number;
      description: string;
      exampleDocument: unknown;
      origin: "static" | "live" | "merged";
      error?: string;
    }> = [];
    const staticByName = new Map(
      MFLIX_COLLECTIONS.map((c) => [c.name, c] as const),
    );

    for (const s of MFLIX_COLLECTIONS) {
      const live = liveByName.get(s.name);
      merged.push({
        name: s.name,
        estimatedCount: live?.estimatedCount ?? s.estimatedCount,
        description: s.description,
        exampleDocument: live?.exampleDocument ?? s.exampleDocument,
        origin: live ? "merged" : "static",
        error: live?.error,
      });
    }
    // Surface live collections that aren't in the static catalog.
    if (refresh) {
      for (const live of refresh.collections) {
        if (staticByName.has(live.name)) continue;
        merged.push({
          name: live.name,
          estimatedCount: live.estimatedCount ?? 0,
          description: "Not in the static catalog — pulled from this Atlas cluster.",
          exampleDocument: live.exampleDocument ?? null,
          origin: "live",
          error: live.error,
        });
      }
    }
    return merged;
  }, [refresh]);

  const safeIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));
  const selected = items[safeIndex];

  const refreshDisabled = !atlasConnected || refreshing || !onRefresh;
  const refreshTitle = !atlasConnected
    ? "Connect to MongoDB Atlas first."
    : refreshing
      ? "Refreshing…"
      : "Re-fetch collections from Atlas (list-collections + count + find)";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {refresh?.database ?? "sample_mflix"} · {items.length} collections
          {refresh?.error && (
            <span className="ml-2 normal-case text-[11px] text-amber-700">
              · refresh failed
            </span>
          )}
          {!refresh && (
            <span className="ml-2 normal-case text-[11px] italic text-slate-400">
              · static catalog
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshDisabled}
          title={refreshTitle}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium",
            refreshDisabled
              ? "text-slate-400"
              : "text-blue-700 hover:bg-blue-50",
          )}
        >
          <RefreshCw
            className={cn("h-3 w-3", refreshing && "animate-spin")}
          />
          {refreshing ? "Refreshing…" : "Refresh from Atlas"}
        </button>
      </div>

      {refresh?.error && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          {refresh.error}
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          "flex min-h-0 flex-1 min-w-0",
          orientation === "horizontal" ? "flex-row" : "flex-col",
        )}
      >
        <div
          className="flex min-h-0 min-w-0 flex-col bg-white"
          style={
            orientation === "horizontal"
              ? { width: `${split.value}%` }
              : { height: `${split.value}%` }
          }
        >
          <ul className="min-h-0 flex-1 overflow-auto">
            {items.map((c, i) => {
              const isActive = i === safeIndex;
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(i)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-3 py-2 text-left transition-colors hover:bg-slate-50",
                      isActive && "bg-blue-50/70 hover:bg-blue-50",
                    )}
                  >
                    <div className="flex w-full items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "font-mono text-[12px] font-semibold",
                          isActive ? "text-blue-700" : "text-slate-800",
                        )}
                      >
                        {c.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 py-0.5 font-mono text-[10px]",
                          c.origin === "static"
                            ? "bg-slate-100 text-slate-500"
                            : "bg-emerald-50 text-emerald-700",
                        )}
                        title={
                          c.origin === "static"
                            ? "Static count — refresh to get the live number."
                            : "Live count from Atlas."
                        }
                      >
                        {c.origin === "static" ? "~" : ""}
                        {c.estimatedCount.toLocaleString()}
                      </span>
                    </div>
                    <span className="text-[11px] leading-snug text-slate-500">
                      {c.description}
                    </span>
                    {c.error && (
                      <span className="text-[10px] text-amber-700">
                        {c.error}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={split.onMouseDown}
          className={cn(
            "shrink-0 bg-slate-200 transition-colors hover:bg-blue-400",
            orientation === "horizontal"
              ? "w-1 cursor-col-resize"
              : "h-1 cursor-row-resize",
          )}
          title="Drag to resize"
        />

        <div
          className="flex min-h-0 min-w-0 flex-col"
          style={
            orientation === "horizontal"
              ? { width: `${100 - split.value}%` }
              : { height: `${100 - split.value}%` }
          }
        >
          {selected ? (
            <JsonView
              data={selected.exampleDocument}
              title={`${refresh?.database ?? "sample_mflix"}.${selected.name}`}
              info={
                <>
                  example document ·{" "}
                  {selected.origin === "static" ? "~" : ""}
                  {selected.estimatedCount.toLocaleString()} total
                </>
              }
              downloadName={`mflix-${selected.name}-example`}
              emptyHint="No example available."
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs italic text-slate-400">
              No collections found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
