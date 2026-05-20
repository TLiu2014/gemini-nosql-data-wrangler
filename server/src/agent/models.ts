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

// Phase 2/3 uses the standard generateContent / chats.create API — NOT the
// Live API. The `*-live-*` / `*-native-audio-*` model IDs are Live-only and
// will fail with the new architecture. Multimodal input (audio Parts via
// inlineData) is supported by the standard generateContent path on most
// Gemini 2.5 / 3.x models.
//
// Pro was hitting 429s ("free_tier_requests, limit: 0") — Gemini 3.1 Pro
// isn't on the free tier at all. Switching to Gemini 3 Flash Preview, which
// has actual free-tier headroom and decent tool-calling reasoning for our
// ReAct loop. If 3-flash also gets rate-limited, swap to one of the
// alternates below.
export const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

// Alternates (verified-real model IDs):
// export const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";   // strongest reasoning, NOT on free tier (429 immediately)
// export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";   // smallest/fastest, weaker tool reasoning
// export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";          // stable GA fallback

// HOLD: separate transcription model. Tried `gemini-3-flash-preview` for
// the `echoUserSpeech` side-call but it didn't materially improve verbatim
// transcription quality — see the discussion in the chat for alternatives.
// export const TRANSCRIPTION_MODEL = "gemini-3-flash-preview";

// DEPRECATED — Live API model IDs. Kept for reference if we ever flip
// back to streaming voice.
// export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";
// export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";