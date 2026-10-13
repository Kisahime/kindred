// Shared normaliser for model output.
/** Model output -> readable text. Objects/arrays are flattened to a comma-separated description; never "[object Object]". */
export function toText(v: unknown, depth = 0): string {
  if (v === undefined || v === null || depth > 4) return "";
  if (typeof v === "string") return v.replace(/\[object Object\]/g, "").trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => toText(x, depth + 1)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["value", "description", "text", "outfit", "setting", "place"]) if (k in o && toText(o[k], depth + 1)) return toText(o[k], depth + 1);
    return Object.values(o).map((x) => toText(x, depth + 1)).filter(Boolean).join(", ");
  }
  return "";
}
