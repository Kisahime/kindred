import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { addressedMembers, banterPick, buildGroupTurn, cleanGroupReply, GROUP_EMOJIS, pickResponders } from "./groupchat";
import { detectSelfie, giftForSelfie, logSelfie, selfieNote, selfieSetup, withPrompt } from "./selfie";
import { generateImage, GenParams } from "./imagegen";
import { Lightbox, PhotoBubble } from "./PhotoBubble";
import { PromptDialog } from "./ImageDetails";
import { economyContext } from "./connected";
import { adultFlag, closenessReward, earn, econApi, giftMessage, giftNote, isAdultItem, Item, refreshGifts } from "./economy";
import { adultGiftCheck, adultGiftNote } from "./afterdark";
import { giftFit } from "./mall";
import { evaluateMood, parseJson, selectMemories, summariseGroup } from "./mind";
import { EmojiPicker } from "./EmojiPicker";
import { convertSmileys } from "./emoticons";
import { AltSwitch, EditBox, MsgTools, ReactionChip } from "./MsgTools";
import { streamChat } from "./ollama";
import { lifeApi, markFirstSelfie } from "./life";
import { play } from "./sounds";
import { Character, GIFT, Group, GroupMessage, MOOD_EMOJI, SELFIE, selfieScene, Settings } from "./types";
import {
  closenessAfter, detectWrap, firstMilestone, formatDue, groupPlanPrompt, groupPlanSummary,
  groupSceneLine, groupSceneTranscript, newGroupPlan, newGroupScene, parseSceneMarker,
  PlannedMeetup, resolveGroupWhen, runGroupRecap, Scene, sceneKey, sceneMarker,
} from "./together";
import {
  canTreat, cleanNarration, findPlace, freeSuggestion, groupCostShare, groupFallbackNarration,
  groupNarratorMessages, groupPayLine, narrateCommand, Pay, placeFromText, sceneCard,
  shouldNarrate, turnsSinceNarration,
} from "./places";
import {
  detectGroupScenePhoto, GroupPhotoIntent, groupPhotoNote, groupScenePhotoPrompt,
  IN_PERSON, inPersonGiveNote, scenePhotoParams, scenePhotoPrompt,
} from "./scenephoto";
import { ActionText, GiftPicker, GroupMeetDialog, GroupMeetResult, GroupPlanCard, MarkerLine, SceneBackdrop, SceneBanner } from "./TogetherUI";
import { profile as currentProfile } from "./profile";
import { noteOuting } from "./world";
import { canPicture } from "./protect";

const GROUP_COLORS = ["#f6a5c0", "#7fb8ff", "#b9a3f0", "#9fe3b0", "#ffd27f", "#ff9f8a", "#9fd0f2"];

export function GroupEditor({ initial, chars, onSaved, onDeleted, onClose }: {
  initial: Group; chars: Character[]; onSaved: (g: Group) => void; onDeleted: (id: string) => void; onClose: () => void;
}) {
  const [g, setG] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const isNew = !initial.id;
  const toggle = (id: string) => setG((p) => ({ ...p, memberIds: p.memberIds.includes(id) ? p.memberIds.filter((x) => x !== id) : [...p.memberIds, id] }));
  const save = async () => { try { onSaved(await api.saveGroup(g)); } catch (e) { setErr(String(e)); } };
  const remove = async () => {
    if (!(await ask(`Delete the group "${initial.name}" and its chat history? Your contacts are kept.`, { title: "Delete group", kind: "warning", okLabel: "Delete", cancelLabel: "Keep" }))) return;
    try { await api.deleteGroup(initial.id); onDeleted(initial.id); } catch (e) { setErr(String(e)); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small">
        <div className="modal-title">{isNew ? "New group chat" : `Edit ${initial.name}`}<button className="x" onClick={onClose}>{"\u2715"}</button></div>
        <div className="modal-body">
          <div className="ed-top">
            <Avatar big emoji={g.avatar} color={g.color} />
            <label style={{ flex: 1 }}>Group name<input value={g.name} autoFocus onChange={(e) => setG({ ...g, name: e.target.value })} /></label>
          </div>
          <div className="emoji-row">{GROUP_EMOJIS.map((em) => <button key={em} className={`emoji${g.avatar === em ? " sel" : ""}`} onClick={() => setG({ ...g, avatar: em })}>{em}</button>)}</div>
          <div className="color-row">{GROUP_COLORS.map((col) => <button key={col} className={`swatch${g.color === col ? " sel" : ""}`} style={{ background: col }} onClick={() => setG({ ...g, color: col })} />)}</div>
          <div className="opt-row">Members (pick 2 or more)</div>
          <ul className="member-pick">
            {chars.map((c) => (
              <li key={c.id} className={g.memberIds.includes(c.id) ? "sel" : ""} onClick={() => toggle(c.id)}>
                <input type="checkbox" readOnly checked={g.memberIds.includes(c.id)} /><Avatar emoji={c.avatar} path={c.avatarPath} color={c.color} /> {c.name}
              </li>
            ))}
          </ul>
          {err && <div className="ed-error">{"\u26A0\uFE0F"} {err}</div>}
        </div>
        <div className="modal-actions">
          {!isNew && <button className="danger" onClick={remove}>Delete group</button>}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={g.memberIds.length < 2 || !g.name.trim()}>{isNew ? "Create group" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

interface View extends GroupMessage { key: string; }
const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const temp = (g: Group, speakerId: string, content: string, key: string, sceneId = ""): View =>
  ({ imagePath: null, key, id: -1, groupId: g.id, speakerId, content, createdAt: Date.now(), isError: false, reaction: "", reactorId: null, alternates: [], altIndex: 0, sceneId });

export function GroupPane({ g, chars, me, onEdit, onCharUpdated, onBanner, scene = null, onSceneChange, plans = [], onSavePlans, bg = null, onEnsureBg, onFeedPosted, onOpenMe }: {
  g: Group; chars: Character[]; me: Settings; onEdit: () => void; onCharUpdated: (c: Character) => void; onBanner: (s: string) => void;
  scene?: Scene | null; onSceneChange?: (s: Scene | null) => void;
  plans?: PlannedMeetup[]; onSavePlans?: (fn: (prev: PlannedMeetup[]) => PlannedMeetup[]) => Promise<void>;
  bg?: { path: string | null; gradient: string; strength: number } | null;
  onEnsureBg?: (c: Character, s: Scene, force: boolean) => void;
  onFeedPosted?: () => void; onOpenMe?: () => void;
}) {
  const [msgs, setMsgsState] = useState<View[]>([]);
  const [draft, setDraft] = useState("");
  const [typingId, setTypingId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<View | null>(null);
  const [promptOf, setPromptOf] = useState<View | null>(null);
  const [meetOpen, setMeetOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [wrapUp, setWrapUp] = useState(false);
  const [ending, setEnding] = useState(false);
  const stop = useRef(false);
  const alive = useRef(true);
  const msgsRef = useRef<View[]>([]);
  const sceneRef = useRef<Scene | null>(scene); sceneRef.current = scene;
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const summarising = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const show = (t: string) => me.emoticons ? convertSmileys(t) : t;
  const members = g.memberIds.map((id) => chars.find((c) => c.id === id)).filter(Boolean) as Character[];
  const membersRef = useRef(members); membersRef.current = members;
  const together = scene?.status === "active";
  const attendees = useMemo(() => {
    if (scene?.attendeeIds?.length) {
      const picked = members.filter((m) => scene.attendeeIds!.includes(m.id));
      if (picked.length) return picked;
    }
    return members;
  }, [scene, members]);
  const attendeesRef = useRef(attendees); attendeesRef.current = attendees;
  const activeMembers = together ? attendees : members;
  const hasLook = !!currentProfile()?.fields.photoLook?.value.trim();

  /** Single source of truth for the shown list and the model history (temp bubbles have id -1). */
  const setMsgs = (f: (p: View[]) => View[]) => { msgsRef.current = f(msgsRef.current); if (alive.current) setMsgsState(msgsRef.current); };
  const history = () => msgsRef.current.filter((m) => m.id > 0);
  const toView = (m: GroupMessage): View => ({ ...m, key: `db${m.id}` });
  const push = (m: GroupMessage) => setMsgs((p) => [...p, toView(m)]);
  const patch = (key: string, x: Partial<View>) => setMsgs((p) => p.map((m) => m.key === key ? { ...m, ...x } : m));

  useEffect(() => {
    alive.current = true;
    api.listGroupMessages(g.id).then((m) => setMsgs(() => m.map(toView))).catch((e) => onBanner(String(e)));
    return () => { alive.current = false; stop.current = true; clearTimeout(idleTimer.current); };
  }, [g.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typingId]);

  const saveGroupScene = async (s: Scene | null) => {
    if (s) await econApi.kvSet(sceneKey(g.id), s);
    sceneRef.current = s && s.status !== "ended" ? s : null;
    onSceneChange?.(sceneRef.current);
  };

  /** Narrator line in the group scene. */
  const narrateGroup = async (s: Scene, hint: string, opening: boolean): Promise<GroupMessage | null> => {
    const card = sceneCard(s);
    const att = attendeesRef.current.length ? attendeesRef.current : membersRef.current;
    const names = att.map((c) => c.name);
    const list = history().filter((m) => m.sceneId === s.id && !m.isError);
    let text = "";
    const leadModel = att[0]?.model ?? membersRef.current[0]?.model ?? "";
    if (leadModel) {
      try {
        text = cleanNarration(parseJson(await api.ollamaJson(leadModel, groupNarratorMessages(card, me.userName, names, groupSceneTranscript(list, membersRef.current, me.userName, 1500), hint, opening), 0.8)));
      } catch (e) { console.warn("[group narrator]", e); }
    }
    if (!text) text = groupFallbackNarration(card, names, opening);
    const saved = await api.addGroupMessage(g.id, null, sceneMarker({ phase: "narrate", id: s.id, place: s.place, activity: "hangout", text }));
    push(saved);
    return saved;
  };

  /** Background: fold the group chat into each member's memories, one member at a time. */
  const remember = async (idle: boolean) => {
    if (summarising.current) return;
    summarising.current = true;
    try {
      for (const c of membersRef.current) {
        const r = await summariseGroup(c, g, membersRef.current, me.userName, idle).catch((e) => { console.warn(`[group memory] ${c.name}`, e); return null; });
        if (r) console.info(`[group memory] ${c.name}: +${r.added} from ${g.name} (upto #${r.upto})`);
      }
    } finally { summarising.current = false; }
  };

  /** Streams one character's line given `hist`; into a new temp bubble or replacing `replaceKey`. */
  const generate = async (c: Character, hist: GroupMessage[], replaceKey?: string, note?: string) => {
    const key = replaceKey ?? `t${Date.now()}${c.id}`;
    let started = false;
    const memories = selectMemories(await api.listMemories(c.id).catch(() => []));
    const curScene = sceneRef.current;
    const isTogether = curScene?.status === "active";
    const att = isTogether ? (attendeesRef.current.length ? attendeesRef.current : membersRef.current) : membersRef.current;
    const extra = [economyContext(c, me.userName, { group: true }), !isTogether ? groupPlanPrompt(plans, g.name, me.userName) : ""].filter(Boolean).join("\n\n");
    const togetherOpt = isTogether && curScene ? { scene: curScene, card: sceneCard(curScene), attendees: att } : undefined;
    const turn = buildGroupTurn(c, g, membersRef.current, hist, me.userName, memories, new Date(), extra, togetherOpt);
    if (note) turn.push({ role: "system", content: note });
    const raw = await streamChat(c.model, turn, {
      onToken: (tok) => {
        const first = !started; started = true;
        if (first && !replaceKey) setMsgs((p) => [...p, temp(g, c.id, tok, key, isTogether ? curScene!.id : "")]);
        else setMsgs((p) => p.map((m) => m.key === key ? { ...m, content: (first ? "" : m.content) + tok } : m));
      },
    });
    const cleaned = cleanGroupReply(raw, c, membersRef.current, me.userName);
    if (isTogether) {
      const w = detectWrap(cleaned);
      if (w.ended && alive.current) setWrapUp(true);
      return { key, text: w.text };
    }
    return { key, text: cleaned };
  };

  const speak = async (c: Character, userMsg: GroupMessage | null, note?: string) => {
    if (alive.current) setTypingId(c.id);
    let key = "";
    try {
      const r = await generate(c, history(), undefined, note); key = r.key;
      setMsgs((p) => p.filter((m) => m.key !== r.key));
      if (!r.text) return;
      push(await api.addGroupMessage(g.id, c.id, r.text));
      play("received");
      if (userMsg) evaluateMood(c, me.userName, userMsg.content, r.text).then(({ character, reaction }) => {
        onCharUpdated(character);
        const target = msgsRef.current.find((m) => m.id === userMsg.id);
        if (reaction && target && !target.reaction) { api.setGroupReaction(userMsg.id, reaction, c.id).catch(() => {}); patch(target.key, { reaction, reactorId: c.id }); }
      }).catch((e) => console.warn("[group mood]", e));
    } catch (e) {
      if (key) setMsgs((p) => p.filter((m) => m.key !== key));
      setMsgs((p) => p.filter((m) => m.id > 0 || m.speakerId !== c.id));
      push(await api.addGroupMessage(g.id, c.id, `\u26A0\uFE0F ${e instanceof Error ? e.message : e}`, true));
    } finally { if (alive.current) setTypingId(null); }
  };

  /** Responders (+ maybe a selfie/scene photo, + maybe banter) answer the user's message `userMsg`. */
  const runTurn = async (userMsg: GroupMessage) => {
    stop.current = false; setRunning(true);
    try {
      const curScene = sceneRef.current;
      const inGroupScene = curScene?.status === "active";
      const live = inGroupScene && attendeesRef.current.length ? attendeesRef.current : membersRef.current;
      if (live.length === 0) return;

      if (inGroupScene && curScene) {
        const snap = detectGroupScenePhoto(userMsg.content, live);
        const target = snap?.kind === "member" ? snap.target : addressedMembers(userMsg.content, live)[0];
        let responders = await pickResponders(live, userMsg.content, history(), me.userName, api.ollamaJson);
        if (snap?.kind === "member" && target) responders = [target, ...responders.filter((x) => x.id !== target.id)];
        const pNote = snap ? groupPhotoNote(me.userName, snap.kind === "group" && snap.includeUser, snap.kind === "member" ? snap.target.name : undefined) : undefined;
        const spoke: Character[] = [];
        for (const c of responders) {
          if (stop.current) break;
          await speak(c, userMsg, snap && c.id === responders[0]?.id ? pNote : undefined);
          spoke.push(c);
        }
        const extra = !stop.current ? banterPick(live, spoke) : null;
        if (extra) await speak(extra, userMsg);
        if (snap && !stop.current) await takeGroupScenePhoto(curScene, snap, userMsg.content);
        const scNow = sceneRef.current;
        if (scNow?.status === "active" && !stop.current) {
          const sceneMsgs = history().filter((x) => x.sceneId === scNow.id).map((x) => ({ from: (x.speakerId ? "them" : "me") as "me" | "them", text: x.content }));
          const nTurns = turnsSinceNarration(sceneMsgs, (t) => parseSceneMarker(t)?.phase === "narrate", (t) => !!parseSceneMarker(t));
          if (shouldNarrate(nTurns, scNow.narrator)) await narrateGroup(scNow, "", false).catch((e) => console.warn("[group narrator]", e));
        }
      } else {
        // a selfie request goes to the member it names
        const target = addressedMembers(userMsg.content, live)[0];
        const intent = target && canPicture(target) ? await detectSelfie(target, me.userName, userMsg.content).catch(() => ({ selfie: false, scene: "" })) : { selfie: false, scene: "" };
        const setup = intent.selfie && target ? await selfieSetup(target) : null;
        const ready = setup && "params" in setup ? setup.params : null;
        let responders = await pickResponders(live, userMsg.content, history(), me.userName, api.ollamaJson);
        if (setup && target) responders = [target, ...responders.filter((x) => x.id !== target.id)];
        const spoke: Character[] = [];
        for (const c of responders) {
          if (stop.current) break;
          await speak(c, userMsg, setup && c.id === target?.id ? selfieNote(me.userName, !!ready) : undefined); spoke.push(c);
        }
        if (ready && target && !stop.current) await groupSelfie(target, intent.scene, ready);
        else if (setup && "reason" in setup) onBanner(`${target!.name} can't send pictures yet: ${setup.reason}. Pick a working model in Image Studio (\u{1F3A8}).`);
        const extra = !stop.current ? banterPick(live, spoke) : null;
        if (extra) await speak(extra, userMsg);
      }
      remember(false);
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => remember(true), 5 * 60_000);
    } catch (e) { onBanner(String(e)); }
    finally { if (alive.current) setRunning(false); }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    const curScene = sceneRef.current;
    if (curScene?.status === "active") {
      const nc = narrateCommand(text);
      if (nc) {
        setRunning(true);
        try { await narrateGroup(curScene, nc.hint, false); } catch (e) { onBanner(`Narrator: ${e instanceof Error ? e.message : e}`); }
        finally { if (alive.current) setRunning(false); }
        return;
      }
    }
    try {
      const m = await api.addGroupMessage(g.id, null, text);
      push(m); play("sent");
      await runTurn(m);
    } catch (e) { onBanner(String(e)); }
  };

  // ---- Group Together mode orchestration ----
  const startGroupScene = async (place: string, attendeeIds: string[], opts: { placeId?: string; narrator?: boolean; pay?: Pay } = {}): Promise<boolean> => {
    setMeetOpen(false);
    const att = membersRef.current.filter((m) => attendeeIds.includes(m.id));
    const chosen = att.length ? att : membersRef.current;
    if (!chosen.length) return false;
    const pl = findPlace(opts.placeId) ?? placeFromText(place);
    const cost = pl?.cost ?? 0, pay: Pay = opts.pay ?? "me";
    const headcount = Math.max(2, chosen.length + 1);
    const share = groupCostShare(cost, pay, headcount);
    if (share > 0) {
      const bal = await econApi.balance().catch(() => 0);
      if (bal < share) {
        onBanner(`Not enough Sparkles for the ${pl!.name.toLowerCase()}: your share is ${share} \u2728 and you have ${bal}. ${freeSuggestion("hangout")}`);
        return false;
      }
    }
    const s = newGroupScene(g.id, chosen.map((c) => c.id), place, Date.now(), { placeId: pl?.id, narrator: opts.narrator !== false, paid: share });
    setRunning(true);
    try {
      await saveGroupScene(s);
      attendeesRef.current = chosen;
      if (share > 0) await earn(-share, "meetup", `${pl!.name} hangout with ${g.name}${pay === "split" ? " (split)" : ""}`).catch(() => {});
      setWrapUp(false);
      const saved = await api.addGroupMessage(g.id, null, sceneMarker({ phase: "start", id: s.id, place: s.place, activity: "hangout", attendeeIds: s.attendeeIds }));
      push(saved);
      if (s.narrator !== false) await narrateGroup(s, "", true).catch((e) => console.warn("[group narrator]", e));
      const treater = chosen.find((c) => canTreat(c));
      const paid = groupPayLine(pay, cost, me.userName, (treater ?? chosen[0])?.name);
      const greeters = chosen.slice(0, 2);
      for (const c of greeters) {
        if (stop.current) break;
        await speak(c, null, `(You've just met up in person with ${me.userName} and the others at ${s.place || "the meeting spot"}.${paid ? ` ${paid}` : ""} Greet everyone face to face: one action in *asterisks* and a short line of speech.)`);
      }
      onEnsureBg?.(chosen[0], s, false);
      return true;
    } catch (e) {
      onBanner(`Could not start the group outing: ${e instanceof Error ? e.message : e}`);
      return false;
    } finally { if (alive.current) setRunning(false); }
  };

  const resumeGroupScene = async () => {
    const s = sceneRef.current;
    if (!s) return;
    const next: Scene = { ...s, status: "active" };
    await saveGroupScene(next).catch((e) => onBanner(String(e)));
    const lead = attendeesRef.current[0] ?? membersRef.current[0];
    if (lead) onEnsureBg?.(lead, next, false);
  };

  const endGroupScene = async () => {
    const s = sceneRef.current;
    if (!s || ending) return;
    setEnding(true); setRunning(true);
    try {
      const att = attendeesRef.current.length ? attendeesRef.current : membersRef.current;
      const list = history().filter((m) => m.sceneId === s.id && !m.isError);
      const transcript = groupSceneTranscript(list, membersRef.current, me.userName);
      const r = await runGroupRecap(g.name, att, me.userName, s, transcript, api.ollamaJson, parseJson).catch((e) => { console.warn("[group recap]", e); return null; });
      await saveGroupScene({ ...s, status: "ended" });
      const saved = await api.addGroupMessage(g.id, null, sceneMarker({ phase: "end", id: s.id, place: s.place, activity: "hangout", recap: r?.recap, attendeeIds: s.attendeeIds }));
      push(saved);
      setWrapUp(false);
      if (!r) { onBanner("The group outing ended, but the recap couldn't be written."); return; }
      noteOuting(att, s.place, r.recap).catch((e) => console.warn("[relations]", e));
      const day = new Date().toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
      for (const c of att) {
        const mr = r.members[c.id];
        if (mr?.memory) api.addMemory(c.id, `${day}: ${mr.memory}`, false, "meetup").catch(() => {});
        const first = firstMilestone("hangout", c.name);
        lifeApi.addMilestone(c.id, first.kind, first.title, s.place, null, true).catch(() => {});
        if (mr) {
          api.setMood(c.id, mr.mood ?? c.mood, closenessAfter(c.closeness, mr.rating)).then(onCharUpdated).catch(() => {});
        }
      }
      if (r.post && r.posterId) {
        lifeApi.addFeedPost(r.posterId, r.post).then(() => onFeedPosted?.()).catch(() => {});
      }
    } catch (e) { onBanner(`Could not end the group outing: ${e instanceof Error ? e.message : e}`); }
    finally { if (alive.current) { setEnding(false); setRunning(false); } }
  };

  const createGroupPlan = async (r: Extract<GroupMeetResult, { mode: "plan" }>) => {
    const picked = membersRef.current.filter((m) => r.attendeeIds.includes(m.id));
    const due = resolveGroupWhen(r.when, picked.length ? picked : membersRef.current, new Date(), r.at).getTime();
    const p = newGroupPlan(g.id, r.attendeeIds, r.place, r.when, due, Date.now(), { placeId: r.placeId, narrator: r.narrator, pay: r.pay });
    await onSavePlans?.((prev) => [p, ...prev]);
    const names = (picked.length ? picked : membersRef.current).map((m) => m.name);
    for (const c of (picked.length ? picked : membersRef.current)) {
      api.addMemory(c.id, `Planned a group hangout (${g.name}: ${names.join(", ")}) with ${me.userName}: ${p.place} (${formatDue(due)}).`, false, "meetup").catch(() => {});
    }
  };

  const startGroupPlan = async (p: PlannedMeetup) => {
    if (sceneRef.current && sceneRef.current.status !== "ended") { onBanner(`You're already in an outing with ${g.name}.`); return; }
    const ids = p.attendeeIds?.length ? p.attendeeIds : membersRef.current.map((m) => m.id);
    if (!(await startGroupScene(p.place, ids, { placeId: p.placeId, narrator: p.narrator, pay: p.pay }))) return;
    await onSavePlans?.((prev) => prev.map((x) => x.id === p.id ? { ...x, status: "started" } : x));
  };

  const cancelGroupPlan = async (p: PlannedMeetup) => {
    await onSavePlans?.((prev) => prev.map((x) => x.id === p.id ? { ...x, status: "cancelled" } : x));
  };

  const onGroupMeetDone = async (r: GroupMeetResult) => {
    setMeetOpen(false);
    try {
      if (r.mode === "now") await startGroupScene(r.place, r.attendeeIds, { placeId: r.placeId, narrator: r.narrator, pay: r.pay });
      else await createGroupPlan(r);
    } catch (e) { onBanner(String(e)); }
  };

  const takeGroupScenePhoto = async (s: Scene, intent: GroupPhotoIntent, text = "") => {
    const att = attendeesRef.current.length ? attendeesRef.current : membersRef.current;
    const lead = intent.kind === "member" ? intent.target : (att[0] ?? membersRef.current[0]);
    if (!lead || photoId) return;
    const look = currentProfile()?.fields.photoLook?.value ?? "";
    if (intent.kind === "group" && intent.includeUser && !look.trim()) {
      onBanner(`For group photos with you in them, add "My appearance for photos" in your profile (click your picture, top left). Taking one of the group for now.`);
    }
    const setup = await selfieSetup(lead, "place"); // only engine settings here; who may be in the picture is decided by the photo builders (protected characters never are)
    if ("reason" in setup) {
      onBanner(`${lead.name} can't take photos yet: ${setup.reason}. Pick a working model in Image Studio (\u{1F3A8}).`);
      return;
    }
    const card = { ...sceneCard(s), placeId: s.placeId };
    const gift = intent.kind === "member" && text ? giftForSelfie(intent.target, [text]) : undefined;
    const shot = intent.kind === "member"
      ? scenePhotoPrompt(intent.target, card, false, "", new Date(), gift?.item ? gift : undefined)
      : groupScenePhotoPrompt(att, card, intent.includeUser, look, new Date());
    if (alive.current) setPhotoId(lead.id);
    try {
      logSelfie(lead, shot, gift?.item ? { item: gift.item, allowed: shot.worn } : undefined).catch(() => {});
      const rows = await generateImage(scenePhotoParams(setup.params, lead, shot), () => {});
      if (!rows[0]) throw new Error("no picture came back");
      const m = await api.addGroupMessage(g.id, lead.id, `${SELFIE} ${shot.caption}`);
      await api.setGroupMessageImage(m.id, rows[0].path);
      markFirstSelfie(lead);
      push({ ...m, imagePath: rows[0].path }); play("received");
    } catch (e) { onBanner(`The photo didn't work: ${e instanceof Error ? e.message : e}`); }
    finally { if (alive.current) setPhotoId(null); }
  };

  const groupScenePhotoButton = async (intent: GroupPhotoIntent) => {
    const s = sceneRef.current;
    if (!s || running || photoId) return;
    const att = attendeesRef.current.length ? attendeesRef.current : membersRef.current;
    const speaker = intent.kind === "member" ? intent.target : (att[0] ?? membersRef.current[0]);
    if (!speaker) return;
    setRunning(true);
    try {
      const note = groupPhotoNote(me.userName, intent.kind === "group" && intent.includeUser, intent.kind === "member" ? intent.target.name : undefined);
      await speak(speaker, null, note);
      await takeGroupScenePhoto(s, intent);
    } finally { if (alive.current) setRunning(false); }
  };

  const giveGroupInPerson = async (target: Character, it: Item) => {
    setGiftOpen(false);
    const adultGift = isAdultItem(it);
    if (adultGift) {
      const chk = adultGiftCheck(target, adultFlag());
      if (!chk.ok) { onBanner(chk.reason); return; }
      if (chk.warning && !(await ask(chk.warning, { title: "Send 18+ gift", kind: "warning", okLabel: "Give anyway", cancelLabel: "Cancel" }))) return;
    } else {
      const fit = giftFit(target, it, me.userName);
      if (fit.warning && !(await ask(fit.warning, { title: "Give gift", kind: "warning", okLabel: "Give anyway", cancelLabel: "Cancel" }))) return;
    }
    setRunning(true);
    try {
      const given = await econApi.gift(it.id, target.id);
      await refreshGifts().catch(() => {});
      const saved = await api.addGroupMessage(g.id, target.id, giftMessage(given) + IN_PERSON);
      push(saved); play("sent");
      api.addMemory(target.id, `${me.userName} gave ${target.name} a gift in person during a ${g.name} outing on ${new Date().toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}: ${given.emoji} ${given.name}.`, false, "gift").catch(() => {});
      api.setMood(target.id, target.mood, Math.min(100, target.closeness + 2)).then((x) => { onCharUpdated(x); closenessReward(x).catch(() => {}); }).catch(() => {});
      const note = `${giftNote(target, given, me.userName)} ${adultGift ? adultGiftNote(target, me.userName) : giftFit(target, given, me.userName).note} ${inPersonGiveNote(me.userName, target.name)}`;
      await speak(target, null, note);
    } catch (e) { onBanner(String(e)); }
    finally { if (alive.current) setRunning(false); }
  };

  const groupSelfie = async (c: Character, scene: string, params: GenParams) => {
    if (alive.current) setPhotoId(c.id);
    try {
      const rows = await generateImage(withPrompt(params, chars.find((x) => x.id === c.id) ?? c, scene), () => {});
      if (!rows[0]) throw new Error("no picture came back");
      const m = await api.addGroupMessage(g.id, c.id, `${SELFIE} ${scene}`.trim());
      await api.setGroupMessageImage(m.id, rows[0].path);
      markFirstSelfie(c);
      push({ ...m, imagePath: rows[0].path }); play("received");
    } catch (e) { onBanner(`${c.name}'s photo didn't work: ${e instanceof Error ? e.message : e}`); }
    finally { if (alive.current) setPhotoId(null); }
  };
  const retake = async (m: View) => {
    const c = chars.find((x) => x.id === m.speakerId);
    if (!c || photoId) return;
    const setup = await selfieSetup(c);
    if ("reason" in setup) { onBanner(`Can't take another: ${setup.reason}.`); return; }
    setPhotoId(c.id);
    try {
      const rows = await generateImage(withPrompt({ ...setup.params, seed: -1 }, c, selfieScene(m.content)), () => {});
      if (!rows[0]) throw new Error("no picture came back");
      await api.setGroupMessageImage(m.id, rows[0].path);
      patch(m.key, { imagePath: rows[0].path });
      setLightbox((l) => l && l.key === m.key ? { ...l, imagePath: rows[0].path } : l);
    } catch (e) { onBanner(`Retake failed: ${e instanceof Error ? e.message : e}`); }
    finally { if (alive.current) setPhotoId(null); }
  };
  const asAvatar = async (m: View) => {
    const c = chars.find((x) => x.id === m.speakerId);
    if (!c || !m.imagePath) return;
    try { const p = await api.importAvatar(m.imagePath); onCharUpdated(await api.saveCharacter({ ...c, avatarPath: p })); onBanner(`${c.name} now uses that photo as their avatar.`); }
    catch (e) { onBanner(String(e)); }
  };

  // ---- message actions ----
  const react = (m: View, emoji: string) => {
    const r = m.reaction === emoji && !m.reactorId ? "" : emoji;
    api.setGroupReaction(m.id, r, null).catch(() => {});
    patch(m.key, { reaction: r, reactorId: null });
  };
  const remove = async (m: View) => {
    if (!(await ask("Delete this message? This can't be undone.", { title: "Delete message", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" }))) return;
    await api.deleteGroupMessage(m.id).catch((e) => onBanner(String(e)));
    setMsgs((p) => p.filter((x) => x.key !== m.key));
  };
  const regenerate = async (m: View) => {
    const c = m.speakerId ? chars.find((x) => x.id === m.speakerId) : null;
    if (!c || running) return;
    const i = msgsRef.current.findIndex((x) => x.key === m.key);
    setRunning(true); setTypingId(c.id);
    try {
      const r = await generate(c, msgsRef.current.slice(0, i).filter((x) => x.id > 0), m.key);
      if (!r.text) throw new Error("empty reply");
      const alts = [...(m.alternates.length ? m.alternates : [m.content]), r.text];
      const s = await api.updateGroupMessage(m.id, r.text, alts, alts.length - 1);
      patch(m.key, { content: s.content, alternates: s.alternates, altIndex: s.altIndex, isError: false });
      play("received");
    } catch (e) { patch(m.key, { content: m.content }); onBanner(`Could not regenerate: ${e instanceof Error ? e.message : e}`); }
    finally { if (alive.current) { setRunning(false); setTypingId(null); } }
  };
  const swipe = async (m: View, d: number) => {
    const idx = m.altIndex + d;
    if (idx < 0 || idx >= m.alternates.length) return;
    const s = await api.updateGroupMessage(m.id, m.alternates[idx], m.alternates, idx).catch((e) => { onBanner(String(e)); return null; });
    if (s) patch(m.key, { content: s.content, altIndex: s.altIndex });
  };
  const edit = async (m: View, text: string) => {
    if (running) return;
    const s = await api.updateGroupMessage(m.id, text).catch((e) => { onBanner(String(e)); return null; });
    if (!s) return;
    const i = msgsRef.current.findIndex((x) => x.key === m.key);
    const after = msgsRef.current.slice(i + 1);
    patch(m.key, { content: s.content, reaction: "", reactorId: null });
    if (after.every((x) => x.speakerId)) {
      if (after.length && !(await ask("Let the group answer your edited message again?", { title: "Edit message", okLabel: "Regenerate", cancelLabel: "Keep replies" }))) return;
      await api.deleteGroupMessagesAfter(g.id, m.id).catch(() => {});
      setMsgs((p) => p.slice(0, i + 1));
      await runTurn({ ...s });
    }
  };

  const clear = async () => {
    if (!(await ask(`Clear the whole "${g.name}" group chat?`, { title: "Clear group chat", kind: "warning", okLabel: "Clear", cancelLabel: "Cancel" }))) return;
    await api.clearGroupMessages(g.id).catch((e) => onBanner(String(e)));
    setMsgs(() => []);
  };

  const byId = new Map(chars.map((c) => [c.id, c]));
  const typingChar = typingId ? byId.get(typingId) : null;
  const last = msgs[msgs.length - 1];
  const bannerLabel = together ? `${g.name}: ${attendees.map((c) => c.name).join(", ")}` : g.name;
  return (
    <>
      <header className="chat-head">
        <Avatar big emoji={g.avatar} color={g.color} />
        <div className="ch-info">
          <div className="ch-name">{g.name} <span className="ch-status">({members.length + 1} people)</span></div>
          <div className="group-members">{members.map((c) => <span key={c.id} title={`${c.name} \u00B7 ${c.mood}`}><Avatar emoji={c.avatar} path={c.avatarPath} color={c.color} />{c.name} {MOOD_EMOJI[c.mood]}</span>)}</div>
          <div className="ch-actions">
            {!scene && <button className="link" onClick={() => setMeetOpen(true)} disabled={running}>{"\u{1F4CD}"} Meet up</button>}
            <button className="link" onClick={onEdit}>Edit group</button>
            <button className="link" onClick={clear} disabled={running}>Clear chat</button>
            <button className="link" onClick={() => remember(true)} title="Fold this group chat into each member's memories now">Remember now</button>
          </div>
        </div>
      </header>
      {scene && (
        <SceneBanner
          scene={scene}
          name={bannerLabel}
          busy={ending || running}
          wrapUp={wrapUp}
          onEnd={endGroupScene}
          onResume={resumeGroupScene}
          onStay={() => setWrapUp(false)}
          onNewBg={bg && (attendees[0] ?? members[0]) ? () => {
            onBanner("Painting a new picture of this place\u2026 it appears when it's ready.");
            onEnsureBg?.(attendees[0] ?? members[0], scene, true);
          } : undefined}
        />
      )}
      <div className="msg-wrap" style={{ position: "relative" }}>
        {together && bg && <SceneBackdrop path={bg.path} gradient={bg.gradient} strength={bg.strength} />}
        <div className={`messages${together ? " together" : ""}${together && bg ? " has-bg" : ""}`}>
          {msgs.map((m) => {
            const mk = parseSceneMarker(m.content);
            if (mk) {
              const attNames = (mk.attendeeIds?.length ? mk.attendeeIds.map((id) => byId.get(id)?.name).filter(Boolean) as string[] : attendees.map((c) => c.name));
              return (
                <MarkerLine
                  key={m.key}
                  id={`msg-${m.key}`}
                  mk={mk}
                  name={g.name}
                  line={groupSceneLine(mk, g.name, attNames)}
                  time={fmt(m.createdAt)}
                  busy={running}
                  onInvite={() => {}}
                />
              );
            }
            const c = m.speakerId ? byId.get(m.speakerId) : null;
            const isGift = m.content.startsWith(GIFT);
            const mine = !m.speakerId || isGift;
            const reactor = m.reaction ? (m.reactorId ? byId.get(m.reactorId)?.name : "You") : undefined;
            return (
              <div key={m.key} className={`bubble-row ${mine ? "mine" : "theirs"}${m.isError ? " error" : ""}${m.sceneId ? " in-scene" : ""} group-row`}>
                {!mine && <Avatar emoji={c?.avatar ?? "\u{1F464}"} path={c?.avatarPath} color={c?.color} />}
                <div className="bubble">
                  {m.id > 0 && editingKey !== m.key && <MsgTools mine={mine} reaction={m.reactorId ? undefined : m.reaction} busy={running}
                    onReact={!mine && !m.isError ? (e) => react(m, e) : undefined}
                    canRegen={!mine && m === last && !!c} onRegen={() => m.imagePath ? retake(m) : regenerate(m)}
                    canEdit={mine && !isGift && !m.imagePath} onEdit={() => setEditingKey(m.key)} onDelete={() => remove(m)} />}
                  <div className="b-meta"><b style={{ color: mine ? undefined : c?.color }}>{mine ? "You" : c?.name ?? "Former member"}</b> {"\u00B7"} {fmt(m.createdAt)}
                    <AltSwitch index={m.altIndex} count={m.alternates.length} disabled={running} onSwipe={(d) => swipe(m, d)} /></div>
                  {isGift ? (
                    <div className="b-text gift-bubble">{"\u{1F381}"} You gave {c?.name ?? "a friend"} {m.content.slice(GIFT.length).trim()}</div>
                  ) : m.imagePath ? <PhotoBubble path={m.imagePath} caption={selfieScene(m.content)} onOpen={() => setLightbox(m)} onInfo={() => setPromptOf(m)} />
                    : editingKey === m.key
                    ? <EditBox initial={m.content} onCancel={() => setEditingKey(null)} onSave={(t) => { setEditingKey(null); edit(m, t); }} />
                    : <div className="b-text">{m.isError ? m.content : <ActionText text={show(m.content)} />}</div>}
                  <ReactionChip emoji={m.reaction} by={reactor} />
                </div>
              </div>
            );
          })}
          {!scene && plans.map((p) => (
            <GroupPlanCard key={p.id} plan={p} g={g} members={members} busy={running} onStart={() => startGroupPlan(p)} onCancel={() => cancelGroupPlan(p)} />
          ))}
          {typingChar && <div className="typing">{typingChar.name} is typing<span className="dots"><i/><i/><i/></span></div>}
          {photoId && <div className="typing">{"\u{1F4F7}"} {byId.get(photoId)?.name} is taking a photo<span className="dots"><i/><i/><i/></span></div>}
          {promptOf?.imagePath && <PromptDialog path={promptOf.imagePath} adult={adultFlag()} charName={byId.get(promptOf.speakerId ?? "")?.name} onClose={() => setPromptOf(null)} />}
          {lightbox?.imagePath && <Lightbox path={lightbox.imagePath} title={`${byId.get(lightbox.speakerId ?? "")?.name ?? "group"} selfie`} busy={!!photoId}
            onClose={() => setLightbox(null)} onAvatar={() => asAvatar(lightbox)} onRegen={() => retake(lightbox)} />}
          <div ref={endRef} />
        </div>
      </div>
      <div className="composer">
        <EmojiPicker target={taRef} value={draft} onChange={setDraft} />
        <textarea ref={taRef} value={draft}
          placeholder={together ? `Say or do something with ${g.name}\u2026 (*actions* in asterisks)` : `Message ${g.name}\u2026 (mention a name to ask someone directly)`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="composer-buttons">
          {running
            ? <button className="stop" onClick={() => { stop.current = true; }} title="Stop after the current reply">Stop</button>
            : <button onClick={send} disabled={!draft.trim()}>Send</button>}
          {together && (
            <span className="scene-tools">
              <button className="camera-btn" onClick={() => setPhotoMenu((x) => !x)} disabled={running || !!photoId} title="Take a photo here">{"\u{1F4F7}"}</button>
              <button className="gift-btn" onClick={() => setGiftOpen(true)} disabled={running} title="Give someone in the group a gift in person">{"\u{1F381}"}</button>
              {photoMenu && (
                <div className="photo-menu">
                  <button onClick={() => { setPhotoMenu(false); groupScenePhotoButton({ kind: "group", includeUser: false }); }}>
                    {"\u{1F4F8}"} Group photo ({activeMembers.filter(canPicture).map((m) => m.name).join(", ") || "just the place"})
                  </button>
                  {hasLook ? (
                    <button onClick={() => { setPhotoMenu(false); groupScenePhotoButton({ kind: "group", includeUser: true }); }}>
                      {"\u{1F46F}"} Group photo with me
                    </button>
                  ) : (
                    <button onClick={() => { setPhotoMenu(false); onOpenMe?.(); }} title="Add 'My appearance for photos' in your profile first">
                      {"\u{1F46F}"} With me: add your look first{"\u2026"}
                    </button>
                  )}
                  {activeMembers.filter(canPicture).map((m) => (
                    <button key={m.id} onClick={() => { setPhotoMenu(false); groupScenePhotoButton({ kind: "member", target: m }); }}>
                      {"\u{1F4F7}"} Photo of {m.name}
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
      </div>
      {meetOpen && <GroupMeetDialog g={g} members={members} getBalance={() => econApi.balance()} onDone={onGroupMeetDone} onClose={() => setMeetOpen(false)} />}
      {giftOpen && <GiftPicker name={g.name} members={activeMembers} onPick={(it, target) => giveGroupInPerson(target ?? activeMembers[0], it)} onClose={() => setGiftOpen(false)} />}
    </>
  );
}
