import type { GenField } from "./autogen";
/** Per-field generate/undo controls handed from the editor to its sections. */
export interface GenCtl { busy: (f: GenField) => boolean; run: (f: GenField) => void; undo: (f: GenField) => void; canUndo: (f: GenField) => boolean; }