/**
 * Validate that an incoming string looks like a Gemini API key before we ever
 * pass it to GoogleGenAI. We're not doing crypto-strength verification — just
 * preventing garbage / accidental-form-paste from reaching the upstream call,
 * which produces opaque WS-close errors that confuse users.
 *
 * Mirrors the validator in gemini-data-wrangler-live's apiKeyStore.ts.
 */
export function looksLikeApiKey(value: string | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 30 || trimmed.length > 60) return false;
  return /^[A-Za-z0-9_-]+$/.test(trimmed);
}

/**
 * Pick the API key to use for this session: prefer the one the user typed in
 * the browser settings; fall back to the server's env var. Returns `null` when
 * neither is usable so the caller can send a clear error to the client.
 */
export function resolveApiKey(
  clientProvided: string | undefined,
  envFallback: string | undefined,
): { key: string } | { error: string } {
  const trimmed = clientProvided?.trim();
  if (trimmed) {
    if (!looksLikeApiKey(trimmed)) {
      return {
        error: "Invalid API key format. Check the value in Settings.",
      };
    }
    return { key: trimmed };
  }
  if (envFallback && looksLikeApiKey(envFallback)) {
    return { key: envFallback };
  }
  return {
    error:
      "No Gemini API key provided. Enter one in Settings or set GEMINI_API_KEY on the server.",
  };
}

/**
 * Loose-check that a string looks like a MongoDB connection URI. We only
 * verify the scheme so an obviously-wrong paste (e.g. the user's API key)
 * doesn't get spawned into the MCP subprocess.
 */
export function looksLikeMongoUri(value: string | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^mongodb(\+srv)?:\/\//i.test(trimmed);
}

/**
 * Pick the MongoDB URI to use for this session: client-provided wins, env
 * fallback otherwise. Returns `null` (with a `null` error too) when neither
 * exists — that's not an error condition, the agent just runs Atlas-less.
 */
export function resolveMongoUri(
  clientProvided: string | undefined,
  envFallback: string | undefined,
): { uri: string } | { uri: null; error?: string } {
  const trimmed = clientProvided?.trim();
  if (trimmed) {
    if (!looksLikeMongoUri(trimmed)) {
      return {
        uri: null,
        error:
          "Invalid MongoDB connection string. Should start with mongodb:// or mongodb+srv://",
      };
    }
    return { uri: trimmed };
  }
  if (envFallback && looksLikeMongoUri(envFallback)) {
    return { uri: envFallback };
  }
  return { uri: null };
}
