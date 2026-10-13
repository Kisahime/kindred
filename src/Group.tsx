import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { addressedMembers, banterPick, buildGroupTurn, cleanGroupReply, GROUP_EMOJIS, pickResponders } from "./groupchat";
import { detectSelfie, selfieNote, selfieSetup, withPrompt } from "./selfie";
import { generateImage, GenParams } from "./imagegen";
import { Lightbox, PhotoBubble } from "./PhotoBubble";
import { PromptDialog } from "./ImageDetails";
import { economyContext } from "./connected";
import { adultFlag } from "./economy";
import { evaluateMood, selectMemories, summariseGroup } from "./mind";
import { EmojiPicker } from "./EmojiPicker";
import { convertSmileys } from "./emoticons";
import { AltSwitch, EditBox, MsgTools, ReactionChip } from "./MsgTools";
import { streamChat } from "./ollama";
import { markFirstSelfie } from "./life";
import { play } from "./sounds";
import { Character, Group, GroupMessage, MOOD_EMOJI, SELFIE, selfieScene, Settings } from "./types";

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
const temp = (g: Group, speakerId: string, content: string, key: string): View =>
  ({ imagePath: null, key, id: -1, groupId: g.id, speakerId, content, createdAt: Date.now(), isError: false, reaction: "", reactorId: null, alternates: [], altIndex: 0 });

export function GroupPane({ g, chars, me, onEdit, onCharUpdated, onBanner }: {
  g: Group; chars: Character[]; me: Settings; onEdit: () => void; onCharUpdated: (c: Character) => void; onBanner: (s: string) => void;
}) {
  const [msgs, setMsgsState] = useState<View[]>([]);
  const [draft, setDraft] = useState("");
  const [typingId, setTypingId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<View | null>(null);
  const [promptOf, setPromptOf] = useState<View | null>(null);
  const stop = useRef(false);
  const alive = useRef(true);
  const msgsRef = useRef<View[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const summarising = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const show = (t: string) => me.emoticons ? convertSmileys(t) : t;
  const members = g.memberIds.map((id) => chars.find((c) => c.id === id)).filter(Boolean) as Character[];
  const membersRef = useRef(members); membersRef.current = members;

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
    const turn = buildGroupTurn(c, g, membersRef.current, hist, me.userName, memories, new Date(), economyContext(c, me.userName, { group: true }));
    if (note) turn.push({ role: "system", content: note });
    const raw = await streamChat(c.model, turn, {
      onToken: (tok) => {
        const first = !started; started = true;
        if (first && !replaceKey) setMsgs((p) => [...p, temp(g, c.id, tok, key)]);
        else setMsgs((p) => p.map((m) => m.key === key ? { ...m, content: (first ? "" : m.content) + tok } : m));
      },
    });
    return { key, text: cleanGroupReply(raw, c, membersRef.current, me.userName) };
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

  /** Responders (+ maybe a selfie, + maybe banter) answer the user's message `userMsg`. */
  const runTurn = async (userMsg: GroupMessage) => {
    stop.current = false; setRunning(true);
    try {
      const live = membersRef.current;
      if (live.length === 0) return;
      // a selfie request goes to the member it names
      const target = addressedMembers(userMsg.content, live)[0];
      const intent = target ? await detectSelfie(target, me.userName, userMsg.content).catch(() => ({ selfie: false, scene: "" })) : { selfie: false, scene: "" };
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
    try {
      const m = await api.addGroupMessage(g.id, null, text);
      push(m); play("sent");
      await runTurn(m);
    } catch (e) { onBanner(String(e)); }
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
  return (
    <>
      <header className="chat-head">
        <Avatar big emoji={g.avatar} color={g.color} />
        <div className="ch-info">
          <div className="ch-name">{g.name} <span className="ch-status">({members.length + 1} people)</span></div>
          <div className="group-members">{members.map((c) => <span key={c.id} title={`${c.name} \u00B7 ${c.mood}`}><Avatar emoji={c.avatar} path={c.avatarPath} color={c.color} />{c.name} {MOOD_EMOJI[c.mood]}</span>)}</div>
          <div className="ch-actions">
            <button className="link" onClick={onEdit}>Edit group</button>
            <button className="link" onClick={clear} disabled={running}>Clear chat</button>
            <button className="link" onClick={() => remember(true)} title="Fold this group chat into each member's memories now">Remember now</button>
          </div>
        </div>
      </header>
      <div className="messages">
        {msgs.map((m) => {
          const c = m.speakerId ? byId.get(m.speakerId) : null;
          const mine = !m.speakerId;
          const reactor = m.reaction ? (m.reactorId ? byId.get(m.reactorId)?.name : "You") : undefined;
          return (
            <div key={m.key} className={`bubble-row ${mine ? "mine" : "theirs"}${m.isError ? " error" : ""} group-row`}>
              {!mine && <Avatar emoji={c?.avatar ?? "\u{1F464}"} path={c?.avatarPath} color={c?.color} />}
              <div className="bubble">
                {m.id > 0 && editingKey !== m.key && <MsgTools mine={mine} reaction={m.reactorId ? undefined : m.reaction} busy={running}
                  onReact={!mine && !m.isError ? (e) => react(m, e) : undefined}
                  canRegen={!mine && m === last && !!c} onRegen={() => m.imagePath ? retake(m) : regenerate(m)}
                  canEdit={mine} onEdit={() => setEditingKey(m.key)} onDelete={() => remove(m)} />}
                <div className="b-meta"><b style={{ color: mine ? undefined : c?.color }}>{mine ? "You" : c?.name ?? "Former member"}</b> {"\u00B7"} {fmt(m.createdAt)}
                  <AltSwitch index={m.altIndex} count={m.alternates.length} disabled={running} onSwipe={(d) => swipe(m, d)} /></div>
                {m.imagePath ? <PhotoBubble path={m.imagePath} caption={selfieScene(m.content)} onOpen={() => setLightbox(m)} onInfo={() => setPromptOf(m)} />
                  : editingKey === m.key
                  ? <EditBox initial={m.content} onCancel={() => setEditingKey(null)} onSave={(t) => { setEditingKey(null); edit(m, t); }} />
                  : <div className="b-text">{m.isError ? m.content : show(m.content)}</div>}
                <ReactionChip emoji={m.reaction} by={reactor} />
              </div>
            </div>
          );
        })}
        {typingChar && <div className="typing">{typingChar.name} is typing<span className="dots"><i/><i/><i/></span></div>}
        {photoId && <div className="typing">{"\u{1F4F7}"} {byId.get(photoId)?.name} is taking a photo<span className="dots"><i/><i/><i/></span></div>}
        {promptOf?.imagePath && <PromptDialog path={promptOf.imagePath} adult={adultFlag()} charName={byId.get(promptOf.speakerId ?? "")?.name} onClose={() => setPromptOf(null)} />}
        {lightbox?.imagePath && <Lightbox path={lightbox.imagePath} title={`${byId.get(lightbox.speakerId ?? "")?.name ?? "group"} selfie`} busy={!!photoId}
          onClose={() => setLightbox(null)} onAvatar={() => asAvatar(lightbox)} onRegen={() => retake(lightbox)} />}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <EmojiPicker target={taRef} value={draft} onChange={setDraft} />
        <textarea ref={taRef} value={draft} placeholder={`Message ${g.name}\u2026 (mention a name to ask someone directly)`} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        {running
          ? <button className="stop" onClick={() => { stop.current = true; }} title="Stop after the current reply">Stop</button>
          : <button onClick={send} disabled={!draft.trim()}>Send</button>}
      </div>
    </>
  );
}