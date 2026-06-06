import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Database,
  ImageIcon,
  Moon,
  Network,
  Sparkles,
  Sun,
} from "lucide-react";
import { LAUNCH_APP_LABEL } from "@/lib/labels";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "gemini-data-wrangler:landing-theme";

function loadInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  // Fall back to the OS preference on first visit.
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

/**
 * Marketing landing page rendered at `/`. Supports light + dark themes with
 * a toggle in the top-right. All styling is Tailwind utility classes scoped
 * to this component so nothing leaks into the Workspace's React Flow CSS.
 */
export default function LandingPage() {
  const [theme, setTheme] = useState<Theme>(loadInitialTheme);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const dark = theme === "dark";
  // Centralize all the theme-conditional classes so the JSX below stays
  // readable. Light theme: warm off-white surface with deep-slate ink.
  // Dark theme: the original slate-950 / slate-100 palette.
  const t = dark
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
        footerBox:
          "border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950",
        footerText: "text-slate-600",
        videoBox: "border-slate-800 bg-slate-900/40",
        videoSurface: "bg-gradient-to-br from-slate-900 to-slate-950",
        videoIcon: "border-slate-700 bg-slate-900",
        videoCopy: "text-slate-500",
        heroGradient:
          "bg-gradient-to-b from-violet-500/10 via-transparent to-transparent",
        eyebrow: "text-violet-400",
        sectionRule: "h-px bg-slate-800",
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
        footerBox:
          "border-slate-200 bg-gradient-to-br from-slate-50 to-white",
        footerText: "text-slate-400",
        videoBox: "border-slate-200 bg-slate-50",
        videoSurface: "bg-gradient-to-br from-slate-100 to-slate-50",
        videoIcon: "border-slate-200 bg-white",
        videoCopy: "text-slate-400",
        heroGradient:
          "bg-gradient-to-b from-violet-300/30 via-transparent to-transparent",
        eyebrow: "text-violet-600",
        sectionRule: "h-px bg-slate-200",
      };

  return (
    <div className={`min-h-screen w-full ${t.page}`}>
      {/* Top nav — minimal */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-400" />
          <span className="text-sm font-semibold tracking-tight">
            Gemini NoSQL Data Wrangler
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(dark ? "light" : "dark")}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${t.button}`}
            title={dark ? "Switch to light theme" : "Switch to dark theme"}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {dark ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <Link
            to="/docs"
            className={`hidden rounded-md border px-3 py-1.5 text-sm font-medium transition-colors sm:inline-flex ${t.button}`}
          >
            Docs
          </Link>
          <Link
            to="/app"
            className="rounded-md bg-gradient-to-r from-violet-600 to-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition-transform hover:scale-[1.02]"
          >
            {LAUNCH_APP_LABEL}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-6 pb-24 pt-16 sm:pt-24">
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 -z-0 blur-3xl ${t.heroGradient}`}
        />
        <div className="relative z-10 max-w-3xl">
          <div className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${t.chip}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Hackathon demo · 2026
          </div>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Gemini Data Wrangler.
          </h1>
          <p className={`mt-6 text-lg leading-relaxed sm:text-xl ${t.subtle}`}>
            Talk to your MongoDB database in plain English. Watch a{" "}
            <span className="font-semibold text-violet-400">Google ADK</span>{" "}
            agent — powered by{" "}
            <span className="font-semibold">Gemini&nbsp;3</span> and the{" "}
            <span className="font-semibold">MongoDB&nbsp;MCP Server</span> —
            design a MongoDB Aggregation Pipeline on the canvas stage by
            stage, run it against your data, and stream the results back.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to="/app"
              className="group inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform hover:scale-[1.02]"
            >
              {LAUNCH_APP_LABEL}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#stack"
              className={`inline-flex items-center justify-center rounded-md border px-6 py-3 text-base font-medium transition-colors ${t.button}`}
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* Visual proof — transform-flow screenshot above, demo video below.
          Stacked (not side-by-side) so each gets the full content width: the
          screenshot needs room for stage labels to be legible, and a wider
          video frame is easier to follow. Both placeholders for now; drop a
          real screenshot + recording in `docs/screenshots/` later. */}
      <section className="mx-auto max-w-6xl space-y-6 px-6 pb-24">
        {/* Screenshot — TODO: drop `docs/screenshots/canvas-flow.png` in and
            swap the placeholder for an <img> tag. Suggested capture: workspace
            mid-Demo 2, $lookup branching into two parallel paths, results
            panel showing per-stage tabs. */}
        <div
          className={`overflow-hidden rounded-xl border shadow-2xl ${t.videoBox} ${dark ? "shadow-black/40" : "shadow-slate-200/60"}`}
        >
          <div className="aspect-video w-full">
            <div
              className={`flex h-full w-full flex-col items-center justify-center ${t.videoSurface} ${t.videoCopy}`}
            >
              <div className={`rounded-full border p-4 ${t.videoIcon}`}>
                <ImageIcon className="h-8 w-8" />
              </div>
              <p className="mt-4 text-sm">Transform-flow screenshot</p>
              <p className="text-xs italic">(coming soon)</p>
            </div>
          </div>
        </div>
        {/* Demo video placeholder. */}
        <div
          className={`overflow-hidden rounded-xl border shadow-2xl ${t.videoBox} ${dark ? "shadow-black/40" : "shadow-slate-200/60"}`}
        >
          <div className="aspect-video w-full">
            <div
              className={`flex h-full w-full flex-col items-center justify-center ${t.videoSurface} ${t.videoCopy}`}
            >
              <div className={`rounded-full border p-4 ${t.videoIcon}`}>
                <svg
                  className="h-8 w-8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </div>
              <p className="mt-4 text-sm">Demo video</p>
              <p className="text-xs italic">(coming soon)</p>
            </div>
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section id="stack" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="mb-10 max-w-2xl">
          <div className={`text-xs font-semibold uppercase tracking-wider ${t.eyebrow}`}>
            Built with
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Three pieces, one continuous experience.
          </h2>
          <p className={`mt-3 ${t.muted}`}>
            No glue code, no SQL → NoSQL translation, no hand-rolled prompt
            chaining — just standard, supported APIs talking to each other.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <StackCard
            icon={<Sparkles className="h-5 w-5" />}
            title="Google ADK + Gemini"
            body="The agent is built with the Google Agent Development Kit (`@google/adk`). An LlmAgent orchestrates the tool-call loop with Gemini 3 Flash as the brain. Four FunctionTools drive the UI; ADK validates args, dispatches, and streams a visual trace to the client."
            accent={dark ? "from-violet-500/20 to-violet-500/0" : "from-violet-100 to-transparent"}
            t={t}
          />
          <StackCard
            icon={<Database className="h-5 w-5" />}
            title="MongoDB MCP Server"
            body="The agent talks to MongoDB Atlas through the official MongoDB MCP Server (the hackathon's partner MCP integration). ADK's MCPToolset spawns it as a stdio subprocess and auto-discovers aggregate / find / collection-schema as agent tools."
            accent={dark ? "from-emerald-500/20 to-emerald-500/0" : "from-emerald-100 to-transparent"}
            t={t}
          />
          <StackCard
            icon={<Network className="h-5 w-5" />}
            title="Live pipeline preview"
            body="Custom `run_pipeline` tool wraps the agent's MongoDB aggregation in $facet so every stage gets a preview tab in one round-trip — the pipeline still sees the full collection, only the UI display is capped."
            accent={dark ? "from-blue-500/20 to-blue-500/0" : "from-blue-100 to-transparent"}
            t={t}
          />
        </div>
      </section>

      {/* Footer CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className={`rounded-xl border px-8 py-12 text-center ${t.footerBox}`}>
          <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">
            See it run.
          </h3>
          <p className={`mx-auto mt-2 max-w-lg ${t.muted}`}>
            Connect your Atlas cluster, ask the agent for a pipeline, and watch
            the canvas and results panel update in real time.
          </p>
          <Link
            to="/app"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform hover:scale-[1.02]"
          >
            {LAUNCH_APP_LABEL}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className={`mx-auto max-w-6xl px-6 pb-10 text-center text-xs ${t.footerText}`}>
        Built by Tianwei Liu for the Google Cloud Rapid Agent Hackathon, 2026. Open source.
      </footer>
    </div>
  );
}

function StackCard({
  icon,
  title,
  body,
  accent,
  t,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent: string;
  t: {
    card: string;
    cardIcon: string;
    cardTitle: string;
    cardBody: string;
  };
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border p-6 ${t.card}`}>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 -z-0 bg-gradient-to-br ${accent}`}
      />
      <div className="relative z-10">
        <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md border ${t.cardIcon}`}>
          {icon}
        </div>
        <h3 className={`text-lg font-semibold ${t.cardTitle}`}>{title}</h3>
        <p className={`mt-2 text-sm leading-relaxed ${t.cardBody}`}>{body}</p>
      </div>
    </div>
  );
}
