/**
 * MongoDB returns documents with BSON insertion order preserved, so two
 * docs in the same collection often have identical fields in different
 * orders. Renderers walk `Object.keys()` directly, which surfaces that
 * inconsistency to the user.
 *
 * `normalizeRowKeyOrder` collects the union of keys across all rows, sorts
 * them lexicographically, and re-emits each row with that shared order. A
 * stable A→Z order means `_id` lands first (underscore < letters in ASCII)
 * and adjacent rows can be compared by eye without scanning for the right
 * field.
 *
 * Operates only on plain top-level objects in the row array. Nested objects
 * keep their original order — deep-normalizing arbitrarily nested shapes
 * risks reshuffling intentional grouping (e.g.
 * `tomatoes.viewer.{meter, rating, numReviews}`).
 */
export function normalizeRowKeyOrder<T>(rows: T[]): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const allKeys = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    for (const k of Object.keys(row as Record<string, unknown>)) {
      allKeys.add(k);
    }
  }
  if (allKeys.size === 0) return rows;
  const order = [...allKeys].sort((a, b) => a.localeCompare(b));
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const r = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of order) {
      if (k in r) out[k] = r[k];
    }
    return out as T;
  });
}
