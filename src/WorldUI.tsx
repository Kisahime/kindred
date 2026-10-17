// v1.3 Living World UI: "People they know" (character editor) and the world options.
import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Character } from "./types";
import { daysUntil, decorFor, eventToday } from "./seasonal";
import { describeWeather, refreshWeather, weatherAllowed } from "./weather";
import { profile } from "./profile";
import { ask } from "@tauri-apps/plugin-dialog";
import { pairTypeAllowed } from "./protect";
import { addRelation, pairHasHistory, relationsCache, removeRelation, loadRelations, loadWorld, PAIR_TYPES, PairType, relationOf, Relation, saveRelation, saveWorld, WFreq, worldCfg, WorldCfg, worldCharacters } from "./world";

const feel = (n: number) => n >= 70 ? "very close" : n >= 35 ? "warm" : n >= 10 ? "friendly" : n > -10 ? "neutral" : n > -40 ? "prickly" : "tense";

/** Editor section: how this character gets on with every other contact. Changes save immediately. */
export function RelationsEditor({ c }: { c: Character }) {
  const [rels, setRels] = useState<Record<string, Relation>>({});
  const [open, setOpen] = useState(false);
  useEffect(() => { loadRelations().then(setRels).catch(() => {}); }, []);
  const [pick, setPick] = useState("");
  const all = worldCharacters().filter((o) => o.id !== c.id);
  if (!c.id || !all.length) return null;
  const others = all.filter((o) => relationOf(c.id, o.id, rels));
  const rest = all.filter((o) => !relationOf(c.id, o.id, rels));
  const who = c.name || "They";
  const get = (o: Character) => relationOf(c.id, o.id, rels)!;
  const put = (r: Relation) => { setRels((m) => ({ ...m, [`${r.a}|${r.b}`]: r })); saveRelation({ ...r, updatedAt: Date.now() }).then(setRels).catch(() => {}); };
  const add = () => { const id = pick || rest[0]?.id; if (!id) return; addRelation(c.id, id).then(() => { setRels({ ...relationsCache() }); setPick(""); }).catch(() => {}); };
  const unlink = async (o: Character) => {
    const r = get(o);
    if (pairHasHistory(r) && !(await ask(`Remove ${o.name} from the people ${who} knows? Their history together (opinions, affinity and notes) is deleted for both of them.`, { title: "Remove", kind: "warning", okLabel: "Remove", cancelLabel: "Keep" }))) return;
    removeRelation(c.id, o.id).then((m) => setRels({ ...m })).catch(() => {});
  };
  return (
    <div className="appearance-box">
      <button className="link" onClick={() => setOpen((x) => !x)}>{open ? "\u25BE" : "\u25B8"} People {c.name ? `${c.name} knows` : "they know"} <span className="muted">({others.length})</span></button>
      {open && <>
        <small>Who {c.name} knows among your other contacts (it works both ways). Only people you add here know each other; their friendship then evolves by itself over time (group chats, outings and little moments while the app is open). Romance and family are only ever set by you, and family is always platonic. Tick "Keep" to stop the type changing on its own.</small>
        {!others.length && <small className="muted">{who} doesn{"\u2019"}t know anyone yet.</small>}
        {others.map((o) => {
          const r = get(o);
          return (
            <div key={o.id} className="rel-row">
              <div className="rel-head">
                <Avatar emoji={o.avatar} path={o.avatarPath} color={o.color} /><b>{o.name}</b>
                <select value={r.type} onChange={(e) => put({ ...r, type: e.target.value as PairType, family: e.target.value === "family" ? r.family : "", manual: true })}>
                  {PAIR_TYPES.filter((t) => t.id === r.type || pairTypeAllowed(t.id, c, o)).map((t) => <option key={t.id} value={t.id} disabled={!pairTypeAllowed(t.id, c, o)}>{t.label}</option>)}
                </select>
                {r.type === "family" && <input className="rel-family" placeholder="e.g. sisters, cousins" value={r.family} onChange={(e) => setRels((m) => ({ ...m, [`${r.a}|${r.b}`]: { ...r, family: e.target.value } }))} onBlur={() => put(r)} />}
                <label className="check" title="Keep this type (the world won't change it)"><input type="checkbox" checked={r.manual} onChange={(e) => put({ ...r, manual: e.target.checked })} /> Keep</label>
                <button className="link" title={`${o.name} and ${c.name} stop knowing each other (both sides)`} onClick={() => unlink(o)}>Remove</button>
              </div>
              <label className="inline rel-aff">Affinity <input type="range" min={-100} max={100} value={r.affinity} onChange={(e) => setRels((m) => ({ ...m, [`${r.a}|${r.b}`]: { ...r, affinity: Number(e.target.value) } }))} onMouseUp={() => put(r)} onKeyUp={() => put(r)} /> <small>{r.affinity} ({feel(r.affinity)})</small></label>
              <label className="rel-op">{c.name} thinks of {o.name}<input value={r.opinions[c.id] ?? ""} placeholder="(not decided yet)" onChange={(e) => setRels((m) => ({ ...m, [`${r.a}|${r.b}`]: { ...r, opinions: { ...r.opinions, [c.id]: e.target.value } } }))} onBlur={() => put(r)} /></label>
              <label className="rel-op">{o.name} thinks of {c.name}<input value={r.opinions[o.id] ?? ""} placeholder="(not decided yet)" onChange={(e) => setRels((m) => ({ ...m, [`${r.a}|${r.b}`]: { ...r, opinions: { ...r.opinions, [o.id]: e.target.value } } }))} onBlur={() => put(r)} /></label>
              {r.notes.length > 0 && <ul className="rel-notes">{r.notes.slice(-3).reverse().map((n) => <li key={n.t + n.text}><small>{new Date(n.t).toLocaleDateString()}</small> {n.text}</li>)}</ul>}
            </div>
          );
        })}
        {rest.length > 0 && <div className="rel-add">
          <select value={pick || rest[0].id} onChange={(e) => setPick(e.target.value)} aria-label={`Someone ${who} knows`}>
            {rest.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button onClick={add}>+ Add someone {c.name ? `${c.name} knows` : "they know"}</button>
        </div>}
      </>}
    </div>
  );
}

/** Options section: Living World switches (apply immediately, stored in kv "world_cfg"). */
export function WorldOptions() {
  const [cfg, setCfg] = useState<WorldCfg>(worldCfg());
  useEffect(() => { loadWorld().then(setCfg).catch(() => {}); }, []);
  const [wx, setWx] = useState("");
  const checkWeather = (c: WorldCfg) => {
    if (!c.weather) { setWx(""); refreshWeather(undefined, undefined, c).catch(() => {}); return; }
    if (!weatherAllowed(c, profile())) { setWx("Add your town in your Me profile (click your name) and switch on \"characters can know this\" for it."); return; }
    setWx("Checking the weather\u2026");
    refreshWeather(undefined, undefined, c).then((w) => setWx(w ? `Now in ${w.place}: ${describeWeather(w.code, w.isDay).emoji} ${describeWeather(w.code, w.isDay).text}, ${w.tempC}\u00B0C` : "Couldn't reach the weather service; the usual made-up weather is used until it can."))
      .catch(() => setWx("Couldn't reach the weather service."));
  };
  useEffect(() => { if (worldCfg().weather) checkWeather(worldCfg()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: Partial<WorldCfg>) => { const n = { ...cfg, ...x }; setCfg(n); saveWorld(n).then(() => { if ("weather" in x) checkWeather(n); }).catch(() => {}); };
  const sw = (on: boolean, flip: () => void, label: string, hint: string) => (
    <label className="switch-row"><span className={`switch${on ? " on" : ""}`} role="switch" aria-checked={on} tabIndex={0} onClick={flip}><i /></span>{label} <small>{hint}</small></label>);
  const freq = (v: WFreq, on: (f: WFreq) => void, labels: [string, string, string, string]) => (
    <select value={v} onChange={(e) => on(e.target.value as WFreq)}>{(["off", "rarely", "sometimes", "often"] as WFreq[]).map((f, i) => <option key={f} value={f}>{labels[i]}</option>)}</select>);
  return <>
    <div className="opt-row">{"\u{1F30D}"} Living world <small>(applies immediately)</small></div>
    {sw(cfg.relations, () => set({ relations: !cfg.relations }), "Characters' friendships evolve by themselves", "(little moments between them; see \"People they know\" in the editor)")}
    {sw(cfg.feedSocial, () => set({ feedSocial: !cfg.feedSocial }), "Characters like and comment on each other's posts", "(What's new)")}
    <label className="inline">Photos in What's new {freq(cfg.feedPhotos, (f) => set({ feedPhotos: f }), ["Off", "Rarely", "Sometimes", "Often"])}
      {" "}max <input type="number" min={0} max={20} value={cfg.feedPhotoCap} onChange={(e) => set({ feedPhotoCap: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} style={{ width: 48 }} /> a day
      <small> (only characters with "unprompted selfies" on; same rules as selfies)</small></label>
    <label className="inline">Letters from characters {freq(cfg.letters, (f) => set({ letters: f }), ["Off", "Rarely (every ~10 days)", "Sometimes (every ~5 days)", "Often (every ~2 days)"])}
      <small> (only characters who can message you first)</small></label>
    {sw(cfg.diaries, () => set({ diaries: !cfg.diaries }), "Characters keep a diary", "(readable from closeness 50)")}
    {sw(cfg.seasonal, () => set({ seasonal: !cfg.seasonal }), "Seasonal events and decorations", "(New Year, Valentine's, Halloween, Christmas)")}
    {sw(cfg.weather, () => set({ weather: !cfg.weather }), "Real weather where I live", "(uses your Me profile town only if \"characters can know this\" is on; asks open-meteo.com, nothing else leaves your PC)")}
    {cfg.weather && wx && <small className="backup-msg">{wx}</small>}
  </>;
}

/** A small seasonal decoration under the sidebar header (from a week before the event; Christmas all December). */
export function SeasonDecor() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 10 * 60_000); return () => clearInterval(id); }, []);
  const ev = worldCfg().seasonal ? decorFor(now) : null;
  if (!ev) return null;
  const today = eventToday(now)?.id === ev.id;
  const n = daysUntil(ev, now);
  return <div className={`season-strip season-${ev.id}`} title={ev.name}>
    <span className="season-garland">{ev.emoji.repeat(3)}</span>
    {today ? `Happy ${ev.name}!` : `${ev.name} in ${n} day${n === 1 ? "" : "s"}`}
    <span className="season-garland">{ev.emoji.repeat(3)}</span></div>;
}
