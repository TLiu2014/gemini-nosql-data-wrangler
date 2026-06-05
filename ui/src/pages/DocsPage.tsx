import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Book,
  Database,
  ExternalLink,
  Moon,
  Network,
  Server,
  Sparkles,
  Sun,
  Terminal,
  Wrench,
} from "lucide-react";

type Theme = "light" | "dark";

// Share the landing page's storage key so toggling the theme in one place
// follows the user across both routes. Same default + OS-pref fallback too.
const THEME_STORAGE_KEY = "gemini-data-wrangler:landing-theme";

function loadInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

/**
 * Public-facing docs page at `/docs`. Documents the agent's tool surface —
 * the four custom tools we built (`update_canvas`, `push_results`,
 * `run_pipeline`, `suggest_next_prompts`) plus the MongoDB MCP tools the
 * agent inherits. Theme + header chrome match the landing page so the two
 * pages feel like one site.
 */
export default function DocsPage() {
  const [theme, setTheme] = useState<Theme>(loadInitialTheme);
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const dark = theme === "dark";
  const t = useMemo(() => themeTokens(dark), [dark]);

  return (
    <div className={`min-h-screen w-full ${t.page}`}>
      {/* Top nav — matches the landing page header exactly so the two
          routes read as one site. */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-400" />
          <span className="text-sm font-semibold tracking-tight">
            Gemini NoSQL Data Wrangler
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(dark ? "light" : "dark")}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${t.button}`}
            title={dark ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link
            to="/"
            className={`hidden rounded-md border px-3 py-1.5 text-sm font-medium transition-colors sm:inline-flex ${t.button}`}
          >
            Home
          </Link>
          <Link
            to="/app"
            className="rounded-md bg-gradient-to-r from-violet-600 to-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition-transform hover:scale-[1.02]"
          >
            Launch
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-6 pb-14 pt-10">
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 -z-0 blur-3xl ${t.heroGradient}`}
        />
        <div className="relative z-10 max-w-3xl">
          <div
            className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${t.chip}`}
          >
            <Book className="h-3 w-3" />
            Tool reference · v0.1
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Agent &amp; Tool Reference
          </h1>
          <p
            className={`mt-5 max-w-2xl text-base leading-relaxed sm:text-lg ${t.subtle}`}
          >
            The agent runs an explicit ReAct loop in the backend, with four
            custom tools that drive the UI and the standard MongoDB MCP
            tools that drive the database. This page documents every tool
            with example calls so you can extend the agent or wire your own
            client into the same WebSocket protocol.
          </p>
        </div>
      </section>

      {/* Architecture mini-overview */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div
          className={`text-xs font-semibold uppercase tracking-wider ${t.eyebrow}`}
        >
          How it fits together
        </div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          One WebSocket. One agent. Two tool families.
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <ArchCard
            t={t}
            dark={dark}
            icon={<Terminal className="h-5 w-5" />}
            title="Client"
            body="The browser holds a single long-lived WebSocket. It sends `user.text` / `user.audio` messages and receives `canvas.update`, `results`, and `trace` events that drive the UI."
          />
          <ArchCard
            t={t}
            dark={dark}
            icon={<Sparkles className="h-5 w-5" />}
            title="Agent (Gemini)"
            body="A `chats.create` ReAct loop. Each user turn fans out into tool calls until the model stops asking for tools, then emits a final text reply."
          />
          <ArchCard
            t={t}
            dark={dark}
            icon={<Database className="h-5 w-5" />}
            title="MongoDB MCP"
            body="A standard MCP server spawned per session. Exposes `aggregate`, `find`, `count`, `collection-schema`, `list-collections`, `list-databases`."
          />
        </div>
      </section>

      {/* Table of contents */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <nav
          className={`rounded-lg border p-5 ${t.card}`}
          aria-label="Table of contents"
        >
          <div
            className={`mb-3 text-xs font-semibold uppercase tracking-wider ${t.eyebrow}`}
          >
            On this page
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            <TocLink t={t} href="#custom-tools" label="Custom tools" sub="UI + execution helpers" />
            <TocLink t={t} href="#mcp-tools" label="MongoDB MCP tools" sub="Database operations" />
            <TocLink t={t} href="#ws-events" label="WebSocket events" sub="Server → client traces" />
          </div>
        </nav>
      </section>

      {/* Custom tools */}
      <section id="custom-tools" className="mx-auto max-w-6xl px-6 pb-16 scroll-mt-20">
        <SectionHeading
          t={t}
          icon={<Wrench className="h-5 w-5" />}
          eyebrow="Custom tools"
          title="The four tools we built."
          body="Custom tools live in the backend and dispatch directly to the WebSocket client. They never touch the database — they update the canvas, populate results, or hint at follow-ups."
        />
        <div className="mt-8 space-y-6">
          <ToolDoc
            t={t}
            name="update_canvas"
            kind="custom"
            description="Replace the pipeline shown on the read-only React Flow canvas with the supplied PipelineSchema. Always cumulative — every call must include every stage already on the canvas plus any new ones."
            params={[
              {
                name: "schema",
                type: "object",
                required: true,
                doc: "Full PipelineSchema: { version, pipeline, datasets, stages[], layout }. Stages carry MongoDB stage types (MQL_SOURCE, MQL_MATCH, MQL_VECTOR_SEARCH, MQL_PROJECT, MQL_SORT, MQL_LIMIT, MQL_GROUP, MQL_LOOKUP, MQL_UNWIND).",
              },
            ]}
            example={`update_canvas({
  schema: {
    version: "1.0",
    pipeline: { name: "nolan_films", createdAt: "2026-06-05T…" },
    datasets: {},
    stages: [
      {
        id: "stage_1",
        name: "source",
        type: "MQL_SOURCE",
        depends_on: [],
        inputs: ["sample_mflix.movies"],
        output: "movies",
        operation: { stageType: "MQL_SOURCE", database: "sample_mflix", collection: "movies" }
      },
      {
        id: "stage_2",
        name: "filter_director",
        type: "MQL_MATCH",
        depends_on: ["stage_1"],
        inputs: [],
        output: "nolan_movies",
        operation: { stageType: "MQL_MATCH", body: { directors: "Christopher Nolan" } }
      }
    ],
    layout: { nodes: [], edges: [] }   // server recomputes
  }
})`}
            response="{ ok: true }"
          />

          <ToolDoc
            t={t}
            name="run_pipeline"
            kind="custom"
            featured
            description="Execute the canvas pipeline against MongoDB and populate every stage's results tab in a single round-trip. Internally wraps the pipeline in $facet so every stage prefix runs against the full collection — the preview_limit only caps what the UI shows, not what the math sees."
            params={[
              { name: "database", type: "string", required: true, doc: "Database name (e.g. \"sample_mflix\")." },
              { name: "collection", type: "string", required: true, doc: "Source collection name. The pipeline is applied to this collection." },
              { name: "pipeline", type: "object[]", required: true, doc: "MongoDB aggregation stages AFTER the source ($match, $group, …)." },
              { name: "stage_ids", type: "string[]", required: true, doc: "Canvas stage ids, in order. Length must equal pipeline.length + 1. Index 0 = source." },
              { name: "preview_limit", type: "number", required: false, doc: "Rows shown per stage tab. Default 20." },
            ]}
            example={`run_pipeline({
  database: "sample_mflix",
  collection: "movies",
  pipeline: [
    { $match: { directors: "Christopher Nolan" } },
    { $group: {
        _id: "$year",
        avgRating: { $avg: "$imdb.rating" },
        totalAwards: { $sum: "$awards.wins" }
    } }
  ],
  stage_ids: ["stage_1", "stage_2", "stage_3"],
  preview_limit: 20
})`}
            response={`{
  ok: true,
  execution_mode: "facet",        // or "sequential_fallback" if $facet failed
  previewed: [
    { stageId: "stage_1", rows: 20 },
    { stageId: "stage_2", rows: 20 },
    { stageId: "stage_3", rows: 17 }
  ],
  final_stage_id: "stage_3",
  final_row_count: 17,
  final_rows_sample: [ /* first 5 rows for the agent to summarize */ ]
}`}
          />

          <ToolDoc
            t={t}
            name="push_results"
            kind="custom"
            description="Manually populate one stage's results tab with rows you already have. Used for ad-hoc cases — e.g. piping a one-off `find` result into a canvas stage that isn't part of a `run_pipeline` flow."
            params={[
              { name: "stageId", type: "string", required: true, doc: "Stage id from the most recent update_canvas call." },
              { name: "rows", type: "object[]", required: true, doc: "Rows returned by MongoDB. Pass them through as-is." },
              { name: "label", type: "string", required: false, doc: "Optional tab label. Defaults to the stage id." },
            ]}
            example={`push_results({
  stageId: "stage_1",
  label: "movies",
  rows: [
    { _id: "…", title: "Inception", year: 2010, … },
    { _id: "…", title: "Interstellar", year: 2014, … }
  ]
})`}
            response="{ ok: true, count: 2 }"
          />

          <ToolDoc
            t={t}
            name="suggest_next_prompts"
            kind="custom"
            description="Suggest 2–3 short follow-up requests the user might make next, given the current canvas state. The UI renders them as clickable chips below the agent's reply; clicking a chip fills the composer (it does not auto-send). Only registered when the user has the “Suggest follow-up prompts” setting enabled."
            params={[
              {
                name: "prompts",
                type: "Array<{label, prompt}>",
                required: true,
                doc: "2–3 entries. `label` is a 1–4 word chip caption; `prompt` is the actual full sentence the user would send if they click the chip.",
              },
            ]}
            example={`suggest_next_prompts({
  prompts: [
    { label: "Group by year",
      prompt: "Group these movies by year and calculate the average IMDB rating." },
    { label: "Sort by rating",
      prompt: "Now sort the results by average rating, highest first." },
    { label: "Filter recent",
      prompt: "Limit to movies released after the year 2000." }
  ]
})`}
            response="{ ok: true, count: 3 }"
          />
        </div>
      </section>

      {/* MCP tools */}
      <section id="mcp-tools" className="mx-auto max-w-6xl px-6 pb-16 scroll-mt-20">
        <SectionHeading
          t={t}
          icon={<Database className="h-5 w-5" />}
          eyebrow="MongoDB MCP tools"
          title="Standard MCP surface, exposed unchanged."
          body={
            <>
              These tools come from <code className={`rounded ${t.codeInline} px-1.5`}>mongodb-mcp-server</code> — the
              agent calls them the same way any MCP client would. Schemas are
              auto-discovered at session start and sanitized for Gemini's
              function-declaration format. The agent prefers <code className={`rounded ${t.codeInline} px-1.5`}>run_pipeline</code> for
              canvas-driven flows; <code className={`rounded ${t.codeInline} px-1.5`}>aggregate</code> stays available for ad-hoc
              inspection.
            </>
          }
        />
        <div className="mt-8 space-y-6">
          <ToolDoc
            t={t}
            name="aggregate"
            kind="mcp"
            description="Run a MongoDB aggregation pipeline and return the matching documents. Use this for ad-hoc one-off queries; for canvas pipelines use run_pipeline so all stage tabs populate."
            params={[
              { name: "database", type: "string", required: true, doc: "Database name." },
              { name: "collection", type: "string", required: true, doc: "Collection name." },
              { name: "pipeline", type: "object[]", required: true, doc: "Aggregation stages." },
            ]}
            example={`aggregate({
  database: "sample_mflix",
  collection: "movies",
  pipeline: [
    { $match: { directors: "Christopher Nolan" } },
    { $project: { title: 1, year: 1, _id: 0 } },
    { $limit: 5 }
  ]
})`}
            response="MCP text content with the matching docs concatenated as JSON."
          />

          <ToolDoc
            t={t}
            name="find"
            kind="mcp"
            description="Query a single collection with a filter + optional projection / sort / limit."
            params={[
              { name: "database", type: "string", required: true, doc: "Database name." },
              { name: "collection", type: "string", required: true, doc: "Collection name." },
              { name: "filter", type: "object", required: false, doc: "Mongo query filter." },
              { name: "projection", type: "object", required: false, doc: "Field-include map." },
              { name: "sort", type: "object", required: false, doc: "Sort spec." },
              { name: "limit", type: "number", required: false, doc: "Max docs to return." },
            ]}
            example={`find({
  database: "sample_mflix",
  collection: "movies",
  filter: { year: { $gte: 2020 } },
  projection: { title: 1, year: 1, "imdb.rating": 1, _id: 0 },
  sort: { "imdb.rating": -1 },
  limit: 10
})`}
          />

          <ToolDoc
            t={t}
            name="count"
            kind="mcp"
            description="Count documents matching a filter (or the whole collection if no filter is supplied)."
            params={[
              { name: "database", type: "string", required: true, doc: "Database name." },
              { name: "collection", type: "string", required: true, doc: "Collection name." },
              { name: "filter", type: "object", required: false, doc: "Mongo query filter. Defaults to {}." },
            ]}
            example={`count({
  database: "sample_mflix",
  collection: "movies",
  filter: { genres: "Western" }
})`}
            response={'Text like "Found 547 documents in the collection."'}
          />

          <ToolDoc
            t={t}
            name="collection-schema"
            kind="mcp"
            description="Infer the schema of a collection from a sample — useful before designing a pipeline against unfamiliar data."
            params={[
              { name: "database", type: "string", required: true, doc: "Database name." },
              { name: "collection", type: "string", required: true, doc: "Collection name." },
            ]}
            example={`collection-schema({
  database: "sample_mflix",
  collection: "embedded_movies"
})`}
            response={'MCP text content describing inferred field types, e.g. "plot_embedding: binData (1536-dim), title: string, year: int…"'}
          />

          <ToolDoc
            t={t}
            name="list-collections"
            kind="mcp"
            description="Enumerate the collections in a database."
            params={[
              { name: "database", type: "string", required: true, doc: "Database name." },
            ]}
            example={`list-collections({ database: "sample_mflix" })`}
          />

          <ToolDoc
            t={t}
            name="list-databases"
            kind="mcp"
            description="Enumerate the databases on the Atlas cluster (excluding admin/local)."
            params={[]}
            example={`list-databases()`}
          />
        </div>

        <p className={`mt-6 text-sm ${t.muted}`}>
          For the full upstream tool list, see{" "}
          <a
            href="https://github.com/mongodb-js/mongodb-mcp-server"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-violet-500 hover:underline"
          >
            mongodb-js/mongodb-mcp-server
            <ExternalLink className="h-3 w-3" />
          </a>
          . We allow-list only the data-operation tools (no Atlas administration) so the Gemini function-declaration payload stays small.
        </p>
      </section>

      {/* WebSocket events */}
      <section id="ws-events" className="mx-auto max-w-6xl px-6 pb-20 scroll-mt-20">
        <SectionHeading
          t={t}
          icon={<Server className="h-5 w-5" />}
          eyebrow="WebSocket events"
          title="What the server pushes to the client."
          body="Tool calls and tool results stream out as `trace` events so the UI can render the visual trace timeline. Canvas + results updates are their own message types so they can be persisted independently."
        />
        <div className={`mt-8 overflow-hidden rounded-lg border ${t.card}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`text-left ${t.tableHead}`}>
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">When</th>
                <th className="px-4 py-2 font-semibold">Payload highlights</th>
              </tr>
            </thead>
            <tbody className={t.tableBody}>
              <EventRow t={t} type="canvas.update" when="`update_canvas` fires" payload="The full normalized PipelineSchema." />
              <EventRow t={t} type="results" when="`push_results` or each `run_pipeline` branch lands" payload="{ stageId, rows[], label? }" />
              <EventRow t={t} type="trace" when="every tool start / result, plus agent text" payload="{ kind, label?, payload?, durationMs?, prompts? }" />
              <EventRow t={t} type="connection.status" when="Atlas / Gemini state change" payload="{ component: 'atlas' | 'gemini', state, detail? }" />
              <EventRow t={t} type="mflix.collections" when="reply to a `mflix.refresh` request" payload="{ database, collections: [{ name, estimatedCount?, exampleDocument? }] }" />
            </tbody>
          </table>
        </div>
        <p className={`mt-4 text-sm ${t.muted}`}>
          The matching TypeScript definitions live in{" "}
          <code className={`rounded ${t.codeInline} px-1.5`}>
            server/src/websocket/protocol.ts
          </code>{" "}
          and{" "}
          <code className={`rounded ${t.codeInline} px-1.5`}>
            ui/src/types/ws.ts
          </code>
          .
        </p>
      </section>

      {/* Footer CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className={`rounded-xl border px-8 py-10 text-center ${t.footerBox}`}>
          <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Try it live.
          </h3>
          <p className={`mx-auto mt-2 max-w-lg ${t.muted}`}>
            Every tool above is invocable from the workspace. Open the visual
            trace timeline to watch them fire in real time.
          </p>
          <Link
            to="/app"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform hover:scale-[1.02]"
          >
            Launch Workspace
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer
        className={`mx-auto max-w-6xl px-6 pb-10 text-center text-xs ${t.footerText}`}
      >
        Built for the Gemini hackathon, 2026. Open source.
      </footer>
    </div>
  );
}

/* ───────────── Theme tokens ───────────── */
// Centralizing the dark/light class lookups keeps the JSX above readable
// and ensures the doc page palette matches LandingPage 1:1.

type ThemeTokens = {
  page: string;
  muted: string;
  subtle: string;
  chip: string;
  button: string;
  card: string;
  cardIcon: string;
  cardTitle: string;
  cardBody: string;
  footerBox: string;
  footerText: string;
  heroGradient: string;
  eyebrow: string;
  sectionRule: string;
  codeBlock: string;
  codeInline: string;
  badgeCustom: string;
  badgeMcp: string;
  tableHead: string;
  tableBody: string;
  paramRow: string;
};

function themeTokens(dark: boolean): ThemeTokens {
  return dark
    ? {
        page: "bg-slate-950 text-slate-100",
        muted: "text-slate-400",
        subtle: "text-slate-300",
        chip: "border-slate-800 bg-slate-900/80 text-slate-300",
        button:
          "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white",
        card: "border-slate-800 bg-slate-900/40",
        cardIcon: "border-slate-700 bg-slate-900 text-slate-200",
        cardTitle: "text-slate-100",
        cardBody: "text-slate-400",
        footerBox: "border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950",
        footerText: "text-slate-600",
        heroGradient:
          "bg-gradient-to-b from-violet-500/10 via-transparent to-transparent",
        eyebrow: "text-violet-400",
        sectionRule: "h-px bg-slate-800",
        codeBlock:
          "border-slate-800 bg-slate-900/60 text-slate-100",
        codeInline: "bg-slate-800/80 text-slate-200",
        badgeCustom: "bg-violet-500/15 text-violet-300 border-violet-500/30",
        badgeMcp: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        tableHead: "bg-slate-900/60 text-slate-300 border-b border-slate-800",
        tableBody: "text-slate-300",
        paramRow: "border-slate-800",
      }
    : {
        page: "bg-white text-slate-900",
        muted: "text-slate-500",
        subtle: "text-slate-700",
        chip: "border-slate-200 bg-slate-100 text-slate-600",
        button:
          "border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900",
        card: "border-slate-200 bg-white",
        cardIcon: "border-slate-200 bg-white text-slate-700",
        cardTitle: "text-slate-900",
        cardBody: "text-slate-600",
        footerBox: "border-slate-200 bg-gradient-to-br from-slate-50 to-white",
        footerText: "text-slate-400",
        heroGradient:
          "bg-gradient-to-b from-violet-300/30 via-transparent to-transparent",
        eyebrow: "text-violet-600",
        sectionRule: "h-px bg-slate-200",
        codeBlock: "border-slate-200 bg-slate-50 text-slate-800",
        codeInline: "bg-slate-100 text-slate-800",
        badgeCustom: "bg-violet-100 text-violet-700 border-violet-200",
        badgeMcp: "bg-emerald-100 text-emerald-700 border-emerald-200",
        tableHead: "bg-slate-50 text-slate-600 border-b border-slate-200",
        tableBody: "text-slate-700",
        paramRow: "border-slate-200",
      };
}

/* ───────────── Sub-components ───────────── */

function ArchCard({
  t,
  dark,
  icon,
  title,
  body,
}: {
  t: ThemeTokens;
  dark: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border p-5 ${t.card}`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 -z-0 bg-gradient-to-br ${
          dark
            ? "from-violet-500/10 to-violet-500/0"
            : "from-violet-100/60 to-transparent"
        }`}
      />
      <div className="relative z-10">
        <div
          className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md border ${t.cardIcon}`}
        >
          {icon}
        </div>
        <h3 className={`text-base font-semibold ${t.cardTitle}`}>{title}</h3>
        <p className={`mt-1.5 text-sm leading-relaxed ${t.cardBody}`}>{body}</p>
      </div>
    </div>
  );
}

function SectionHeading({
  t,
  icon,
  eyebrow,
  title,
  body,
}: {
  t: ThemeTokens;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="max-w-3xl">
      <div
        className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${t.eyebrow}`}
      >
        {icon}
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <p className={`mt-3 text-sm leading-relaxed sm:text-base ${t.muted}`}>
        {body}
      </p>
    </div>
  );
}

function TocLink({
  t,
  href,
  label,
  sub,
}: {
  t: ThemeTokens;
  href: string;
  label: string;
  sub: string;
}) {
  return (
    <a
      href={href}
      className={`flex flex-col rounded-md border px-3 py-2 transition-colors ${t.card} hover:border-violet-500`}
    >
      <span className={`text-sm font-medium ${t.cardTitle}`}>{label}</span>
      <span className={`text-xs ${t.muted}`}>{sub}</span>
    </a>
  );
}

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  doc: string;
}

function ToolDoc({
  t,
  name,
  kind,
  description,
  params,
  example,
  response,
  featured,
}: {
  t: ThemeTokens;
  name: string;
  kind: "custom" | "mcp";
  description: string;
  params: ToolParam[];
  example: string;
  response?: string;
  /** Highlight a star tool (currently `run_pipeline`) with a violet ring. */
  featured?: boolean;
}) {
  const badgeClass = kind === "custom" ? t.badgeCustom : t.badgeMcp;
  const badgeLabel = kind === "custom" ? "Custom" : "MCP";
  return (
    <article
      id={`tool-${name}`}
      className={`scroll-mt-20 overflow-hidden rounded-lg border ${t.card} ${
        featured ? "ring-1 ring-violet-500/40" : ""
      }`}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-inherit px-5 py-3">
        <code className={`text-base font-semibold ${t.cardTitle}`}>{name}</code>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeClass}`}
        >
          {badgeLabel}
        </span>
        {featured && (
          <span className="rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            Hero tool
          </span>
        )}
      </header>
      <div className="space-y-4 px-5 py-4">
        <p className={`text-sm leading-relaxed ${t.cardBody}`}>{description}</p>

        {params.length > 0 && (
          <div>
            <div
              className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${t.eyebrow}`}
            >
              Parameters
            </div>
            <ul className="divide-y divide-inherit">
              {params.map((p) => (
                <li
                  key={p.name}
                  className={`flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-4 ${t.paramRow} ${
                    p === params[0] ? "" : "border-t"
                  }`}
                >
                  <div className="sm:w-1/3">
                    <code className={`text-sm font-semibold ${t.cardTitle}`}>
                      {p.name}
                    </code>
                    <span className={`ml-2 text-[11px] ${t.muted}`}>
                      {p.type}
                    </span>
                    {p.required ? (
                      <span className="ml-1 rounded bg-rose-500/15 px-1 text-[10px] font-medium text-rose-500">
                        required
                      </span>
                    ) : (
                      <span className={`ml-1 text-[10px] ${t.muted}`}>
                        optional
                      </span>
                    )}
                  </div>
                  <p className={`flex-1 text-sm leading-snug ${t.cardBody}`}>
                    {p.doc}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div
            className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${t.eyebrow}`}
          >
            Example call
          </div>
          <pre
            className={`overflow-x-auto rounded-md border p-3 text-xs leading-relaxed ${t.codeBlock}`}
          >
            <code className="font-mono">{example}</code>
          </pre>
        </div>

        {response && (
          <div>
            <div
              className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${t.eyebrow}`}
            >
              Response
            </div>
            <pre
              className={`overflow-x-auto rounded-md border p-3 text-xs leading-relaxed ${t.codeBlock}`}
            >
              <code className="font-mono">{response}</code>
            </pre>
          </div>
        )}
      </div>
    </article>
  );
}

function EventRow({
  t,
  type,
  when,
  payload,
}: {
  t: ThemeTokens;
  type: string;
  when: string;
  payload: string;
}) {
  return (
    <tr className="border-t border-inherit align-top">
      <td className="px-4 py-3">
        <code className={`rounded px-1.5 py-0.5 text-xs ${t.codeInline}`}>
          {type}
        </code>
      </td>
      <td className="px-4 py-3 text-sm">{when}</td>
      <td className="px-4 py-3 text-sm">
        <code className={`rounded px-1.5 py-0.5 text-xs ${t.codeInline}`}>
          {payload}
        </code>
      </td>
    </tr>
  );
}

// Suppress unused-imports lint by referencing them. (Network is used by
// neither the page nor the cards directly, but I keep it imported so the
// lucide-react palette stays in sync with the landing page if/when we add
// a "Model Context Protocol" card here later.)
void Network;
