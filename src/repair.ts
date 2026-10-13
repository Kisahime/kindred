// One-off repair: gives already-saved generated items a concrete type and a plain first sentence (ids and prices kept).
import { invoke } from "@tauri-apps/api/core";
import { dayKey, econApi, Item, JsonFn, Stock } from "./economy";
import { CATALOG, MallItem, weekKey } from "./mall";
import { ADULT_CATALOG, ADULT_DEPTS } from "./afterdark";
import { inferType, ITEM_TYPES, STALL_TYPES, typeItem, typesFor } from "./itemtypes";
import { parseJson } from "./mind";
import { Character } from "./types";

export interface Fixable { name: string; description: string; allowed: string[]; }
export interface Fixed { name: string; emoji: string; description: string; itemType: string; }
/** Infers where possible, asks Ollama (one batch) for the rest. Unfixable entries come back null (left as they were). */
export async function fixItems(list: Fixable[], model: string, json: JsonFn | null): Promise<(Fixed | null)[]> {
  const out: (Fixed | null)[] = list.map((x) => { const t = inferType(x.name, x.description, x.allowed); return t ? typeItem({ item_type: t }, x.name, x.description, x.allowed) : null; });
  if (!json || !model) return out;
  for (let attempt = 0; attempt < 2; attempt++) {
  const todo = out.map((v, i) => v ? -1 : i).filter((i) => i >= 0);
  if (!todo.length) break;
  for (let start = 0; start < todo.length; start += 10) {
    const chunk = todo.slice(start, start + 10);
    const msgs = [
      { role: "system", content: [
        "You fix vague shop items so it's clear what each one physically is. Keep everything tasteful and non-graphic.",
        "For each item pick item_type from ITS allowed list, a colour and a material, and write a description whose first sentence plainly says what it is, then a short flourish (max 25 words).",
        'Respond only with JSON: {"items": [{"index": 0, "item_type": "...", "colour": "...", "material": "...", "description": "..."}]}',
      ].join("\n") },
      { role: "user", content: chunk.map((i) => `index ${i}: "${list[i].name}" - ${list[i].description}\n  allowed: ${list[i].allowed.join(", ")}`).join("\n") },
    ];
    try {
      const v = parseJson(await json(model, msgs, attempt ? 0.7 : 0.3));
      for (const r of Array.isArray(v?.items) ? v.items : []) {
        const i = Number(r?.index);
        if (!chunk.includes(i) || out[i]) continue;
        out[i] = typeItem(r, list[i].name, typeof r.description === "string" && r.description.trim() ? r.description : list[i].description, list[i].allowed);
      }
    } catch (e) { console.warn("[repair] batch failed", e); }
  }
  }
  return out;
}

const MALL_TYPES = [...new Set(Object.entries(ITEM_TYPES).filter(([k]) => !["lingerie", "toys18", "massage", "accessories", "games"].includes(k)).flatMap(([, v]) => v))];
const ADULT_TYPES = [...new Set(ADULT_DEPTS.flatMap((d) => typesFor(d.id, true)))];
const builtIn = new Set([...CATALOG, ...ADULT_CATALOG].map((i) => i.name.toLowerCase()));

async function fixList(key: string, model: string, json: JsonFn, adult: boolean) {
  const items = await econApi.kvGet<MallItem[]>(key).catch(() => null);
  if (!items?.length || items.every((i) => i.itemType)) return 0;
  const idx = items.map((it, i) => it.itemType ? -1 : i).filter((i) => i >= 0);
  const fixed = await fixItems(idx.map((i) => ({ name: items[i].name, description: items[i].description, allowed: typesFor(items[i].dept, adult) })), model, json);
  let n = 0;
  idx.forEach((i, k) => { const f = fixed[k]; if (f) { items[i] = { ...items[i], ...f }; n++; } });
  if (n) await econApi.kvSet(key, items);
  return n;
}

/** Runs once (kv items_typed_v1): recent daily/seasonal/After Dark lists, today's stalls and generated inventory items. */
export async function repairSaved(chars: Character[], json: JsonFn, force = false): Promise<number> {
  if (!force && await econApi.kvGet<boolean>("items_typed_v1")) return 0;
  const model = chars[0]?.model ?? "";
  if (!model) return 0;
  let n = 0;
  const now = new Date();
  for (let d = 0; d < 14; d++) { const x = new Date(now); x.setDate(x.getDate() - d); n += await fixList(`mall_new_${dayKey(x)}`, model, json, false); }
  for (let w = 0; w < 3; w++) {
    const x = new Date(now); x.setDate(x.getDate() - 7 * w);
    n += await fixList(`mall_seasonal_${weekKey(x)}`, model, json, false);
    n += await fixList(`afterdark_week_${weekKey(x)}`, model, json, true);
  }
  const day = dayKey(now);
  for (const c of chars) {
    const st = await econApi.shopGet(c.id, day).catch(() => null);
    if (!st?.items?.length || st.items.every((i) => i.itemType)) continue;
    const idx = st.items.map((it, i) => it.itemType ? -1 : i).filter((i) => i >= 0);
    const fixed = await fixItems(idx.map((i) => ({ name: st.items[i].name, description: st.items[i].description, allowed: STALL_TYPES })), model, json);
    let k2 = 0; idx.forEach((i, k) => { const f = fixed[k]; if (f) { st.items[i] = { ...st.items[i], ...f }; k2++; } });
    if (k2) { await econApi.shopSet(c.id, day, st as Stock); n += k2; }
  }
  const inv = (await econApi.inventory(null)).filter((i: Item) => i.owner !== "sold" && !builtIn.has(i.name.toLowerCase()));
  const fixed = await fixItems(inv.map((i) => ({ name: i.name, description: i.description, allowed: i.fromChar === "afterdark" || i.tags.includes("18+") ? ADULT_TYPES : [...MALL_TYPES] })), model, json);
  for (let k = 0; k < inv.length; k++) {
    const f = fixed[k];
    if (f && (f.name !== inv[k].name || f.description !== inv[k].description)) { await invoke("inventory_update_text", { id: inv[k].id, name: f.name, emoji: f.emoji, description: f.description }); n++; }
  }
  await econApi.kvSet("items_typed_v1", true);
  return n;
}
