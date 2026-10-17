// v1.3 Living World: 💌 Letters & diaries pane.
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { parseJson } from "./mind";
import { buildSystemPrompt, Character, closenessLabel, Settings } from "./types";
import { buildLetterReplyPrompt, DIARY_UNLOCK, diaryLevel, interpretLetter, Letter, letterThreads, lettersApi } from "./letters";

interface Props { chars: Character[]; me: Settings; version: number; onBanner: (s: string) => void; onRead: () => void; onOpenChar: (c: Character) => void; }
const when = (t: number) => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const LEVEL = ["", "first pages", "more personal", "deepest secrets"];

/** Writes the character's answer to the latest letter in a thread (and remembers it). */
export async function answerLetter(c: Character, userName: string, thread: Letter[]): Promise<Letter | null> {
  const raw = parseJson(await api.ollamaJson(c.model, buildLetterReplyPrompt(c, userName, thread, buildSystemPrompt(c, userName)), 0.8));
  const l = interpretLetter(raw, "letter");
  if (!l) return null;
  const last = thread[thread.length - 1];
  const saved = await lettersApi.add(c.id, "letter", false, l.title, l.body, last?.id ?? 0);
  api.addMemory(c.id, `${new Date().toLocaleDateString()}: ${userName} wrote me a letter ("${last?.title || "a letter"}") and I wrote back ("${l.title}").`, false, "letter").catch(() => {});
  return saved;
}

export function LettersPane({ chars, me, version, onBanner, onRead, onOpenChar }: Props) {
  const [tab, setTab] = useState<"letters" | "diaries">("letters");
  const [all, setAll] = useState<Letter[]>([]);
  const [sel, setSel] = useState<number | null>(null);      // thread root id
  const [diaryOf, setDiaryOf] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [writingTo, setWritingTo] = useState<string>("");     // new letter: character id
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);      // character id writing back
  const byId = (id: string) => chars.find((c) => c.id === id);
  const reload = () => lettersApi.list(null, null, 500).then(setAll).catch((e) => onBanner(String(e)));
  useEffect(() => { reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "letters") lettersApi.markRead(null, "letter").then(onRead).catch(() => {}); }, [tab, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const threads = useMemo(() => letterThreads(all).filter((t) => byId(t[0].characterId)), [all, chars]); // eslint-disable-line react-hooks/exhaustive-deps
  const thread = threads.find((t) => t[0].id === sel) ?? null;
  const diaries = all.filter((l) => l.kind === "diary");

  const send = async (c: Character, title: string, body: string, replyTo: number, base: Letter[]) => {
    if (!body.trim() || busy) return;
    setBusy(c.id);
    try {
      const mine = await lettersApi.add(c.id, "letter", true, title.trim() || (base[0] ? `Re: ${base[0].title}` : "A letter"), body.trim(), replyTo);
      setDraft(""); setNewTitle(""); setWritingTo("");
      setAll((a) => [mine, ...a]); setSel(base[0]?.id ?? mine.id);
      const theirs = await answerLetter(c, me.userName, [...base, mine]);
      if (theirs) setAll((a) => [theirs, ...a]);
      else onBanner(`${c.name} read your letter but couldn't find the words yet.`);
    } catch (e) { onBanner(`Letter failed: ${e instanceof Error ? e.message : e}`); }
    finally { setBusy(null); }
  };
  const remove = async (l: Letter) => { await lettersApi.remove(l.id).catch((e) => onBanner(String(e))); setAll((a) => a.filter((x) => x.id !== l.id)); };

  const paper = (l: Letter, c: Character) => (
    <article key={l.id} className={`letter-paper${l.fromUser ? " mine" : ""}`}>
      <div className="letter-meta"><b>{l.fromUser ? `You \u2192 ${c.name}` : `${c.name} \u2192 you`}</b><small>{when(l.createdAt)}</small><span className="spacer" />
        <button className="link" title="Delete" onClick={() => remove(l)}>{"\u2715"}</button></div>
      <div className="letter-title">{l.title}</div>
      <div className="letter-body">{l.body}</div>
    </article>
  );

  return (
    <div className="feed letters">
      <header className="chat-head feed-head">
        <div className="ch-info"><div className="ch-name">{"\u{1F48C}"} Letters &amp; diaries</div>
          <div className="c-pm">Longer letters from friends who can message you first, and the diaries they keep once you're close.</div></div>
        <div className="letters-tabs">
          <button className={tab === "letters" ? "sel" : ""} onClick={() => setTab("letters")}>Letters</button>
          <button className={tab === "diaries" ? "sel" : ""} onClick={() => setTab("diaries")}>Diaries</button>
        </div>
      </header>
      {tab === "letters" ? (
        <div className="letters-main">
          <ul className="letters-list">
            <li className={`letters-new${sel === null ? " active" : ""}`} onClick={() => setSel(null)}>{"\u270D\uFE0F"} Write a letter{"\u2026"}</li>
            {threads.length === 0 && <li className="mem-empty">No letters yet. They arrive now and then from close friends (see Options), or write one yourself.</li>}
            {threads.map((t) => {
              const c = byId(t[0].characterId)!, last = t[t.length - 1];
              const unread = t.some((l) => !l.isRead);
              return (
                <li key={t[0].id} className={`${sel === t[0].id ? "active" : ""}${unread ? " unread" : ""}`} onClick={() => setSel(t[0].id)}>
                  <Avatar emoji={c.avatar} path={c.avatarPath} color={c.color} />
                  <div className="c-text"><div className="c-name">{t[0].title}</div><div className="c-pm">{c.name} {"\u00B7"} {t.length} {t.length === 1 ? "letter" : "letters"} {"\u00B7"} {when(last.createdAt)}</div></div>
                </li>
              );
            })}
          </ul>
          <div className="letters-view">
            {thread ? (() => {
              const c = byId(thread[0].characterId)!;
              return <>
                {thread.map((l) => paper(l, c))}
                {busy === c.id ? <div className="typing">{c.name} is writing back<span className="dots"><i /><i /><i /></span></div> : (
                  <div className="letter-compose">
                    <textarea rows={6} value={draft} placeholder={`Dear ${c.name},\u2026`} onChange={(e) => setDraft(e.target.value)} />
                    <div className="row-btns"><button className="link" onClick={() => onOpenChar(c)}>Open chat</button><span className="spacer" />
                      <button className="primary" disabled={!draft.trim() || !!busy} onClick={() => send(c, `Re: ${thread[0].title}`, draft, thread[thread.length - 1].id, thread)}>Send reply</button></div>
                  </div>)}
              </>;
            })() : (
              <div className="letter-compose new">
                <div className="letter-title">{"\u270D\uFE0F"} A new letter</div>
                <label className="inline">To <select value={writingTo} onChange={(e) => setWritingTo(e.target.value)}>
                  <option value="">(choose a friend)</option>{chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <input value={newTitle} placeholder="Title (optional)" onChange={(e) => setNewTitle(e.target.value)} />
                <textarea rows={8} value={draft} placeholder={"Dear \u2026"} onChange={(e) => setDraft(e.target.value)} />
                <div className="row-btns"><span className="spacer" />
                  <button className="primary" disabled={!writingTo || !draft.trim() || !!busy} onClick={() => { const c = byId(writingTo); if (c) send(c, newTitle, draft, 0, []); }}>{busy ? "Waiting for their answer\u2026" : "Send letter"}</button></div>
                <small>They write back straight away (it takes the model a moment).</small>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="letters-main">
          <ul className="letters-list">
            {chars.map((c) => {
              const lvl = diaryLevel(c.closeness), n = diaries.filter((d) => d.characterId === c.id).length;
              return (
                <li key={c.id} className={diaryOf === c.id ? "active" : ""} onClick={() => { setDiaryOf(c.id); if (lvl) lettersApi.markRead(c.id, "diary").then(reload).catch(() => {}); }}>
                  <Avatar emoji={c.avatar} path={c.avatarPath} color={c.color} />
                  <div className="c-text"><div className="c-name">{lvl ? "\u{1F4D6}" : "\u{1F512}"} {c.name}</div>
                    <div className="c-pm">{lvl ? `${n} ${n === 1 ? "page" : "pages"} \u00B7 ${LEVEL[lvl]}` : `unlocks at closeness ${DIARY_UNLOCK[0]} (now ${c.closeness})`}</div></div>
                </li>
              );
            })}
          </ul>
          <div className="letters-view">
            {(() => {
              const c = diaryOf ? byId(diaryOf) : null;
              if (!c) return <div className="mem-empty">Pick a friend. Characters write a diary page on evenings after you've chatted, once you're close (closeness {DIARY_UNLOCK.join(" / ")} unlock deeper pages).</div>;
              const lvl = diaryLevel(c.closeness);
              if (!lvl) return <div className="diary-locked">{"\u{1F512}"} {c.name}'s diary is private for now. It unlocks when you're closer: closeness {DIARY_UNLOCK[0]} ({closenessLabel(DIARY_UNLOCK[0])}); you're at {c.closeness}.</div>;
              const pages = diaries.filter((d) => d.characterId === c.id);
              return <>
                <div className="diary-cover">{"\u{1F4D6}"} {c.name}'s diary <small>({LEVEL[lvl]}{lvl < 3 ? `; deeper pages at closeness ${DIARY_UNLOCK[lvl]}` : ""})</small></div>
                {pages.length === 0 && <div className="mem-empty">No pages yet. {c.name} writes one on an evening after you've chatted.</div>}
                {pages.map((d) => (
                  <article key={d.id} className="letter-paper diary">
                    <div className="letter-meta"><b>{d.title}</b><small>{when(d.createdAt)}</small><span className="spacer" /><button className="link" title="Delete" onClick={() => remove(d)}>{"\u2715"}</button></div>
                    <div className="letter-body">{d.body}</div>
                  </article>
                ))}
              </>;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
