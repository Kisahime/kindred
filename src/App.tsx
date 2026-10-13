import { useEffect, useRef, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { Editor } from "./Editor";
import { MemoriesDialog } from "./Memories";
import { contextWindow, evaluateMood, needsDrift, selectMemories, summarise } from "./mind";
import { desktopNotify, shakeWindow } from "./notify";
import { configureSounds, play, SOUND_EVENTS, SoundEvent } from "./sounds";
import { GroupEditor, GroupPane } from "./Group";
import { blankGroup } from "./groupchat";
import { EmojiPicker } from "./EmojiPicker";
import { convertSmileys } from "./emoticons";
import { AltSwitch, EditBox, MsgTools, ReactionChip } from "./MsgTools";
import { TemplateGallery } from "./TemplateGallery";
import { ImageStudio } from "./ImageStudio";
import { FeedPane } from "./Feed";
import { EconomyPane, EconTab, useBalance } from "./SparklesPane";
import { cafe, cafePrompt } from "./cafe";
import { giftFit } from "./mall";
import { repairSaved } from "./repair";
import { adultGiftCheck, adultGiftNote, loadAdult, saveAdult } from "./afterdark";
import { chatEarn, closenessReward, dailyLogin, econApi, GIFT, giftMessage, giftNote, giftsOf, giftsPrompt, isAdultItem, Item, milestoneRewards, onWallet, refreshGifts, SPARK } from "./economy";
import { CallWindow } from "./CallWindow";
import { Answer, decideAnswer } from "./callsession";
import { speakMessage, tone, voiceApi } from "./voice";
import { AlbumItem, FEED_GAP_MIN, FeedConfig, generateFeedPost, lifeApi, markFirstSelfie, runUnlock } from "./life";
import { anniversaryLabel, anniversaryMonths, currentBlock, evolutionDue, lifeOf, relationLabel, scheduleStatus, starterLife, unlocksDue } from "./lifecore";
import { Lightbox, PhotoBubble } from "./PhotoBubble";
import { PromptDialog } from "./ImageDetails";
import { MeEditor } from "./MeEditor";
import { SetupChecklist } from "./SetupChecklist";
import { isBirthday, profile as currentProfile, profileApi, UserProfile } from "./profile";
import { ConnectedOptions, DataBackups } from "./OptionsExtra";
import { backupApi } from "./databackup";
import { economyContext, freshDay, giftBackNote, giftBubble, loadConnected, Offer, offerApi, offerBubble, offerNote, occasionsDue, pickOffer, pickReturnGift, resolveNote, shouldGift, connectedCfg, offerTarget, offerMemory } from "./connected";
import { adultFlag, dayKey, emitWallet } from "./economy";
import { detectSelfie, withPrompt, giftForSelfie, GiftShot, logSelfie, selfieNote, selfieSetup, selfieShot } from "./selfie";
import { generateImage, GenParams, reuseParams } from "./imagegen";
import { listen } from "@tauri-apps/api/event";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { ChatMessage, listModels, streamChat } from "./ollama";
import { generateProactive, inQuietHours, nextDelay, skipReason } from "./proactive";
import { CALL, CallLog, fmtDuration, isEventText, OFFER, parseCall } from "./types";
import { blankCharacter, buildSystemPrompt, Character, closenessLabel, Group, MOOD_EMOJI, NUDGE, Settings, SELFIE, selfieScene, Status, statusLabel, StoredMessage, Theme, THEMES, toModelText, appearanceOf } from "./types";

interface Msg {
  key: string; dbId?: number; from: "me" | "them"; text: string; time: Date; error?: boolean; proactive?: boolean;
  reaction?: string; alternates?: string[]; altIndex?: number; image?: string | null;
}
interface Toast { key: number; c: Character; text: string; }
interface MsgActions {
  react: (m: Msg, emoji: string) => void; regen: (m: Msg) => void; swipe: (m: Msg, dir: number) => void;
  remove: (m: Msg) => void; edit: (m: Msg, text: string) => void;
}

const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (d: Date) => d.toDateString() === new Date().toDateString() ? fmt(d) : `${d.toLocaleDateString()} ${fmt(d)}`;
const toMsg = (m: StoredMessage): Msg => ({ key: `db${m.id}`, dbId: m.id, from: m.role === "user" ? "me" : "them", text: m.content, time: new Date(m.createdAt),
  error: m.isError, proactive: m.isProactive, reaction: m.reaction, alternates: m.alternates, altIndex: m.altIndex, image: m.imagePath ?? null });
const TICK_MS = 30_000;
const IDLE_SUMMARY_MS = 5 * 60_000;
const log = (what: string) => (e: unknown) => console.warn(`[background] ${what}:`, e);
let tmp = 1;

export default function App() {
  const [me, setMe] = useState<Settings>({ userName: "You", status: "online", personalMessage: "", quietStart: "23:00", quietEnd: "08:00", sound: true, theme: "aero", volume: 70, mutedSounds: "", emoticons: true, closeToTray: true, trayHintShown: false });
  const [gallery, setGallery] = useState(false);
  const [studio, setStudio] = useState(false);
  const [gpuBusy, setGpuBusy] = useState(false);
  useEffect(() => { const off = listen<string>("gpu-status", (e) => setGpuBusy(e.payload === "image")); return () => { off.then((f) => f()); }; }, []);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [chars, setChars] = useState<Character[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Character | null>(null);
  const [options, setOptions] = useState(false);
  const [setup, setSetup] = useState(false);
  useEffect(() => { econApi.kvGet<boolean>("setup_seen").then((seen) => { if (!seen) { setSetup(true); econApi.kvSet("setup_seen", true).catch(() => {}); } }).catch(() => {}); }, []);
  const [memoriesOf, setMemoriesOf] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<{ c: Character; m: Msg } | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [econOpen, setEconOpen] = useState(false);
  const [econTab, setEconTab] = useState<EconTab>("cafe");
  const [sparkToast, setSparkToast] = useState<string | null>(null);
  const balance = useBalance();
  const [adult, setAdult] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [meOpen, setMeOpen] = useState(false);
  const [promptOf, setPromptOf] = useState<{ path: string; name: string } | null>(null);
  const [offers, setOffers] = useState<Record<number, Offer>>({});
  const connBusy = useRef(false);
  const [studioLoad, setStudioLoad] = useState<{ p: GenParams; n: number } | null>(null);
  const [call, setCall] = useState<{ c: Character; incoming: boolean; answer: Answer } | null>(null);
  const [ringing, setRinging] = useState<Character | null>(null);
  const [feedVersion, setFeedVersion] = useState(0);
  const [feedUnread, setFeedUnread] = useState(0);
  const [posting, setPosting] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const feedCfg = useRef<FeedConfig>({ frequency: "sometimes" });
  const feedDue = useRef(0);
  const lifeCheckAt = useRef(0);
  const unlockTry = useRef<Record<string, number>>({});
  const lifeBusy = useRef<Set<string>>(new Set());

  // Latest state for the scheduler (runs outside React's render cycle).
  const live = useRef({ me, chars, activeId, chats, typing, feedOpen, posting: false, onCall: false, offers });
  live.current = { ...live.current, me, chars, activeId, chats, typing, feedOpen, onCall: !!call || !!ringing, offers };
  const due = useRef<Record<string, number>>({});
  const generating = useRef<Set<string>>(new Set());
  const summarising = useRef<Set<string>>(new Set());
  const idleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const byId = (id: string) => live.current.chars.find((x) => x.id === id);
  const replaceChar = (s: Character) => setChars((cs) => cs.map((x) => x.id === s.id ? s : x));

  /** Background memory pass; at most one per character at a time. */
  const runSummary = async (id: string, idle: boolean): Promise<string> => {
    const c = byId(id);
    if (!c || summarising.current.has(id)) return "Already remembering\u2026";
    summarising.current.add(id);
    try {
      const r = await summarise(c, live.current.me.userName, idle);
      if (!r) return "Nothing new to remember yet.";
      setChars((cs) => cs.map((x) => x.id === id ? { ...x, summarizedUpto: r.upto } : x));
      console.info(`[memory] ${c.name}: +${r.added} memories (upto #${r.upto})`);
      return r.added ? `${c.name} remembered ${r.added} new thing${r.added > 1 ? "s" : ""}.` : "Nothing new worth remembering.";
    } finally { summarising.current.delete(id); }
  };

  useEffect(() => {
    listModels().then(setModels).catch((e) => setModelError(String(e)));
    api.getSettings().then((s) => { setMe(s); return profileApi.load(s).then(setProfile); }).catch((e) => setBanner(`Could not load settings: ${e}`));
    lifeApi.getFeedConfig().then((f) => { feedCfg.current = f; }).catch(() => {});
    lifeApi.listFeed().then((ps) => setFeedUnread(ps.filter((p) => p.isUnread).length)).catch(() => {});
    api.listCharacters().then(async (cs) => {
      // characters from before relationships existed: fill in template defaults once (only when blank)
      cs = await Promise.all(cs.map((c) => c.life && Object.keys(c.life).length ? c
        : api.saveCharacter({ ...c, life: { ...lifeOf(c), ...starterLife(c.name) } }).catch(() => c)));
      setChars(cs); if (cs.some((c) => c.status === "online")) setTimeout(() => play("signin"), 400); })
      .catch((e) => setBanner(`Could not load contacts: ${e}`));
    api.listGroups().then(setGroups).catch((e) => setBanner(`Could not load groups: ${e}`));
    api.unreadCounts().then(setUnread).catch(() => {});
    // daily data backup (at most once a day; keeps the newest 14)
    backupApi.auto().then((b) => { if (b) console.info(`[backup] ${b.name} (${b.files} files)`); }).catch(log("data backup"));
    loadConnected().catch(() => {});
    offerApi.list().then((os) => setOffers(Object.fromEntries(os.filter((o) => o.messageId).map((o) => [o.messageId!, o])))).catch(log("offers"));
  }, []);

  // ---- Sparkles: café engine (keeps running minimised/in tray), daily visit, gifts cache, earn toasts ----
  useEffect(() => {
    cafe.start().catch(log("cafe"));
    loadAdult().then((s) => { setAdult(s.enabled); refreshGifts().catch(() => {}); }).catch(log("adult setting"));
    dailyLogin().catch(log("daily login"));
    refreshGifts().catch(log("gifts"));
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onWallet((_b, note) => { if (!note) return; setSparkToast(note); clearTimeout(t); t = setTimeout(() => setSparkToast(null), 3500); });
    return () => { off(); clearTimeout(t); };
  }, []);
  useEffect(() => { cafe.setChars(chars); }, [chars]);
  // one-off: clearer wording for shop items generated before item types existed
  const repaired = useRef(false);
  useEffect(() => {
    if (repaired.current || !chars.length) return;
    repaired.current = true;
    repairSaved(chars, api.ollamaJson).then((n) => { if (n) console.info(`[repair] clarified ${n} generated items`); }).catch(log("item repair"));
  }, [chars]);

  useEffect(() => { document.documentElement.dataset.theme = me.theme; configureSounds(me); }, [me]);

  // ---- tray -----------------------------------------------------------------
  useEffect(() => {
    const offs = [
      listen<string>("tray-status", (e) => { const s = { ...live.current.me, status: e.payload as Status }; setMe(s); api.saveSettings(s).catch(() => {}); }),
      listen("hidden-to-tray", () => {
        desktopNotify("Still here in the tray", "Kindred keeps running so your friends can still message you. Right-click the tray icon to quit, or turn this off in Options.");
        const s = { ...live.current.me, trayHintShown: true }; setMe(s); api.saveSettings(s).catch(() => {});
      }),
    ];
    return () => { offs.forEach((p) => p.then((off) => off())); };
  }, []);
  useEffect(() => {
    const total = Object.values(unread).reduce((a, b) => a + (b || 0), 0);
    api.setTrayTooltip(total ? `Kindred \u2013 ${total} new message${total > 1 ? "s" : ""}` : `Kindred (${statusLabel[me.status]})`).catch(() => {});
  }, [unread, me.status]);

  const saveMe = (s: Settings) => { setMe(s); api.saveSettings(s).catch((e) => setBanner(String(e))); };

  const open = async (c: Character) => {
    setActiveId(c.id);
    setFeedOpen(false); setEconOpen(false);
    setActiveGroupId(null);
    setToasts((ts) => ts.filter((t) => t.c.id !== c.id));
    if (unread[c.id]) { setUnread((u) => ({ ...u, [c.id]: 0 })); api.markRead(c.id).catch(() => {}); }
    if (live.current.chats[c.id]) return;
    try {
      let stored = await api.listMessages(c.id);
      if (stored.length === 0 && c.greeting.trim()) stored = [await api.addMessage(c.id, "assistant", c.greeting.trim())];
      setChats((p) => ({ ...p, [c.id]: stored.map(toMsg) }));
    } catch (e) { setBanner(`Could not load chat: ${e}`); setChats((p) => ({ ...p, [c.id]: [] })); }
  };

  const active = chars.find((c) => c.id === activeId) ?? null;
  const append = (cid: string, m: Msg) => setChats((p) => p[cid] ? { ...p, [cid]: [...p[cid], m] } : p);

  // ---- proactive messages -------------------------------------------------
  const deliverProactive = (c: Character, m: StoredMessage, shown?: Msg) => {
    const { activeId: act } = live.current;
    const focused = document.hasFocus();
    append(c.id, shown ?? toMsg(m));
    if (act === c.id && focused) { api.markRead(c.id).catch(() => {}); }
    else {
      setUnread((u) => ({ ...u, [c.id]: (u[c.id] ?? 0) + 1 }));
      const key = tmp++;
      setToasts((ts) => [...ts.filter((t) => t.c.id !== c.id), { key, c, text: m.content === NUDGE ? "\u{1F44B} sent you a nudge!" : m.content }].slice(-3));
      setTimeout(() => setToasts((ts) => ts.filter((t) => t.key !== key)), 9000);
    }
    if (m.content === NUDGE) { play("nudge"); shakeWindow(); } else play("proactive");
    const body = m.content === NUDGE ? "sent you a nudge!" : m.content;
    if (!focused) desktopNotify(`${c.name} says:`, body.length > 140 ? body.slice(0, 137) + "..." : body);
  };

  const runProactive = async (c: Character, force: boolean, nudgeFirst = false, note = "") => {
    if (generating.current.has(c.id)) return;
    const { me: s, typing: ty } = live.current;
    if (!force) {
      const history = await api.recentMessages(c.id, 12).catch(() => null);
      if (!history) return;
      const why = skipReason(c, s, history, !!ty[c.id]);
      if (why) { console.debug(`[proactive] skip ${c.name}: ${why}`); return; }
    }
    if (live.current.onCall) return;
    if (!force && !note && appearanceOf(c).canCall && Math.random() < 0.1) {
      const info = await voiceApi.info().catch(() => null);
      if (info?.installed) { setRinging(c); return; }
    }
    generating.current.add(c.id);
    setTyping((p) => ({ ...p, [c.id]: true }));
    try {
      // rarely start with a nudge (only characters allowed to message first ever get here)
      if (nudgeFirst || (!force && !note && Math.random() < 0.12)) {
        deliverProactive(c, await api.addProactiveMessage(c.id, NUDGE));
        await new Promise((r) => setTimeout(r, 2500));
      }
      deliverProactive(c, await generateProactive(c, s, [note, economyContext(c, s.userName)].filter(Boolean).join(" ")));
      // sometimes follow up with an unprompted selfie (separate opt-in per character)
      if (appearanceOf(c).selfiesUnprompted && (force || Math.random() < 0.25)) {
        const setup = await selfieSetup(c);
        if ("params" in setup) { generating.current.delete(c.id); setTyping((p) => ({ ...p, [c.id]: false })); await sendSelfie(c, "", setup.params, true); }
      }
    }
    catch (e) { if (force) setBanner(`${c.name} couldn't message you: ${e instanceof Error ? e.message : e}`); else console.warn("[proactive]", e); }
    finally { generating.current.delete(c.id); setTyping((p) => ({ ...p, [c.id]: false })); }
  };

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      lifeTick(now);
      for (const c of live.current.chars) {
        if (needsDrift(c, now)) api.setMood(c.id, c.baselineMood, c.closeness).then(replaceChar).catch(log("mood drift"));
        if (!c.proactiveEnabled) { delete due.current[c.id]; continue; }
        if (!due.current[c.id]) { due.current[c.id] = now + nextDelay(c.proactiveFrequency); continue; }
        if (now >= due.current[c.id]) {
          due.current[c.id] = now + nextDelay(c.proactiveFrequency);
          runProactive(c, false);
        }
      }
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- daily lives, milestones, feed ------------------------------------------
  const lifeTick = (now: number) => {
    const { chars: cs, me: s } = live.current;
    // auto status from schedule
    for (const c of cs) {
      const l = lifeOf(c);
      const cur = l.autoStatus ? currentBlock(l) : null;
      if (!cur) continue;
      const st = scheduleStatus(cur);
      if (st.status !== c.status || st.personalMessage !== c.personalMessage) api.saveCharacter({ ...c, ...st }).then(replaceChar).catch(log("auto status"));
    }
    // feed posts (only while open; never in quiet hours)
    const gap = FEED_GAP_MIN[feedCfg.current.frequency] * 60_000;
    if (!gap) feedDue.current = 0;
    else if (!feedDue.current) feedDue.current = now + gap * (0.5 + Math.random());
    else if (now >= feedDue.current) { feedDue.current = now + gap * (0.5 + Math.random()); if (s.status !== "offline" && !inQuietHours(new Date(), s.quietStart, s.quietEnd)) postUpdate(false); }
    // first-met dates + anniversaries, every 10 minutes
    if (!cs.length || now - lifeCheckAt.current < 10 * 60_000) return;
    lifeCheckAt.current = now;
    (async () => {
      const all = await lifeApi.listMilestones(null);
      for (const c of live.current.chars) {
        const mine = all.filter((m) => m.characterId === c.id);
        let met = mine.find((m) => m.kind === "first_met");
        if (!met) met = await lifeApi.addMilestone(c.id, "first_met", `You met ${c.name}`, "", c.createdAt || Date.now(), true);
        if (!c.proactiveEnabled) continue;
        const l = lifeOf(c);
        const bases: [string, number, string][] = [["met", met.createdAt, "since you met"]];
        if (l.relationshipSince && Math.abs(l.relationshipSince - met.createdAt) > 86_400_000) bases.push(["rel", l.relationshipSince, `as your ${relationLabel(l)}`]);
        for (const [base, since, what] of bases) {
          const months = anniversaryMonths(since);
          const key = `${base}:${months}`;
          if (!months || mine.some((m) => m.kind === "anniversary" && m.data === key)) continue;
          if (skipReason(c, live.current.me, [], !!live.current.typing[c.id])) continue; // try again later today
          const label = `${anniversaryLabel(months)} ${what}`;
          await lifeApi.addMilestone(c.id, "anniversary", `\u{1F389} ${label}`, key, null, true);
          runProactive(c, true, false, `Today is a special day: it is exactly ${label} (${live.current.me.userName} and you). Send a short, warm, celebratory message about it.`);
          break;
        }
      }
      const names = new Map(live.current.chars.map((c) => [c.id, c.name]));
      await milestoneRewards(await lifeApi.listMilestones(null), names);
      await connectedTick().catch(log("connected economy"));
      await birthdayTick().catch(log("birthday"));
    })().catch(log("milestones"));
  };

  /** One "What's new" post from a random awake contact; sometimes with a photo. */
  const postUpdate = async (force: boolean) => {
    if (live.current.posting) return;
    const { chars: cs, me: s } = live.current;
    const pool = cs.filter((c) => c.status !== "offline" && currentBlock(lifeOf(c))?.block.status !== "sleeping");
    if (!pool.length) { if (force) setBanner("Everyone is offline or asleep right now."); return; }
    const c = pool[Math.floor(Math.random() * pool.length)];
    live.current.posting = true; setPosting(true);
    try {
      const { post, photo: scene } = await generateFeedPost(c, s.userName);
      const row = await lifeApi.addFeedPost(c.id, post);
      setFeedVersion((v) => v + 1);
      if (!live.current.feedOpen) setFeedUnread((n) => n + 1);
      if (!document.hasFocus()) desktopNotify(`${c.name} posted an update`, post);
      if (appearanceOf(c).selfiesUnprompted && Math.random() < (force ? 0.5 : 0.3)) {
        const setup = await selfieSetup(c);
        if ("params" in setup) {
          const rows = await generateImage(withPrompt(setup.params, byId(c.id) ?? c, scene || post, new Date(), { source: "album" }), () => {});
          if (rows[0]) { await lifeApi.setFeedImage(row.id, rows[0].path); markFirstSelfie(c); setFeedVersion((v) => v + 1); }
        }
      }
    } catch (e) { if (force) setBanner(`${c.name} couldn't post: ${e instanceof Error ? e.message : e}`); else console.warn("[feed]", e); }
    finally { live.current.posting = false; setPosting(false); }
  };

  // ---- connected economy: gifts back + offers (checked every 10 minutes, capped per day) ----
  const connectedTick = async () => {
    const cfg = connectedCfg();
    if ((!cfg.giftsBack && !cfg.offers) || connBusy.current || live.current.onCall) return;
    const s = live.current.me;
    if (s.status === "offline" || s.status === "busy" || inQuietHours(new Date(), s.quietStart, s.quietEnd)) return;
    connBusy.current = true;
    try {
      const now = new Date();
      let st = freshDay(await offerApi.state(), now);
      const awake = live.current.chars.filter((c) => c.status !== "offline" && currentBlock(lifeOf(c))?.block.status !== "sleeping" && !generating.current.has(c.id));
      // occasions first (anniversaries, new relationship, nicknames...): a present, still within the daily cap
      const occ = cfg.giftsBack ? occasionsDue(await lifeApi.listMilestones(null), st) : [];
      for (const m of occ) {
        const c = awake.find((x) => x.id === m.characterId);
        st.occasions = [...st.occasions, m.id];
        if (!c || c.closeness < 25 || st.gifts >= 2) continue;
        if (await giveBack(c, `Today is special for you two (${m.title}).`)) { st = { ...st, gifts: st.gifts + 1, lastGift: { ...st.lastGift, [c.id]: Date.now() } }; break; }
      }
      const today = dayKey(now);
      const mine = cfg.offers ? await econApi.inventory("me").catch(() => [] as Item[]) : [];
      const pendingFrom = new Set(Object.values(live.current.offers).filter((o) => o.status === "pending").map((o) => o.characterId));
      for (const c of [...awake].sort(() => Math.random() - 0.5)) {
        if (st.rolled[c.id] === today) continue;
        st.rolled = { ...st.rolled, [c.id]: today };
        if (shouldGift(st, c, cfg, now)) {
          if (await giveBack(c)) { st = { ...st, gifts: st.gifts + 1, lastGift: { ...st.lastGift, [c.id]: Date.now() } }; break; }
        }
        const o = pickOffer(st, c, mine, cfg, now, pendingFrom.has(c.id));
        if (o) {
          generating.current.add(c.id);
          try {
            deliverProactive(c, await generateProactive(c, s, offerNote(c, o, s.userName)));
            const msg = await api.addProactiveMessage(c.id, offerBubble(o));
            const off = await offerApi.create(c.id, o.kind, o.swap ?? {}, o.target.id, o.sparkles, msg.id);
            setOffers((p) => ({ ...p, [msg.id]: off }));
            deliverProactive(c, msg);
          } finally { generating.current.delete(c.id); }
          st = { ...st, offers: st.offers + 1, lastOffer: { ...st.lastOffer, [c.id]: Date.now() } };
          break;
        }
      }
      await offerApi.saveState(st);
    } finally { connBusy.current = false; }
  };
  /** On Alex's birthday each awake character wishes her happy birthday once (with a present if gifts are on), one per check. */
  const birthdayTick = async () => {
    const p = currentProfile();
    const bd = p.fields.birthday;
    const s = live.current.me;
    if (!bd.share || !isBirthday(bd.value) || s.status === "offline" || inQuietHours(new Date(), s.quietStart, s.quietEnd) || live.current.onCall) return;
    const key = `birthday_wished_${new Date().getFullYear()}`;
    const done = (await econApi.kvGet<string[]>(key)) ?? [];
    const c = live.current.chars.find((x) => !done.includes(x.id) && x.status !== "offline" && currentBlock(lifeOf(x))?.block.status !== "sleeping" && !generating.current.has(x.id));
    if (!c) return;
    await econApi.kvSet(key, [...done, c.id]);
    const note = `Today is ${s.userName}'s birthday!`;
    if (connectedCfg().giftsBack && c.closeness >= 25 && await giveBack(c, `${note} Wish them a happy birthday warmly, and this present is your birthday gift.`).catch(() => false)) return;
    await runProactive(c, true, false, `${note} Send a short, warm happy-birthday message in your own style.`);
  };
  /** A character sends Alex a present: short message + 🎁 bubble with an Accept button. */
  const giveBack = async (c: Character, occasion = ""): Promise<boolean> => {
    const stock = await econApi.shopGet(c.id, dayKey()).catch(() => null);
    const g = pickReturnGift(c, stock?.items ?? null, adultFlag());
    if (!g) return false;
    generating.current.add(c.id);
    try {
      deliverProactive(c, await generateProactive(c, live.current.me, giftBackNote(c, g, live.current.me.userName, occasion)));
      const msg = await api.addProactiveMessage(c.id, giftBubble(g));
      const off = await offerApi.create(c.id, "gift", g, null, 0, msg.id);
      setOffers((p) => ({ ...p, [msg.id]: off }));
      deliverProactive(c, msg);
      return true;
    } finally { generating.current.delete(c.id); }
  };
  /** Alex taps Accept / Decline on a gift or offer bubble. */
  const answerOffer = async (c: Character, m: Msg, accept: boolean) => {
    const o = m.dbId ? offers[m.dbId] : undefined;
    if (!o || o.status !== "pending") return;
    try {
      const [done, bal] = await offerApi.resolve(o.id, accept, c.name);
      setOffers((p) => ({ ...p, [m.dbId!]: done }));
      const target = o.kind === "gift" ? `${o.item.emoji ?? ""} ${o.item.name ?? "gift"}`.trim() : offerTarget(m.text);
      if (done.status === "accepted") {
        emitWallet(bal, o.kind === "buy" ? `+${o.sparkles} ${SPARK} sold to ${c.name}` : undefined);
        await refreshGifts().catch(() => {});
      }
      if (done.status === "expired") setBanner(`You don't have that item any more, so the offer has lapsed.`);
      const cc = byId(c.id) ?? c;
      const hist = (live.current.chats[c.id] ?? []).filter((x) => x.key !== m.key); // the event is restated (with the answer) in the note
      api.addMemory(c.id, offerMemory(o, done.status, target, cc.name, me.userName), false, "gift").catch(log("offer memory"));
      await reply(cc, hist, resolveNote(o, done.status, target, cc.name, me.userName));
    } catch (e) { setBanner(String(e instanceof Error ? e.message : e)); }
  };

  /** After the mood pass: closeness unlocks (one at a time) and relationship proposals. */
  const checkLife = async (c0: Character) => {
    if (lifeBusy.current.has(c0.id)) return;
    lifeBusy.current.add(c0.id);
    try {
      const user = live.current.me.userName;
      const due = unlocksDue(c0, await lifeApi.listMilestones(c0.id))[0];
      if (due && Date.now() - (unlockTry.current[c0.id] ?? 0) > 20 * 60_000) {
        unlockTry.current[c0.id] = Date.now();
        const r = await runUnlock(c0, user, due.kind, due.data);
        if (r) { replaceChar(r.character); setBanner(`\u{1F49E} Milestone with ${c0.name}: ${r.milestone.title}`); }
      }
      const c = byId(c0.id) ?? c0;
      const p = evolutionDue(c);
      if (p) {
        const s = await api.saveCharacter({ ...c, life: { ...lifeOf(c), proposal: p, lastProposalAt: p.at } });
        replaceChar(s);
        await new Promise((r) => setTimeout(r, 2500));
        const label = p.detail || p.to;
        await reply(s, live.current.chats[s.id] ?? [], `(You now feel close enough to ${user} to ask if they would like to become your ${label}. In this message, in character, sweetly ask them that. Keep it short and don't pressure them.)`);
      }
    } catch (e) { console.warn("[life]", e); }
    finally { lifeBusy.current.delete(c0.id); }
  };

  const answerProposal = async (c0: Character, yes: boolean) => {
    const c = byId(c0.id) ?? c0, l = lifeOf(c), p = l.proposal;
    if (!p) return;
    const label = p.detail || p.to;
    const life = yes ? { ...l, relationship: p.to, relationshipDetail: p.detail, relationshipSince: Date.now(), proposal: null }
      : { ...l, proposal: null, lastProposalAt: Date.now() };
    try {
      const s = await api.saveCharacter({ ...c, life });
      replaceChar(s);
      if (yes) await lifeApi.addMilestone(c.id, "relationship", `Became your ${label}`, p.to);
      const text = yes ? "Yes! I'd love that \u{1F49B}" : "Can we keep things as they are for now?";
      const mine: Msg = { key: `t${tmp++}`, from: "me", text, time: new Date() };
      const prior = live.current.chats[c.id] ?? [];
      append(c.id, mine);
      const saved = await api.addMessage(c.id, "user", text); patchMsg(c.id, mine.key, { dbId: saved.id });
      await reply(s, [...prior, { ...mine, dbId: saved.id }], yes ? `(${me.userName} said yes: you are now their ${label}! React happily, in character.)`
        : `(${me.userName} gently said not right now. Accept it gracefully and warmly; nothing changes between you.)`);
    } catch (e) { setBanner(String(e)); }
  };

  const jumpTo = (a: AlbumItem) => {
    setMemoriesOf(null); setStudio(false);
    const c = memoriesOf ? byId(memoriesOf) : null;
    if (a.source === "feed") { setActiveId(null); setActiveGroupId(null); setFeedOpen(true); return; }
    if (a.source === "group" && a.groupId) { setFeedOpen(false); setActiveGroupId(a.groupId); setActiveId(null); return; }
    if (c) { setFocusKey(`db${a.refId}`); open(c); setTimeout(() => setFocusKey(null), 5000); }
  };
  // ---- phone calls -------------------------------------------------------------
  const startCall = (c: Character, incoming: boolean) => { if (live.current.onCall && !ringing) return; setRinging(null); open(c); setCall({ c, incoming, answer: incoming ? { mode: "answer", afterMs: 0 } : decideAnswer(byId(c.id) ?? c) }); };
  const saveCallLog = async (c: Character, entry: CallLog, proactive: boolean) => {
    const content = `${CALL} ${JSON.stringify(entry)}`;
    try {
      const saved = proactive ? await api.addProactiveMessage(c.id, content) : await api.addMessage(c.id, "assistant", content);
      if (proactive) deliverProactive(c, { ...saved, content: "\u{1F4DE} tried to call you" }, toMsg(saved));
      else append(c.id, toMsg(saved));
      if (entry.lines.length) runSummary(c.id, false).catch(log("call memory"));
    } catch (e) { setBanner(`Could not save the call: ${e}`); }
  };
  const endCall = async (l: CallLog) => {
    const cur = call; setCall(null);
    if (!cur) return;
    const c = byId(cur.c.id) ?? cur.c;
    await saveCallLog(c, l, false);
    // declined because busy (or sleeping through it): a short text a little later
    if (l.missed && l.declined && l.declined !== "offline") setTimeout(() => {
      const c2 = byId(c.id) ?? c;
      reply(c2, live.current.chats[c.id] ?? [], `(${me.userName} just tried to phone you but you couldn't answer because you are ${l.declined}. Send a short text explaining and say you'll talk later.)`).catch(log("call text"));
    }, 4000);
  };
  useEffect(() => {
    if (!ringing) return;
    tone("ring"); play("proactive");
    if (!document.hasFocus()) desktopNotify(`${ringing.name} is calling\u2026`, "Open Kindred to answer.");
    const id = setInterval(() => tone("ring"), 2500);
    const miss = setTimeout(() => { const c = ringing; setRinging(null); saveCallLog(c, { d: 0, missed: true, incoming: true, lines: [] }, true); }, 25_000);
    return () => { clearInterval(id); clearTimeout(miss); };
  }, [ringing]); // eslint-disable-line react-hooks/exhaustive-deps
  const callTail = (c: Character): ChatMessage[] => toHistory(c, (chats[c.id] ?? []).slice(-8));
  const speak = (c: Character, m: Msg) => speakMessage(c, m.text).catch((e) => setBanner(`Voice: ${e instanceof Error ? e.message : e}`));

  const openFeed = () => { setStudio(false); setEconOpen(false); setFeedOpen(true); setFeedUnread(0); };

  // ---- chatting -----------------------------------------------------------
  const setList = (cid: string, f: (l: Msg[]) => Msg[]) => setChats((p) => ({ ...p, [cid]: f(p[cid] ?? []) }));
  const patchMsg = (cid: string, key: string, patch: Partial<Msg>) => setList(cid, (l) => l.map((m) => m.key === key ? { ...m, ...patch } : m));

  /** What the model sees: nudges and selfies spelled out, Alex's reactions noted on her next message, errors dropped. */
  const toHistory = (c: Character, list: Msg[]): ChatMessage[] =>
    contextWindow(list.filter((m) => !m.error)).map((m, i, arr) => {
      if (isEventText(m.text)) return { role: "system", content: toModelText(m.text, m.from === "me", me.userName, c.name, m.dbId ? offers[m.dbId]?.status : undefined) };
      if (m.from === "them") return { role: "assistant", content: toModelText(m.text, false, me.userName, c.name) };
      const prev = arr[i - 1];
      const note = prev && prev.from === "them" && prev.reaction ? `(${me.userName} reacted ${prev.reaction} to your last message) ` : "";
      return { role: "user", content: note + toModelText(m.text, true, me.userName, c.name) };
    });

  /** Streams a reply to `history` into bubble `key` (new bubble, or replacing an existing one's text). */
  const streamReply = async (c: Character, history: Msg[], key: string, existing: boolean, note?: string) => {
    const memories = selectMemories(await api.listMemories(c.id).catch(() => []));
    const extra = economyContext(c, me.userName, { always: true });
    const msgs: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(c, me.userName, { memories }) + (extra ? `\n\n${extra}` : "") }, ...toHistory(c, history)];
    if (note) msgs.push({ role: "system", content: note });
    let started = false;
    return streamChat(c.model, msgs, { onToken: (tok) => {
      const first = !started; started = true;
      if (first && !existing) setList(c.id, (l) => [...l, { key, from: "them", text: tok, time: new Date() }]);
      else setList(c.id, (l) => l.map((m) => m.key === key ? { ...m, text: (first ? "" : m.text) + tok } : m));
    } });
  };

  /** Background work after a fresh reply: mood (+ maybe a reaction on Alex's message) and memory. */
  const afterReply = (c: Character, userMsg: Msg | undefined, full: string) => {
    if (userMsg) evaluateMood(byId(c.id) ?? c, me.userName, toModelText(userMsg.text, true, me.userName, c.name), full).then(({ character, reaction }) => {
      replaceChar(character);
      checkLife(character);
      closenessReward(character).catch(log("closeness reward"));
      if (reaction && userMsg.dbId && userMsg.text !== NUDGE) {
        api.setReaction(userMsg.dbId, reaction).catch(log("reaction"));
        setList(c.id, (l) => l.map((m) => m.dbId === userMsg.dbId ? { ...m, reaction } : m));
      }
    }).catch(log("mood"));
    runSummary(c.id, false).catch(log("memory"));
    clearTimeout(idleTimers.current[c.id]);
    idleTimers.current[c.id] = setTimeout(() => runSummary(c.id, true).catch(log("idle memory")), IDLE_SUMMARY_MS);
  };

  /** Generates, shows and stores a new reply after `history`. */
  const reply = async (c: Character, history: Msg[], note?: string) => {
    const key = `t${tmp++}`;
    setTyping((p) => ({ ...p, [c.id]: true }));
    try {
      const full = await streamReply(c, history, key, false, note);
      play("received");
      const saved = await api.addMessage(c.id, "assistant", full);
      patchMsg(c.id, key, { dbId: saved.id, text: saved.content });
      afterReply(c, [...history].reverse().find((m) => m.from === "me"), full);
    } catch (e) {
      const msg = `\u26A0\uFE0F ${e instanceof Error ? e.message : String(e)}`;
      setList(c.id, (l) => l.filter((m) => m.key !== key));
      const saved = await api.addMessage(c.id, "assistant", msg, true).catch(() => null);
      append(c.id, { key: `t${tmp++}`, dbId: saved?.id, from: "them", text: msg, time: new Date(), error: true });
    } finally {
      setTyping((p) => ({ ...p, [c.id]: false }));
    }
  };

  /** Gives one of Alex's items to a character: chat message, memory, small closeness boost, in-character reaction. */
  const giveGift = async (c0: Character, it: Item) => {
    const adultGift = isAdultItem(it);
    if (adultGift) { const chk = adultGiftCheck(byId(c0.id) ?? c0, adult); if (!chk.ok) throw new Error(chk.reason); }
    const g = await econApi.gift(it.id, c0.id);
    await refreshGifts().catch(() => {});
    setEconOpen(false); setStudio(false);
    await open(c0);
    const c = byId(c0.id) ?? c0;
    const prior = (await api.listMessages(c.id)).filter((m) => !m.isError).map(toMsg);
    const mine: Msg = { key: `t${tmp++}`, from: "me", text: giftMessage(g), time: new Date() };
    const saved = await api.addMessage(c.id, "user", mine.text);
    mine.dbId = saved.id;
    append(c.id, mine); play("sent");
    api.addMemory(c.id, `${me.userName} gave ${c.name} a gift on ${new Date().toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}: ${g.emoji} ${g.name}.`, false, "gift").catch(log("gift memory"));
    api.setMood(c.id, c.mood, Math.min(100, c.closeness + 2)).then((x) => { replaceChar(x); closenessReward(x).catch(() => {}); }).catch(log("gift closeness"));
    await reply(c, [...prior, mine], `${giftNote(c, g, me.userName)} ${adultGift ? adultGiftNote(c, me.userName) : giftFit(c, g, me.userName).note}`);
  };

  const send = async (text: string, forceSelfie = false) => {
    if (!active) return;
    const c = active;
    const prior = chats[c.id] ?? [];
    const mine: Msg = { key: `t${tmp++}`, from: "me", text, time: new Date() };
    append(c.id, mine);
    if (text !== NUDGE) { play("sent"); chatEarn(text).catch(log("chat sparkles")); }
    try { const s = await api.addMessage(c.id, "user", text); mine.dbId = s.id; patchMsg(c.id, mine.key, { dbId: s.id }); }
    catch (e) { setBanner(`Could not save message: ${e}`); }
    // Is she asking for a picture? (cheap JSON check with the chat model; any failure = no)
    const intent = forceSelfie ? { selfie: true, scene: "" } : text === NUDGE ? { selfie: false, scene: "" }
      : await detectSelfie(c, me.userName, text).catch((e) => { console.warn("[selfie intent]", e); return { selfie: false, scene: "" }; });
    const setup = intent.selfie ? await selfieSetup(c) : null;
    const ready = setup && "params" in setup ? setup.params : null;
    // Is the picture about something she was given? (name, type, "wearing it", "the one I gave you", latest gift)
    const lastMine = [...prior].reverse().find((m) => m.from === "me" && Date.now() - m.time.getTime() < 10 * 60_000);
    const gift = intent.selfie ? (giftForSelfie(c, [text, intent.scene]).item ? giftForSelfie(c, [text, intent.scene]) : giftForSelfie(c, [text, intent.scene, lastMine?.text ?? ""])) : undefined;
    await reply(c, [...prior, mine], intent.selfie ? selfieNote(me.userName, !!ready, gift) : undefined);
    if (ready) await sendSelfie(c, intent.scene, ready, false, gift);
    else if (setup && "reason" in setup) setBanner(`${c.name} can't send pictures yet: ${setup.reason}. Pick a working model in Image Studio (\u{1F3A8}).`);
  };

  // ---- selfies ----------------------------------------------------------------
  const sendSelfie = async (c0: Character, scene: string, params: GenParams, proactive: boolean, gift?: GiftShot) => {
    const c = byId(c0.id) ?? c0;
    setPhoto((p) => ({ ...p, [c.id]: true }));
    try {
      const shot = selfieShot(params, c, scene, { wear: gift?.allowed ? gift.item : null });
      logSelfie(c, shot.built, gift).catch(log("selfie log"));
      const rows = await generateImage(shot.params, () => {});
      if (!rows[0]) throw new Error("no picture came back");
      const content = `${SELFIE} ${shot.caption}`.trim();
      const saved = proactive ? await api.addProactiveMessage(c.id, content) : await api.addMessage(c.id, "assistant", content);
      await api.setMessageImage(saved.id, rows[0].path);
      const m = toMsg({ ...saved, imagePath: rows[0].path });
      if (proactive) deliverProactive(c, { ...saved, content: "\u{1F4F7} sent you a selfie" }, m);
      else { append(c.id, m); play("received"); }
      markFirstSelfie(c);
      runSummary(c.id, false).catch(log("memory"));
    } catch (e) {
      if (!proactive) setBanner(`${c.name}'s photo didn't work: ${e instanceof Error ? e.message : e}`); else console.warn("[selfie]", e);
    } finally { setPhoto((p) => ({ ...p, [c.id]: false })); }
  };
  const retakeSelfie = async (c: Character, m: Msg) => {
    if (!m.dbId || photo[c.id]) return;
    const setup = await selfieSetup(c);
    if ("reason" in setup) { setBanner(`Can't take another: ${setup.reason}.`); return; }
    setPhoto((p) => ({ ...p, [c.id]: true }));
    try {
      const cc = byId(c.id) ?? c;
      const g = giftForSelfie(cc, [selfieScene(m.text)]);
      const shot = selfieShot({ ...setup.params, seed: -1 }, cc, selfieScene(m.text), { wear: g.allowed ? g.item : null });
      logSelfie(cc, shot.built, g).catch(log("selfie log"));
      const rows = await generateImage(shot.params, () => {});
      if (!rows[0]) throw new Error("no picture came back");
      await api.setMessageImage(m.dbId, rows[0].path);
      patchMsg(c.id, m.key, { image: rows[0].path });
      setLightbox((l) => l && l.m.key === m.key ? { ...l, m: { ...l.m, image: rows[0].path } } : l);
    } catch (e) { setBanner(`Retake failed: ${e instanceof Error ? e.message : e}`); }
    finally { setPhoto((p) => ({ ...p, [c.id]: false })); }
  };
  const photoAsAvatar = async (c: Character, path: string) => {
    try { const p = await api.importAvatar(path); const s = await api.saveCharacter({ ...(byId(c.id) ?? c), avatarPath: p }); replaceChar(s); setBanner(`${c.name} now uses that photo as their avatar.`); }
    catch (e) { setBanner(String(e)); }
  };

  // ---- message actions ------------------------------------------------------
  const regenerate = async (c: Character, m: Msg) => {
    const list = chats[c.id] ?? [];
    const i = list.findIndex((x) => x.key === m.key);
    if (i < 0 || !m.dbId || typing[c.id]) return;
    setTyping((p) => ({ ...p, [c.id]: true }));
    try {
      const full = await streamReply(c, list.slice(0, i), m.key, true);
      const alts = [...(m.alternates?.length ? m.alternates : [m.text]), full];
      const s = await api.updateMessage(m.dbId, full, alts, alts.length - 1);
      patchMsg(c.id, m.key, { text: s.content, alternates: s.alternates, altIndex: s.altIndex, error: false });
      play("received");
    } catch (e) {
      patchMsg(c.id, m.key, { text: m.text });
      setBanner(`Could not regenerate: ${e instanceof Error ? e.message : e}`);
    } finally { setTyping((p) => ({ ...p, [c.id]: false })); }
  };
  const swipe = async (c: Character, m: Msg, dir: number) => {
    const alts = m.alternates ?? [], idx = (m.altIndex ?? 0) + dir;
    if (!m.dbId || idx < 0 || idx >= alts.length) return;
    const s = await api.updateMessage(m.dbId, alts[idx], alts, idx).catch((e) => { setBanner(String(e)); return null; });
    if (s) patchMsg(c.id, m.key, { text: s.content, altIndex: s.altIndex });
  };
  const react = (c: Character, m: Msg, emoji: string) => {
    if (!m.dbId) return;
    const r = m.reaction === emoji ? "" : emoji;
    api.setReaction(m.dbId, r).catch(log("reaction"));
    patchMsg(c.id, m.key, { reaction: r });
  };
  const removeMsg = async (c: Character, m: Msg) => {
    if (!(await ask("Delete this message? This can't be undone.", { title: "Delete message", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" }))) return;
    if (m.dbId) await api.deleteMessage(m.dbId).catch((e) => setBanner(String(e)));
    setList(c.id, (l) => l.filter((x) => x.key !== m.key));
  };
  const editMsg = async (c: Character, m: Msg, text: string) => {
    if (!m.dbId || typing[c.id]) return;
    const list = chats[c.id] ?? [];
    const i = list.findIndex((x) => x.key === m.key);
    const s = await api.updateMessage(m.dbId, text).catch((e) => { setBanner(String(e)); return null; });
    if (!s) return;
    const edited: Msg = { ...m, text: s.content, reaction: "" };
    const after = list.slice(i + 1);
    // only her latest message (followed by replies only) gets a regenerated answer
    if (after.every((x) => x.from === "them")) {
      if (after.length && !(await ask("Regenerate the reply to your edited message?", { title: "Edit message", okLabel: "Regenerate", cancelLabel: "Keep reply" }))) {
        patchMsg(c.id, m.key, { text: s.content }); return;
      }
      await api.deleteMessagesAfter(c.id, m.dbId).catch(log("delete after"));
      const hist = [...list.slice(0, i), edited];
      setList(c.id, () => hist);
      await reply(c, hist);
    } else patchMsg(c.id, m.key, { text: s.content });
  };
  const nudge = () => { shakeWindow(); play("nudge"); send(NUDGE); };

  const clearChat = async (c: Character) => {
    if (!(await ask(`Clear your whole chat history with ${c.name}?`, { title: "Clear chat", kind: "warning", okLabel: "Clear", cancelLabel: "Cancel" }))) return;
    try {
      await api.clearMessages(c.id);
      setChats((p) => { const n = { ...p }; delete n[c.id]; return n; });
      live.current.chats = { ...live.current.chats, [c.id]: undefined as unknown as Msg[] };
      setUnread((u) => ({ ...u, [c.id]: 0 }));
      setActiveId(null);
      setTimeout(() => open(c), 0);
    } catch (e) { setBanner(String(e)); }
  };

  const setModel = (model: string) => {
    if (!active) return;
    api.saveCharacter({ ...active, model }).then((s) => setChars((cs) => cs.map((x) => x.id === s.id ? s : x))).catch((e) => setBanner(String(e)));
  };

  const onSaved = (s: Character) => {
    const before = chars.find((x) => x.id === s.id);
    if (before) { const a = lifeOf(before), b = lifeOf(s); if (a.relationship !== b.relationship || a.relationshipDetail !== b.relationshipDetail) lifeApi.addMilestone(s.id, "relationship", `Relationship set to ${relationLabel(b)}`, b.relationship).catch(log("milestone")); }
    if (s.status === "online" && before && before.status !== "online") play("signin");
    setChars((cs) => cs.some((x) => x.id === s.id) ? cs.map((x) => x.id === s.id ? s : x) : [...cs, s]);
    setEditing(null);
    if (!activeId) open(s);
  };
  const onDeleted = (id: string) => {
    setChars((cs) => cs.filter((x) => x.id !== id));
    setChats((p) => { const n = { ...p }; delete n[id]; return n; });
    if (activeId === id) setActiveId(null);
    setEditing(null);
    api.listGroups().then(setGroups).catch(() => {});
  };

  const importJson = async () => {
    try {
      const f = await openDialog({ multiple: false, filters: [{ name: "Character", extensions: ["json"] }] });
      if (typeof f === "string") { const c = await api.importCharacter(f); setChars((cs) => [...cs, c]); open(c); }
    } catch (e) { setBanner(`Import failed: ${e}`); }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <header className="me-header">
          <button className="me-open" title="My profile" onClick={() => profile && setMeOpen(true)}><Avatar big emoji={"\u{1F98B}"} path={profile?.fields.picture.value || null} className={`ring-${me.status}`} /></button>
          <div className="me-info">
            <div className="me-name">
              <button className="name-input me-open" title="Edit my profile" onClick={() => profile && setMeOpen(true)}>{me.userName || "Me"}</button>
              <select value={me.status} onChange={(e) => saveMe({ ...me, status: e.target.value as Status })}>
                {(Object.keys(statusLabel) as Status[]).map((s) => <option key={s} value={s}>({statusLabel[s]})</option>)}
              </select>
            </div>
            <input className="personal" value={me.personalMessage} placeholder="<Type a personal message>"
              onChange={(e) => setMe({ ...me, personalMessage: e.target.value })} onBlur={() => saveMe(me)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          </div>
        </header>
        <div className="group-title">{"\u25BE"} Friends ({chars.filter((c) => c.status !== "offline").length}/{chars.length})</div>
        <ul className="contacts">
          {chars.map((c) => (
            <li key={c.id} className={`${c.id === activeId ? "active" : ""}${unread[c.id] ? " unread" : ""}`} onClick={() => { setStudio(false); open(c); }} onDoubleClick={() => setEditing(c)}>
              <Avatar emoji={c.avatar} path={c.avatarPath} color={c.color}><span className={`dot ${c.status}`} /></Avatar>
              <div className="c-text">
                <div className="c-name">{c.name} <span className="mood" title={`Feeling ${c.mood} \u00B7 ${closenessLabel(c.closeness)} (${c.closeness}/100)`}>{MOOD_EMOJI[c.mood]}</span>
                  {typing[c.id] && <span className="c-typing">{"\u270E"}</span>}
                  {c.proactiveEnabled && <span className="c-proactive" title="Can message you first">{"\u2709"}</span>}</div>
                <div className="c-pm">{c.personalMessage}</div>
              </div>
              {!!unread[c.id] && <span className="badge">{unread[c.id]}</span>}
            </li>
          ))}
        </ul>
        <div className="group-title">{"\u25BE"} Groups ({groups.length})</div>
        <ul className="contacts groups">
          {groups.length === 0 && <li className="mem-empty" onClick={() => setEditingGroup(blankGroup())}>No groups yet. Create one to chat with several friends at once.</li>}
          {groups.map((g) => (
            <li key={g.id} className={g.id === activeGroupId ? "active" : ""} onClick={() => { setStudio(false); setFeedOpen(false); setEconOpen(false); setActiveGroupId(g.id); setActiveId(null); }} onDoubleClick={() => setEditingGroup(g)}>
              <Avatar emoji={g.avatar} color={g.color} />
              <div className="c-text">
                <div className="c-name">{g.name}</div>
                <div className="c-pm">{g.memberIds.map((id) => chars.find((c) => c.id === id)?.name).filter(Boolean).join(", ")}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="side-actions">
          <button onClick={() => setGallery(true)} title="Add a contact" aria-label="Add a contact">{"\u{1F464}\uFF0B"}</button>
          <button onClick={() => setEditingGroup(blankGroup())} title="New group chat" aria-label="New group chat">{"\u{1F465}\uFF0B"}</button>
          <button onClick={importJson} title="Import a character (.json)" aria-label="Import a character">{"\u{1F4E5}"}</button>
          <button className={`feed-btn${feedOpen && !studio ? " sel" : ""}`} onClick={openFeed} title="What's new" aria-label="What's new">{"\u2728"}{feedUnread > 0 && <span className="badge">{feedUnread}</span>}</button>
          <button className={`feed-btn${econOpen && !studio ? " sel" : ""}`} onClick={() => { setStudio(false); setFeedOpen(false); setEconOpen(true); }} title={`Sparkles: caf\u00E9, shops & gifts${balance !== null ? ` (${balance} ${SPARK})` : ""}`} aria-label="Sparkles">{"\u{1F3EA}"}</button>
          <button className={studio ? "sel" : ""} onClick={() => setStudio(true)} title="Image Studio" aria-label="Image Studio">{"\u{1F3A8}"}</button>
          <button onClick={() => setOptions(true)} title="Options" aria-label="Options">{"\u2699"}</button>
        </div>
        <footer className="ollama-status">{modelError ? `\u26A0\uFE0F Ollama not reachable` : `\u25CF Ollama \u00B7 ${models.length} models`}</footer>
      </aside>

      <main className="chat">
        {banner && <div className="banner" onClick={() => setBanner(null)}>{"\u26A0\uFE0F"} {banner} <small>(click to dismiss)</small></div>}
        {gpuBusy && !studio && <div className="banner info">{"\u{1F3A8}"} Image Studio is using the GPU, so replies will wait until the picture is done.</div>}
        {studio ? (
          <ImageStudio chars={chars} onCharUpdated={replaceChar} onBanner={setBanner} adult={adult} load={studioLoad} />
        ) : feedOpen ? (
          <FeedPane chars={chars} me={me} version={feedVersion} posting={posting} onAskPost={() => postUpdate(true)} onOpenChar={open}
            onAvatar={photoAsAvatar} onBanner={setBanner} onRead={() => setFeedUnread(0)} />
        ) : econOpen ? (
          <EconomyPane adult={adult} chars={chars} me={me} tab={econTab} onTab={setEconTab} onBanner={setBanner} onGift={giveGift} />
        ) : activeGroupId && groups.find((g) => g.id === activeGroupId) ? (
          <GroupPane key={activeGroupId} g={groups.find((g) => g.id === activeGroupId)!} chars={chars} me={me}
            onEdit={() => setEditingGroup(groups.find((g) => g.id === activeGroupId)!)} onCharUpdated={replaceChar} onBanner={setBanner} />
        ) : active ? (
          <ChatPane key={active.id} c={active} msgs={chats[active.id] ?? []} typing={!!typing[active.id]}
            models={models} onModel={setModel} onSend={send} onEdit={() => setEditing(active)} onClear={() => clearChat(active)} onMemories={() => setMemoriesOf(active.id)} onNudge={nudge} emoticons={me.emoticons}
            photo={!!photo[active.id]} focusKey={focusKey} proposal={(() => { const p = lifeOf(active).proposal; return p ? p.detail || p.to : null; })()}
            onAnswer={(yes) => answerProposal(active, yes)} onCall={() => startCall(active, false)} onSpeak={(m) => speak(active, m)} onCamera={() => send("Send me a selfie? \u{1F4F7}", true)} onOpenPhoto={(m) => setLightbox({ c: active, m })} onPhotoInfo={(m) => m.image && setPromptOf({ path: m.image, name: active.name })} offers={offers} onOffer={(m, yes) => answerOffer(active, m, yes)}
            actions={{ react: (m, e) => react(active, m, e), regen: (m) => m.image ? retakeSelfie(active, m) : regenerate(active, m), swipe: (m, d) => swipe(active, m, d),
              remove: (m) => removeMsg(active, m), edit: (m, t) => editMsg(active, m, t) }} />
        ) : (
          <div className="empty">
            <div className="empty-logo">{"\u{1F4AC}"}</div>
            <p>Pick a friend on the left to start chatting.</p>
          </div>
        )}
      </main>

      {sparkToast && <div className="spark-toast" onClick={() => setSparkToast(null)}>{sparkToast}</div>}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.key} className="toast" onClick={() => open(t.c)}>
            <div className="toast-head"><span>Kindred</span>
              <button onClick={(e) => { e.stopPropagation(); setToasts((ts) => ts.filter((x) => x.key !== t.key)); }}>{"\u2715"}</button></div>
            <div className="toast-body">
              <Avatar emoji={t.c.avatar} path={t.c.avatarPath} color={t.c.color} />
              <div><b>{t.c.name}</b> says:<div className="toast-text">{me.emoticons ? convertSmileys(t.text) : t.text}</div></div>
            </div>
          </div>
        ))}
      </div>

      {call && <CallWindow key={call.c.id} c={byId(call.c.id) ?? call.c} userName={me.userName} incoming={call.incoming} answer={call.answer} chatTail={callTail(call.c)} extra={economyContext(byId(call.c.id) ?? call.c, me.userName)}
        memories={() => api.listMemories(call.c.id).then(selectMemories)} onEnd={endCall} />}
      {ringing && !call && <div className="incoming-call">
        <Avatar big emoji={ringing.avatar} path={ringing.avatarPath} color={ringing.color} />
        <div><b>{ringing.name}</b> is calling{"\u2026"}</div>
        <button className="primary" onClick={() => startCall(ringing, true)}>{"\u{1F4DE}"} Accept</button>
        <button className="hangup" onClick={() => { const c = ringing; setRinging(null); saveCallLog(c, { d: 0, missed: true, incoming: true, lines: [] }, true); }}>Decline</button>
      </div>}
      {editing && <Editor takenNames={chars.map((x) => x.name)} onTestCall={(c) => { setEditing(null); setRinging(c); }} initial={editing} models={models} userName={me.userName} onSaved={onSaved} onDeleted={onDeleted}
        onClose={() => setEditing(null)} onTestProactive={(c, n) => runProactive(c, true, n)} />}
      {gallery && <TemplateGallery onClose={() => setGallery(false)} onPick={(d) => { setGallery(false); setEditing({ ...blankCharacter(), ...d, id: "", mood: d.baselineMood ?? "cosy" }); }} />}
      {editingGroup && <GroupEditor initial={editingGroup} chars={chars} onClose={() => setEditingGroup(null)}
        onSaved={(g) => { setGroups((gs) => gs.some((x) => x.id === g.id) ? gs.map((x) => x.id === g.id ? g : x) : [...gs, g]); setEditingGroup(null); setActiveGroupId(g.id); setActiveId(null); }}
        onDeleted={(id) => { setGroups((gs) => gs.filter((x) => x.id !== id)); if (activeGroupId === id) setActiveGroupId(null); setEditingGroup(null); }} />}
      {memoriesOf && byId(memoriesOf) && <MemoriesDialog c={byId(memoriesOf)!} onClose={() => setMemoriesOf(null)} onJump={jumpTo} onAvatar={(p) => photoAsAvatar(byId(memoriesOf)!, p)} onSummarise={() => runSummary(memoriesOf, true)} />}
      {meOpen && profile && <MeEditor initial={profile} chars={chars} onClose={() => setMeOpen(false)} onSave={async (p) => {
        await profileApi.save(p); setProfile(p); setMeOpen(false);
        const name = p.fields.displayName.value.trim();
        if (name && name !== me.userName) saveMe({ ...me, userName: name });
      }} />}
      {promptOf && <PromptDialog path={promptOf.path} adult={adult} charName={promptOf.name} onClose={() => setPromptOf(null)}
        onReuse={(r, fresh) => { setPromptOf(null); setStudioLoad({ p: reuseParams(r, fresh), n: Date.now() }); setStudio(true); }} />}
      {lightbox && lightbox.m.image && <Lightbox path={lightbox.m.image} title={`${lightbox.c.name} selfie`} busy={!!photo[lightbox.c.id]} onClose={() => setLightbox(null)}
        onAvatar={() => photoAsAvatar(lightbox.c, lightbox.m.image!)} onRegen={() => retakeSelfie(lightbox.c, lightbox.m)} />}
      {setup && <SetupChecklist onClose={() => setSetup(false)} />}
      {options && <OptionsDialog onSetup={() => { setOptions(false); setSetup(true); }} adult={adult} onAdult={async (on) => { const s = await saveAdult(on, on); setAdult(s.enabled); if (!s.enabled && econTab === "afterdark") setEconTab("cafe"); }} me={me} onSave={(s) => { saveMe(s); setOptions(false); }} onClose={() => setOptions(false)} />}
    </div>
  );
}

function OptionsDialog({ me, onSave, onClose, adult, onAdult, onSetup }: { onSetup: () => void; me: Settings; onSave: (s: Settings) => void; onClose: () => void; adult: boolean; onAdult: (on: boolean) => Promise<void> }) {
  const [s, setS] = useState(me);
  const muted = new Set(s.mutedSounds.split(",").filter(Boolean));
  const toggleEv = (ev: SoundEvent) => { const m = new Set(muted); m.has(ev) ? m.delete(ev) : m.add(ev); setS({ ...s, mutedSounds: [...m].join(",") }); };
  // live preview of theme and volume while the dialog is open
  useEffect(() => { document.documentElement.dataset.theme = s.theme; configureSounds(s); }, [s]);
  const cancel = () => { document.documentElement.dataset.theme = me.theme; configureSounds(me); onClose(); };
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => { autostartEnabled().then(setAutostart).catch(() => setAutostart(null)); }, []);
  const toggleAutostart = async () => {
    try { if (autostart) await disableAutostart(); else await enableAutostart(); setAutostart(await autostartEnabled()); } catch (e) { console.warn("[autostart]", e); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="modal small">
        <div className="modal-title">Options<button className="x" onClick={cancel}>{"\u2715"}</button></div>
        <div className="modal-body">
          <div className="opt-row">Theme</div>
          <div className="theme-pick">
            {THEMES.map((t) => <button key={t.id} data-theme-swatch={t.id} className={s.theme === t.id ? "sel" : ""} onClick={() => setS({ ...s, theme: t.id as Theme })}><i />{t.label}</button>)}
          </div>
          <div className="opt-row">Quiet hours (no one messages you first)
            <span><input type="time" value={s.quietStart} onChange={(e) => setS({ ...s, quietStart: e.target.value })} /> to{" "}
              <input type="time" value={s.quietEnd} onChange={(e) => setS({ ...s, quietEnd: e.target.value })} /></span>
          </div>
          <small>Set both to the same time to turn quiet hours off. Characters also won't message you while you're Busy or Appear offline.</small>
          <label className="switch-row">
            <span className={`switch${s.emoticons ? " on" : ""}`} role="switch" aria-checked={s.emoticons} tabIndex={0} onClick={() => setS({ ...s, emoticons: !s.emoticons })}><i /></span>
            Turn text smileys like :) (L) (Y) into emoticons
          </label>
          <label className="switch-row">
            <span className={`switch${s.closeToTray ? " on" : ""}`} role="switch" aria-checked={s.closeToTray} tabIndex={0} onClick={() => setS({ ...s, closeToTray: !s.closeToTray })}><i /></span>
            Closing the window keeps me running in the tray
          </label>
          {autostart !== null && <label className="switch-row">
            <span className={`switch${autostart ? " on" : ""}`} role="switch" aria-checked={autostart} tabIndex={0} onClick={toggleAutostart}><i /></span>
            Start with Windows (applies immediately)
          </label>}
          <label className="switch-row">
            <span className={`switch${adult ? " on" : ""}`} role="switch" aria-checked={adult} tabIndex={0} onClick={() => {
              if (adult) { onAdult(false).catch(() => {}); return; }
              if (confirm("Show adult (18+) content?\n\nThis adds the After Dark shop (lingerie, adult toys and similar, described tastefully). Please confirm you are 18 or older.")) onAdult(true).catch(() => {});
            }}><i /></span>
            Show adult (18+) content <small>(applies immediately)</small>
          </label>
          <label className="switch-row">
            <span className={`switch${s.sound ? " on" : ""}`} role="switch" aria-checked={s.sound} tabIndex={0} onClick={() => setS({ ...s, sound: !s.sound })}><i /></span>
            Sounds
          </label>
          <ConnectedOptions />
          <DataBackups />
          <button onClick={onSetup}>Setup checklist…</button>
          {s.sound && <>
            <label className="inline">Volume <input type="range" min={0} max={100} value={s.volume} onChange={(e) => setS({ ...s, volume: Number(e.target.value) })} /> {s.volume}%</label>
            <ul className="sound-list">
              {SOUND_EVENTS.map((ev) => (
                <li key={ev.id}>
                  <span className={`switch small${muted.has(ev.id) ? "" : " on"}`} role="switch" aria-checked={!muted.has(ev.id)} tabIndex={0} onClick={() => toggleEv(ev.id)}><i /></span>
                  {ev.label}<button className="link" onClick={() => play(ev.id, true)}>preview</button>
                </li>
              ))}
            </ul>
          </>}
        </div>
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={cancel}>Cancel</button>
          <button className="primary" onClick={() => onSave(s)}>Save</button>
        </div>
      </div>
    </div>
  );
}

/** Accept / Decline on a character's gift or offer; shows the outcome afterwards. */
function OfferButtons({ o, gift, onAnswer }: { o: Offer; gift?: boolean; onAnswer: (accept: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  if (o.status !== "pending") return <div className="offer-state">{o.status === "accepted" ? (gift ? "\u2713 Added to your inventory" : "\u2713 Accepted") : o.status === "declined" ? "Declined" : "Lapsed (item no longer yours)"}</div>;
  const go = (yes: boolean) => { setBusy(true); Promise.resolve(onAnswer(yes)).finally(() => setBusy(false)); };
  return <div className="offer-btns"><button className="primary" disabled={busy} onClick={() => go(true)}>{gift ? "\u{1F381} Accept gift" : "Accept"}</button>
    {!gift && <button disabled={busy} onClick={() => go(false)}>Decline</button>}</div>;
}

function ChatPane(props: { c: Character; msgs: Msg[]; typing: boolean; models: string[]; onModel: (m: string) => void; onSend: (t: string) => void; onEdit: () => void; onClear: () => void; onMemories: () => void; onNudge: () => void; emoticons: boolean; actions: MsgActions;
  focusKey: string | null; proposal: string | null; onAnswer: (yes: boolean) => void; onCall: () => void; onSpeak: (m: Msg) => void;
  photo: boolean; onCamera: () => void; onOpenPhoto: (m: Msg) => void; onPhotoInfo: (m: Msg) => void; offers: Record<number, Offer>; onOffer: (m: Msg, accept: boolean) => void; }) {
  const { c, msgs, typing, models, onModel, onSend, onEdit, onClear, onMemories, onNudge, emoticons, actions, photo, onCamera, onOpenPhoto, onPhotoInfo, offers, onOffer, focusKey, proposal, onAnswer, onCall, onSpeak } = props;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const last = msgs[msgs.length - 1];
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown((n) => n - 1), 1000); return () => clearTimeout(t); }, [cooldown]);
  const doNudge = () => { if (cooldown > 0 || typing) return; setCooldown(20); onNudge(); };
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = focusKey ? document.getElementById(`msg-${focusKey}`) : null;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    else endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, typing, focusKey, proposal]);
  const submit = () => { const t = draft.trim(); if (!t || typing) return; setDraft(""); onSend(t); };
  const modelOptions = models.includes(c.model) ? models : [c.model, ...models];

  return (
    <>
      <header className="chat-head">
        <Avatar big emoji={c.avatar} path={c.avatarPath} color={c.color}><span className={`dot ${c.status}`} /></Avatar>
        <div className="ch-info">
          <div className="ch-name">{c.name} <span className="mood" title={`Feeling ${c.mood} \u00B7 ${closenessLabel(c.closeness)} (${c.closeness}/100)`}>{MOOD_EMOJI[c.mood]}</span> <span className="ch-status">({statusLabel[c.status]})</span></div>
          <div className="c-pm">{c.personalMessage}</div>
          <div className="ch-actions">
            <button className="link" onClick={onEdit}>Edit contact</button>
            <button className="link" onClick={onCall} disabled={typing}>{"\u{1F4DE}"} Call</button>
            <button className="link" onClick={onMemories}>Profile &amp; memories</button>
            <button className="link" onClick={onClear} disabled={typing}>Clear chat</button>
          </div>
        </div>
        <label className="model-pick">Model
          <select value={c.model} onChange={(e) => onModel(e.target.value)}>
            {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </header>
      <div className="messages">
        {msgs.map((m) => m.text === NUDGE ? (
          <div key={m.key} className="nudge-line msg-hover">
            {m.dbId && <MsgTools mine onDelete={() => actions.remove(m)} busy={typing} />}{"\u{1F44B}"} {m.from === "me" ? "You sent a nudge!" : `${c.name} sent you a nudge!`} <small>{fmtDay(m.time)}</small></div>
        ) : (
          <div key={m.key} id={`msg-${m.key}`} className={`bubble-row ${m.from === "me" ? "mine" : "theirs"}${m.error ? " error" : ""}${m.key === focusKey ? " focus" : ""}`}>
            <div className="bubble">
              {m.dbId && editingKey !== m.key && <MsgTools mine={m.from === "me"} reaction={m.reaction} busy={typing}
                onReact={m.from === "them" && !m.error ? (e) => actions.react(m, e) : undefined}
                canRegen={m.from === "them" && m === last && !m.proactive && !parseCall(m.text)}
                onRegen={() => actions.regen(m)}
                canEdit={m.from === "me" && !m.image && !m.text.startsWith(GIFT)} onEdit={() => setEditingKey(m.key)}
                onDelete={() => actions.remove(m)} />}
              <div className="b-meta">{m.from === "me" ? "You" : c.name} {"\u00B7"} {fmtDay(m.time)}{m.proactive && <span className="b-first"> {"\u00B7"} messaged you first</span>}
                <AltSwitch index={m.altIndex ?? 0} count={m.alternates?.length ?? 0} disabled={typing} onSwipe={(d) => actions.swipe(m, d)} />
                {m.from === "them" && !m.error && !m.image && !parseCall(m.text) && <button className="speak-btn" title="Play as a voice note" onClick={() => onSpeak(m)}>{"\u{1F50A}"}</button>}</div>
              {parseCall(m.text) ? <CallBubble log={parseCall(m.text)!} name={c.name} />
                : m.text.startsWith(GIFT) ? <div className="b-text gift-bubble">{"\u{1F381}"} {m.from === "me" ? `You gave ${c.name}` : `${c.name} gave you`} {m.text.slice(GIFT.length).trim()}
                    {m.from === "them" && m.dbId && offers[m.dbId] && <OfferButtons o={offers[m.dbId]} gift onAnswer={(yes) => onOffer(m, yes)} />}</div>
                : m.text.startsWith(OFFER) ? <div className="b-text gift-bubble offer-bubble">{c.name} {m.text.slice(OFFER.length).trim()}
                    {m.dbId && offers[m.dbId] && <OfferButtons o={offers[m.dbId]} onAnswer={(yes) => onOffer(m, yes)} />}</div>
                : m.image ? <PhotoBubble path={m.image} caption={selfieScene(m.text)} onOpen={() => onOpenPhoto(m)} onInfo={() => onPhotoInfo(m)} />
                : editingKey === m.key
                ? <EditBox initial={m.text} onCancel={() => setEditingKey(null)} onSave={(t) => { setEditingKey(null); actions.edit(m, t); }} />
                : <div className="b-text">{emoticons && !m.error ? convertSmileys(m.text) : m.text}</div>}
              <ReactionChip emoji={m.reaction} by={m.from === "me" ? c.name : "You"} />
            </div>
          </div>
        ))}
        {typing && <div className="typing">{c.name} is typing<span className="dots"><i/><i/><i/></span></div>}
        {photo && <div className="typing">{"\u{1F4F7}"} {c.name} is taking a photo<span className="dots"><i/><i/><i/></span></div>}
        {proposal && !typing && <div className="proposal-card">{"\u{1F49E}"} <span>{c.name} would like to become your <b>{proposal}</b>.</span>
          <button className="primary" onClick={() => onAnswer(true)}>Accept</button><button onClick={() => onAnswer(false)}>Not now</button></div>}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <EmojiPicker target={taRef} value={draft} onChange={setDraft} />
        <textarea ref={taRef} value={draft} placeholder={`Message ${c.name}\u2026`} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <div className="composer-buttons">
          <button onClick={submit} disabled={typing || !draft.trim()}>Send</button>
          <button className="camera-btn" onClick={onCamera} disabled={typing || photo} title={`Ask ${c.name} for a selfie`}>{"\u{1F4F7}"}</button>
          <button className="nudge-btn" onClick={doNudge} disabled={typing || cooldown > 0} title="Send a nudge (shakes the window)">{cooldown > 0 ? `${cooldown}s` : "Nudge!"}</button>
        </div>
      </div>
    </>
  );
}
function CallBubble({ log, name }: { log: CallLog; name: string }) {
  if (log.missed) return <div className="call-log missed">{"\u{1F4DE}"} {log.incoming ? `Missed call from ${name}` : log.declined && log.declined !== "offline" ? `${name} couldn't pick up (${log.declined})` : `${name} didn't answer`}</div>;
  return (
    <details className="call-log">
      <summary>{"\u{1F4DE}"} Call {"\u00B7"} {fmtDuration(log.d)} {log.lines.length ? <small>(transcript)</small> : null}</summary>
      {log.lines.map((l, i) => <div key={i}><b>{l.me ? "You" : name}:</b> {l.t}</div>)}
    </details>
  );
}