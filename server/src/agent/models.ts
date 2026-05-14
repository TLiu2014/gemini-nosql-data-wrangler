/**
 * Single source of truth for the Gemini Live model alias. Override via the
 * GEMINI_MODEL env var (see `config/env.ts`) without touching code.
 *
 * The Live API rejects unknown model IDs with a WebSocket close code 1008
 * immediately at session open, so getting this right is load-bearing.
 *
 * Known-good models on AI Studio keys (verified by the gemini-data-wrangler-live
 * project, which ships to Cloud Run against an AI Studio key):
 *   - "gemini-2.5-flash-native-audio-preview-09-2025"  ← supports tool calls
 *   - "gemini-2.5-flash-native-audio-preview-12-2025"  ← better audio, but
 *     has a server-side regression: WS closes 1008 the moment it attempts a
 *     function call. We need tool calls, so we use 09-2025 by default.
 *
 * Avoid the `gemini-X.Y-flash-live-preview-*` aliases — those are Vertex AI
 * only and fail with close code 1008 under an AI Studio key. Likewise the
 * speculative `gemini-3.1-flash-live` is not published.
 *
 * Keep all the candidates below — flipping the active line is the fastest way
 * to A/B a new release without editing imports.
 */

// export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-live";                             // Not published. Closes WS 1008.
// export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";     // AI Studio. Better audio, BUT closes WS 1008 on every tool call.
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";        // AI Studio. Verified working with tool calling — our default.
