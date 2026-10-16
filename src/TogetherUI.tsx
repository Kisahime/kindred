// Together mode UI: *action* text, the Meet up / Plan for later dialog, scene banner and pending plan cards.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { Character, Group } from "./types";
import {
  Activity, activityChoices, canGroupMeetNow, canMeetNow, canStartGroupPlan, canStartPlan, formatDue,
  groupPlanSummary, nextFreeAt, nextGroupFreeAt, PlannedMeetup, planSummary,
  resolveGroupWhen, resolveWhen, Scene, splitActions, WHEN_LABELS, WhenKind,
} from "./together";
import type { SceneMarker } from "./together";
import { canTreat, costShare, findPlace, freeSuggestion, groupCostShare, OTHER, Pay, placesFor, placeText, sceneCard } from "./places";
import { econApi, Item, visibleItem } from "./economy";
import { useDataUrl } from "./photo";
import { SCENE_BG_ON_KEY } from "./scenephoto";
import { Avatar } from "./Avatar";

/** Text with *actions* shown as styled italic action text (speech stays plain). */
export function ActionText({ text }: { text: string }) {
  const segs = splitActions(text);
  if (!segs.some((s) => s.kind === "action")) return <>{text}</>;
  return <>{segs.map((s, i) => s.kind === "action" ? <span key={i} className="act">{s.text}</span> : <span key={i}>{s.text}</span>)}</>;
}

export type MeetResult =
  | { mode: "now"; place: string; activity: Activity; placeId: string; narrator: boolean; pay: Pay }
  | { mode: "plan"; place: string; activity: Activity; when: WhenKind; at?: string; placeId: string; narrator: boolean; pay: Pay };

const WHEN_OPTS: WhenKind[] = ["next_free", "tonight", "tomorrow_afternoon", "this_weekend", "at"];

export function MeetDialog({ c, onDone, onClose, getBalance }: { c: Character; onDone: (r: MeetResult) => void; onClose: () => void; getBalance?: () => Promise<number> }) {
  const choices = activityChoices(c);
  const can = canMeetNow(c);
  const [planning, setPlanning] = useState(!can.ok);
  const [placeId, setPlaceId] = useState("");
  const [detail, setDetail] = useState("");
  const [custom, setCustom] = useState("");
  const [activity, setActivity] = useState<Activity>(choices[choices.length - 1]);
  const [narrator, setNarrator] = useState(true);
  const [pay, setPay] = useState<Pay>("me");
  const [balance, setBalance] = useState<number | null>(null);
  const [when, setWhen] = useState<WhenKind>("next_free");
  const [at, setAt] = useState("");
  useEffect(() => { getBalance?.().then(setBalance).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = placesFor(activity);
  useEffect(() => { if (placeId && placeId !== OTHER && !list.some((p) => p.id === placeId)) setPlaceId(""); }, [activity]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => {
    try { return formatDue(resolveWhen(when, c, new Date(), at || undefined).getTime()); }
    catch { return ""; }
  }, [when, at, c]);
  const nextFree = useMemo(() => formatDue(nextFreeAt(c).getTime()), [c]);
  const pl = findPlace(placeId);
  const cost = pl?.cost ?? 0;
  const share = costShare(cost, pay);
  const short = balance !== null && share > balance;
  const place = placeText(placeId, detail, custom);
  const ok = !!placeId && (placeId !== OTHER || !!custom.trim());
  const ready = ok && (when !== "at" || !!at);
  const base = { place, activity, placeId, narrator, pay };
  const goNow = () => { if (ok && !short) onDone({ mode: "now", ...base }); };
  const submitPlan = () => { if (ready) onDone({ mode: "plan", ...base, when, at: at || undefined }); };
  const enter = (e: KeyboardEvent) => { if (e.key === "Enter") { if (planning) submitPlan(); else if (can.ok) goNow(); } };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <div className="modal-title">{"\u{1F4CD}"} Meet up with {c.name}<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="modal-body">
          {!can.ok && !planning && <>
            <p><b>{can.reason}</b></p>
            {can.line && <p className="meet-reason">{c.name}: <i>"{can.line}"</i></p>}
            <p className="muted">You can plan something for when they're free instead.</p>
          </>}
          {(can.ok || planning) && <>
            {!can.ok && <p className="muted"><b>Plan for later</b> · their next free window is {nextFree}.</p>}
            <div className="meet-kinds">
              {choices.map((k) => (
                <label key={k} className="inline"><input type="radio" name="meetkind" checked={activity === k} onChange={() => setActivity(k)} />
                  {k === "date" ? "\u{1F49E} Date" : "\u{1F91D} Hangout"}</label>
              ))}
            </div>
            {choices.length === 1 && <p className="muted">Dates are only for romantic relationships; this will be a friendly hangout.</p>}
            <div className="place-label">Where?</div>
            <div className="place-grid">
              {list.map((p) => (
                <button key={p.id} type="button" className={`place-chip${placeId === p.id ? " on" : ""}`} title={p.ambience} onClick={() => setPlaceId(p.id)}>
                  <span className="pe">{p.emoji}</span> {p.name} <small>{p.cost ? `${p.cost} \u2728` : "free"}</small></button>
              ))}
              <button type="button" className={`place-chip${placeId === OTHER ? " on" : ""}`} onClick={() => setPlaceId(OTHER)}><span className="pe">{"\u270F\uFE0F"}</span> Somewhere else{"\u2026"} <small>free</small></button>
            </div>
            {pl && <p className="muted place-amb">{pl.emoji} {pl.ambience}</p>}
            {placeId === OTHER && <input autoFocus value={custom} maxLength={160} placeholder="e.g. a picnic by the canal" onChange={(e) => setCustom(e.target.value)} onKeyDown={enter} />}
            {pl && <input value={detail} maxLength={100} placeholder="Details (optional), e.g. the little one by the river" onChange={(e) => setDetail(e.target.value)} onKeyDown={enter} />}
            {cost > 0 && <div className="meet-kinds pay">
              <label className="inline"><input type="radio" name="pay" checked={pay === "me"} onChange={() => setPay("me")} />I'll pay ({cost} {"\u2728"})</label>
              <label className="inline"><input type="radio" name="pay" checked={pay === "split"} onChange={() => setPay("split")} />Split ({costShare(cost, "split")} {"\u2728"} each)</label>
              {canTreat(c) && <label className="inline"><input type="radio" name="pay" checked={pay === "them"} onChange={() => setPay("them")} />{c.name} offered to treat you</label>}
            </div>}
            {short && <p className="meet-warn">{planning ? `You'll need ${share} \u2728 when it starts (you have ${balance}).` : `Not enough Sparkles: this needs ${share} \u2728 and you have ${balance}.`} {freeSuggestion(activity)}</p>}
            <label className="inline narr-toggle"><input type="checkbox" checked={narrator} onChange={(e) => setNarrator(e.target.checked)} />{"\u{1F4D6}"} Narrator (describes the surroundings now and then; type <code>&gt;&gt;</code> or <code>/narrate</code> to ask)</label>
            {planning && <>
              <label>When
                <select value={when} onChange={(e) => setWhen(e.target.value as WhenKind)}>
                  {WHEN_OPTS.map((k) => <option key={k} value={k}>{WHEN_LABELS[k]}{k === "next_free" ? ` (${nextFree})` : ""}</option>)}
                </select>
              </label>
              {when === "at" && <label>Date &amp; time
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
              </label>}
              {preview && <p className="muted">Scheduled for <b>{preview}</b>.</p>}
            </>}
          </>}
        </div>
        <div className="modal-actions">
          {can.ok && !planning && <button className="primary" disabled={!ok || short} onClick={goNow}>Meet up now</button>}
          {can.ok && !planning && <button onClick={() => setPlanning(true)}>Plan for later{"\u2026"}</button>}
          {planning && <button className="primary" disabled={!ready} onClick={submitPlan}>Save plan</button>}
          {!can.ok && !planning && <button className="primary" onClick={() => setPlanning(true)}>Plan for later{"\u2026"}</button>}
          <button onClick={onClose}>{planning || can.ok ? "Cancel" : "Close"}</button>
        </div>
      </div>
    </div>
  );
}

/** Banner at the top of the chat while Together (or paused after the app was closed). */
export function SceneBanner({ scene, name, busy, wrapUp, onEnd, onResume, onStay, onNewBg }: { scene: Scene; name: string; busy: boolean; wrapUp: boolean;
  onEnd: () => void; onResume: () => void; onStay: () => void; onNewBg?: () => void }) {
  const card = sceneCard(scene);
  return (
    <div className={`scene-banner${scene.status === "paused" ? " paused" : ""}`}>
      <span className="scene-where">{card.emoji} <b>{scene.place || "Together"}</b> <small>({scene.activity === "date" ? "date" : "hangout"} with {name}{scene.status === "paused" ? ", paused" : ""})</small>
        <span className="scene-card">{card.tod} {"\u00B7"} {card.time} {"\u00B7"} {card.weather}{scene.narrator !== false ? <> {"\u00B7"} {"\u{1F4D6}"} narrator</> : null}<i>{card.mood}</i></span></span>
      {wrapUp && scene.status === "active" && <span className="scene-wrap">{name} is wrapping up. <button className="link" onClick={onStay} disabled={busy}>Stay a bit longer</button></span>}
      {onNewBg && scene.status === "active" && <button onClick={onNewBg} title="Paint a new background picture for this place">{"\u{1F5BC}\uFE0F"} New background</button>}
      {scene.status === "paused" && <button onClick={onResume} disabled={busy}>Resume</button>}
      <button onClick={onEnd} disabled={busy}>{busy ? "Wrapping up\u2026" : "End scene"}</button>
    </div>
  );
}

/** Pending planned meetup card in the chat (and reusable in What's new). */
export function PlanCard({ plan, c, busy, onStart, onCancel }: { plan: PlannedMeetup; c: Character; busy?: boolean; onStart: () => void; onCancel: () => void }) {
  const ready = canStartPlan(plan, c);
  return (
    <div className={`plan-card${plan.status === "ready" ? " ready" : ""}`}>
      <div className="plan-text">{"\u{1F4C5}"} {plan.status === "ready" ? <b>Ready to meet!</b> : <b>Planned</b>} · {planSummary(plan, c.name)}</div>
      <div className="plan-actions">
        <button className="primary" disabled={!ready || busy} title={!ready ? "Not free yet" : "Start the meet-up"} onClick={onStart}>Start{ready ? "" : " when ready"}</button>
        <button disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Pending planned group outing card in the group chat. */
export function GroupPlanCard({ plan, g, members, busy, onStart, onCancel }: { plan: PlannedMeetup; g: Group; members: Character[]; busy?: boolean; onStart: () => void; onCancel: () => void }) {
  const ready = canStartGroupPlan(plan, members);
  const attendeeNames = (plan.attendeeIds?.length ? members.filter((m) => plan.attendeeIds!.includes(m.id)) : members).map((m) => m.name);
  return (
    <div className={`plan-card${plan.status === "ready" ? " ready" : ""}`}>
      <div className="plan-text">{"\u{1F4C5}"} {plan.status === "ready" ? <b>Ready to meet!</b> : <b>Planned</b>} · {groupPlanSummary(plan, g.name, attendeeNames)}</div>
      <div className="plan-actions">
        <button className="primary" disabled={!ready || busy} title={!ready ? "Wait until members are free" : "Start the group outing"} onClick={onStart}>Start{ready ? "" : " when ready"}</button>
        <button disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export type GroupMeetResult =
  | { mode: "now"; place: string; placeId: string; narrator: boolean; pay: Pay; attendeeIds: string[] }
  | { mode: "plan"; place: string; placeId: string; narrator: boolean; pay: Pay; attendeeIds: string[]; when: WhenKind; at?: string };

export function GroupMeetDialog({ g, members, onDone, onClose, getBalance }: {
  g: Group; members: Character[]; onDone: (r: GroupMeetResult) => void; onClose: () => void; getBalance?: () => Promise<number>;
}) {
  const avail = useMemo(() => canGroupMeetNow(members), [members]);
  const [planning, setPlanning] = useState(!avail.ok);
  const [attendeeIds, setAttendeeIds] = useState<string[]>(() => (avail.ok ? avail.free : members).map((c) => c.id));
  const [placeId, setPlaceId] = useState("");
  const [detail, setDetail] = useState("");
  const [custom, setCustom] = useState("");
  const [narrator, setNarrator] = useState(true);
  const [pay, setPay] = useState<Pay>("me");
  const [balance, setBalance] = useState<number | null>(null);
  const [when, setWhen] = useState<WhenKind>("next_free");
  const [at, setAt] = useState("");
  useEffect(() => { getBalance?.().then(setBalance).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchToPlan = () => {
    setPlanning(true);
    setAttendeeIds(members.map((c) => c.id));
  };
  const toggleMember = (id: string, canNow: boolean) => {
    if (!planning && !canNow) return;
    setAttendeeIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const selectedMembers = members.filter((c) => attendeeIds.includes(c.id));
  const list = placesFor("hangout");
  const nextFree = useMemo(() => formatDue(nextGroupFreeAt(selectedMembers.length ? selectedMembers : members).getTime()), [selectedMembers, members]);
  const preview = useMemo(() => {
    try { return formatDue(resolveGroupWhen(when, selectedMembers.length ? selectedMembers : members, new Date(), at || undefined).getTime()); }
    catch { return ""; }
  }, [when, at, selectedMembers, members]);

  const pl = findPlace(placeId);
  const cost = pl?.cost ?? 0;
  const headcount = Math.max(2, selectedMembers.length + 1);
  const share = groupCostShare(cost, pay, headcount);
  const short = balance !== null && share > balance;
  const treater = selectedMembers.find((c) => canTreat(c));
  const place = placeText(placeId, detail, custom);
  const ok = selectedMembers.length >= 1 && !!placeId && (placeId !== OTHER || !!custom.trim());
  const ready = ok && (when !== "at" || !!at);
  const base = { place, placeId, narrator, pay, attendeeIds: selectedMembers.map((c) => c.id) };
  const goNow = () => { if (ok && !short) onDone({ mode: "now", ...base }); };
  const submitPlan = () => { if (ready) onDone({ mode: "plan", ...base, when, at: at || undefined }); };
  const enter = (e: KeyboardEvent) => { if (e.key === "Enter") { if (planning) submitPlan(); else if (avail.ok) goNow(); } };
  const busyById = new Map(avail.busy.map((b) => [b.c.id, b]));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <div className="modal-title">{"\u{1F4CD}"} Group outing with {g.name}<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="modal-body">
          {!avail.ok && !planning && <>
            <p><b>Everyone in {g.name} is busy or asleep right now.</b></p>
            {avail.busy.map((b) => <p key={b.c.id} className="muted">{b.reason}{b.line ? <> — <i>"{b.line}"</i></> : null}</p>)}
            <p className="muted">You can plan a group hangout for when they're free instead.</p>
          </>}
          {(avail.ok || planning) && <>
            {!avail.ok && <p className="muted"><b>Plan for later</b> · next overlapping free window is {nextFree}.</p>}
            <div className="place-label">{planning ? "Who's coming?" : "Who can make it right now?"}</div>
            <ul className="member-pick">
              {members.map((c) => {
                const b = busyById.get(c.id);
                const checked = attendeeIds.includes(c.id);
                const disabled = !planning && !!b;
                return (
                  <li key={c.id} className={`${checked ? "sel" : ""}${disabled ? " muted" : ""}`} onClick={() => toggleMember(c.id, !b)}>
                    <input type="checkbox" readOnly checked={checked} disabled={disabled} />
                    <Avatar emoji={c.avatar} path={c.avatarPath} color={c.color} /> <b>{c.name}</b>
                    {!planning && b && <small className="muted" style={{ marginLeft: 6 }}>({b.reason.replace(`${c.name} is `, "").replace(/\.$/, "")})</small>}
                  </li>
                );
              })}
            </ul>
            <div className="place-label">Where?</div>
            <div className="place-grid">
              {list.map((p) => (
                <button key={p.id} type="button" className={`place-chip${placeId === p.id ? " on" : ""}`} title={p.ambience} onClick={() => setPlaceId(p.id)}>
                  <span className="pe">{p.emoji}</span> {p.name} <small>{p.cost ? `${p.cost} \u2728` : "free"}</small></button>
              ))}
              <button type="button" className={`place-chip${placeId === OTHER ? " on" : ""}`} onClick={() => setPlaceId(OTHER)}><span className="pe">{"\u270F\uFE0F"}</span> Somewhere else{"\u2026"} <small>free</small></button>
            </div>
            {pl && <p className="muted place-amb">{pl.emoji} {pl.ambience}</p>}
            {placeId === OTHER && <input autoFocus value={custom} maxLength={160} placeholder="e.g. board games and pizza" onChange={(e) => setCustom(e.target.value)} onKeyDown={enter} />}
            {pl && <input value={detail} maxLength={100} placeholder="Details (optional), e.g. big corner booth" onChange={(e) => setDetail(e.target.value)} onKeyDown={enter} />}
            {cost > 0 && <div className="meet-kinds pay">
              <label className="inline"><input type="radio" name="gpay" checked={pay === "me"} onChange={() => setPay("me")} />I'll pay ({cost} {"\u2728"})</label>
              <label className="inline"><input type="radio" name="gpay" checked={pay === "split"} onChange={() => setPay("split")} />Split {headcount} ways ({groupCostShare(cost, "split", headcount)} {"\u2728"} each)</label>
              {treater && <label className="inline"><input type="radio" name="gpay" checked={pay === "them"} onChange={() => setPay("them")} />{treater.name} offered to treat</label>}
            </div>}
            {short && <p className="meet-warn">{planning ? `You'll need ${share} \u2728 when it starts (you have ${balance}).` : `Not enough Sparkles: this needs ${share} \u2728 and you have ${balance}.`} {freeSuggestion("hangout")}</p>}
            <label className="inline narr-toggle"><input type="checkbox" checked={narrator} onChange={(e) => setNarrator(e.target.checked)} />{"\u{1F4D6}"} Narrator (describes the surroundings now and then; type <code>&gt;&gt;</code> or <code>/narrate</code> to ask)</label>
            {planning && <>
              <label>When
                <select value={when} onChange={(e) => setWhen(e.target.value as WhenKind)}>
                  {WHEN_OPTS.map((k) => <option key={k} value={k}>{WHEN_LABELS[k]}{k === "next_free" ? ` (${nextFree})` : ""}</option>)}
                </select>
              </label>
              {when === "at" && <label>Date &amp; time
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
              </label>}
              {preview && <p className="muted">Scheduled for <b>{preview}</b>.</p>}
            </>}
          </>}
        </div>
        <div className="modal-actions">
          {avail.ok && !planning && <button className="primary" disabled={!ok || short} onClick={goNow}>Meet up now</button>}
          {avail.ok && !planning && <button onClick={switchToPlan}>Plan for later{"\u2026"}</button>}
          {planning && <button className="primary" disabled={!ready} onClick={submitPlan}>Save plan</button>}
          {!avail.ok && !planning && <button className="primary" onClick={switchToPlan}>Plan for later{"\u2026"}</button>}
          <button onClick={onClose}>{planning || avail.ok ? "Cancel" : "Close"}</button>
        </div>
      </div>
    </div>
  );
}

/** Scene markers in the chat: start/end lines, narrator text and character invites (Accept / Decline). */
export function MarkerLine({ id, mk, name, time, status, busy, onInvite, line }: { id: string; mk: SceneMarker; name: string; time: string; line: string;
  status?: "pending" | "accepted" | "declined"; busy?: boolean; onInvite: (accept: boolean) => void }) {
  if (mk.phase === "narrate") return <div id={id} className="scene-line narrate"><span className="narr-tag">{"\u{1F4D6}"} Narrator</span> <ActionText text={mk.text ?? ""} /></div>;
  if (mk.phase === "invite") {
    const st = status ?? "pending";
    return (
      <div id={id} className={`plan-card invite-card ${st}`}>
        <div className="plan-text">{line} <small>{time}</small></div>
        {st === "pending" ? <div className="plan-actions">
          <button className="primary" disabled={busy} onClick={() => onInvite(true)}>Accept</button>
          <button disabled={busy} onClick={() => onInvite(false)}>Decline</button>
        </div> : <div className="plan-actions"><i>{st === "accepted" ? "Accepted \u2713 (see the plan below)" : "Declined"}</i></div>}
      </div>
    );
  }
  return <div id={id} className={`scene-line ${mk.phase}`}>{line} <small>{time}</small></div>;
}

/** Soft, blurred and dimmed place picture behind the Together chat (gradient while there's no picture). */
export const dimFor = (strength: number) => Math.min(0.85, Math.max(0.45, 0.85 - Math.max(0, Math.min(100, strength)) * 0.004));
export function SceneBackdrop({ path, gradient, strength = 50 }: { path: string | null; gradient: string; strength?: number }) {
  const src = useDataUrl(path);
  // layout is inline so the layer always exactly covers the (non-scrolling) messages wrapper
  return (
    <div className={`scene-backdrop${src ? " img" : ""}`} aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      <div className="scene-bg-img" style={{ position: "absolute", inset: 0, backgroundImage: src ? `url("${src}")` : gradient, backgroundSize: "cover", backgroundPosition: "center",
        filter: src ? "blur(8px) saturate(.9)" : undefined, transform: src ? "scale(1.08)" : undefined }} />
      <div className="scene-dim" style={{ position: "absolute", inset: 0, opacity: src ? dimFor(strength) : 0.3 }} />
    </div>
  );
}

/** Inventory picker for giving something in person during a scene (supports 1-to-1 and group scenes). */
export function GiftPicker({ name, members, onPick, onClose }: { name: string; members?: Character[]; onPick: (it: Item, target?: Character) => void; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [targetId, setTargetId] = useState<string>(members?.[0]?.id ?? "");
  useEffect(() => { econApi.inventory("me").then((l) => setItems(l.filter(visibleItem))).catch(() => setItems([])); }, []);
  const target = members?.find((m) => m.id === targetId) ?? members?.[0];
  const whoName = target ? target.name : name;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <div className="modal-title">{"\u{1F381}"} Give {whoName} something in person<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="modal-body gift-pick">
          {members && members.length > 1 && (
            <div style={{ marginBottom: 8 }}>
              <div className="place-label">Give to:</div>
              <div className="place-grid">
                {members.map((m) => (
                  <button key={m.id} type="button" className={`place-chip${(target?.id ?? "") === m.id ? " on" : ""}`} onClick={() => setTargetId(m.id)}>
                    <span className="pe">{m.avatar}</span> {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items === null ? <p className="muted">Loading your things{"\u2026"}</p>
            : !items.length ? <p className="muted">You don't have anything to give yet. Buy something in the Sparkles shops first ({"\u{1F3EA}"}).</p>
            : items.map((it) => <button key={it.id} className="gift-pick-row" onClick={() => onPick(it, target)}><span className="pe">{it.emoji}</span> <b>{it.name}</b>{it.qty > 1 ? ` \u00D7${it.qty}` : ""}<small>{it.description}</small></button>)}
        </div>
        <div className="modal-actions"><button onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

/** Options: show place pictures behind the Together chat (kv "scene_backgrounds", on by default). */
export const SCENE_BG_STRENGTH_KEY = "scene_bg_strength";
export function SceneBgOption() {
  const [on, setOn] = useState(true);
  const [strength, setStrength] = useState(50);
  useEffect(() => { econApi.kvGet<boolean>(SCENE_BG_ON_KEY).then((v) => setOn(v !== false)).catch(() => {}); }, []);
  useEffect(() => { econApi.kvGet<number>(SCENE_BG_STRENGTH_KEY).then((v) => { if (typeof v === "number") setStrength(v); }).catch(() => {}); }, []);
  const setS = (v: number) => { setStrength(v); econApi.kvSet(SCENE_BG_STRENGTH_KEY, v).catch(() => {}); window.dispatchEvent(new CustomEvent("scene-bg-strength", { detail: v })); };
  const set = (v: boolean) => { setOn(v); econApi.kvSet(SCENE_BG_ON_KEY, v).catch(() => {}); window.dispatchEvent(new CustomEvent("scene-bg", { detail: v })); };
  return <label className="opt-row inline"><span>{"\u{1F5BC}\uFE0F"} Place pictures behind meet-ups (made once per place with Image Studio; soft colours if it isn't set up)</span>
    <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
    {on && <span className="bg-strength">Picture strength <input type="range" min={0} max={100} value={strength} onChange={(e) => setS(Number(e.target.value))} /></span>}</label>;
}
