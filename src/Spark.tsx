import type { GenField } from "./autogen";
import type { GenCtl } from "./genctl";

/** Small sparkle "generate" button (+ undo) shown next to an editor field. */
export function Spark({ f, gen }: { f: GenField; gen?: GenCtl }) {
  if (!gen) return null;
  const busy = gen.busy(f);
  return (
    <span className="spark">
      <button type="button" className={`spark-btn${busy ? " busy" : ""}`} disabled={busy} title="Generate with AI (uses the other fields)"
        onClick={(e) => { e.preventDefault(); gen.run(f); }}>{busy ? "\u23F3" : "\u2728"}</button>
      {gen.canUndo(f) && !busy && <button type="button" className="spark-btn" title="Undo last generation" onClick={(e) => { e.preventDefault(); gen.undo(f); }}>{"\u21B6"}</button>}
    </span>
  );
}