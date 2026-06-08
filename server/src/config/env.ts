/**
 * Centralized environment-variable parsing. We fail loudly at startup on
 * MONGODB_URI (no useful work without it), but treat GEMINI_API_KEY as
 * optional — users can supply their own key in the browser Settings panel.
 *
 * Down the road this is the single point we'd swap in Google Secret Manager
 * loading — values still surface as `env.MONGODB_URI` etc., callers don't change.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

import { DEFAULT_GEMINI_MODEL } from "../agent/models.js";

/**
 * Load the repo-root `.env` into `process.env` for local dev. This is a
 * no-op in production (Cloud Run injects real env vars / Secret Manager and
 * there is no `.env` file shipped). Real environment variables always win —
 * `loadEnvFile` does not overwrite values already present in `process.env`.
 *
 * The file lives at the repo root, three levels up from this module both in
 * source (`server/src/config/env.ts`) and compiled output
 * (`server/dist/config/env.js`).
 */
function loadDotEnv(): void {
  if (typeof process.loadEnvFile !== "function") return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "../../../.env");
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* No .env file (e.g. production / CI) — rely on real env vars. */
  }
}

loadDotEnv();

interface Env {
  /**
   * Optional. When unset, the backend still boots and Gemini Live still works —
   * the Atlas/MCP layer just stays in the "error" state and the agent is told
   * via system instruction that database tools are unavailable.
   */
  MONGODB_URI: string | undefined;
  GEMINI_API_KEY: string | undefined;
  PORT: number;
  GEMINI_MODEL: string;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function optionalOrUndefined(name: string): string | undefined {
  const v = process.env[name];
  if (!v || v.trim() === "") return undefined;
  return v.trim();
}

export function loadEnv(): Env {
  return {
    MONGODB_URI: optionalOrUndefined("MONGODB_URI"),
    GEMINI_API_KEY: optionalOrUndefined("GEMINI_API_KEY"),
    PORT: Number(optional("PORT", "8080")),
    // Source of truth lives in agent/models.ts so the active alias can be
    // flipped without touching env wiring. Override via GEMINI_MODEL env var
    // for ad-hoc tests against a different Live alias.
    GEMINI_MODEL: optional("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
  };
}

export type { Env };
