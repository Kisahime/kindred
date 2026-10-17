import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { Lightbox, PhotoBubble } from "./PhotoBubble";
import { convertSmileys } from "./emoticons";
import { streamChat } from "./ollama";
import { buildCommentReplyPrompt, FeedConfig, FeedFrequency, FeedPost, lifeApi } from "./life";
import { Character, Group, MOOD_EMOJI, Settings } from "./types";
import { groupPlanSummary, PlannedMeetup, planSummary } from "./together";

const REACTIONS = ["\u2764\uFE0F", "\u{1F602}", "\u{1F44D}", "\u{1F62E}", "\u{1F622}", "\u{1F525}"];
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString();
};

interface Props {
  chars: Character[]; groups?: Group[]; me: Settings; version: number; posting: boolean;
  onAskPost: () => void; onOpenChar: (c: Character) => void; onOpenGroup?: (g: Group) => void; onAvatar: (c: Character, path: string) => void; onBanner: (s: string) => void; onRead: () => void;
  plans?: PlannedMeetup[];
}

/** Messenger-style "What's new" feed. */
export function FeedPane({ chars, groups = [], me, version, posting, onAskPost, onOpenChar, onOpenGroup, onAvatar, onBanner, onRead, plans = [] }: Props) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cfg, setCfg] = useState<FeedConfig>({ frequency: "sometimes" });
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [replying, setReplying] = useState<Record<number, boolean>>({});
  const [box, setBox] = useState<{ c: Character; path: string } | null>(null);
  const reload = () => lifeApi.listFeed().then(setPosts).catch((e) => onBanner(String(e)));
  useEffect(() => { reload().then(() => lifeApi.markFeedRead().then(onRead).catch(() => {})); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { lifeApi.getFeedConfig().then(setCfg).catch(() => {}); }, []);
  const byId = (id: string) => chars.find((c) => c.id === id);
  const patch = (id: number, f: (p: FeedPost) => FeedPost) => setPosts((ps) => ps.map((p) => p.id === id ? f(p) : p));

  const react = (p: FeedPost, e: string) => {
    const r = p.reaction === e ? "" : e;
    patch(p.id, (x) => ({ ...x, reaction: r }));
    lifeApi.setFeedReaction(p.id, r).catch((err) => onBanner(String(err)));
  };
  const comment = async (p: FeedPost) => {
    const c = byId(p.characterId), text = (drafts[p.id] ?? "").trim();
    if (!c || !text || replying[p.id]) return;
    setDrafts((d) => ({ ...d, [p.id]: "" }));
    try {
      const mine = await lifeApi.addFeedComment(p.id, true, text);
      const withMine = { ...p, comments: [...p.comments, mine] };
      patch(p.id, () => withMine);
      setReplying((r) => ({ ...r, [p.id]: true }));
      const reply = (await streamChat(c.model, buildCommentReplyPrompt(c, me.userName, withMine, Object.fromEntries(chars.map((x) => [x.id, x.name]))) as never, { onToken: () => {} })).trim().replace(/^"|"$/g, "");
      if (reply) { const theirs = await lifeApi.addFeedComment(p.id, false, reply); patch(p.id, (x) => ({ ...x, comments: [...x.comments, theirs] })); }
    } catch (e) { onBanner(`Comment failed: ${e instanceof Error ? e.message : e}`); }
    finally { setReplying((r) => ({ ...r, [p.id]: false })); }
  };
  const remove = async (p: FeedPost) => { await lifeApi.deleteFeedPost(p.id).catch((e) => onBanner(String(e))); setPosts((ps) => ps.filter((x) => x.id !== p.id)); };
  const setFreq = (f: FeedFrequency) => { const n = { ...cfg, frequency: f }; setCfg(n); lifeApi.saveFeedConfig(n).catch((e) => onBanner(String(e))); };

  return (
    <div className="feed">
      <header className="chat-head feed-head">
        <div className="ch-info"><div className="ch-name">{"\u2728"} What's new</div>
          <div className="c-pm">Status updates and photos from your contacts, who also like and comment on each other's posts (only while the app is open, never in quiet hours).</div></div>
        <label className="model-pick">How often
          <select value={cfg.frequency} onChange={(e) => setFreq(e.target.value as FeedFrequency)}>
            <option value="off">Off</option><option value="rarely">Rarely (~3 h)</option><option value="sometimes">Sometimes (~1 h)</option><option value="often">Often (~25 min)</option>
          </select></label>
        <button onClick={onAskPost} disabled={posting}>{posting ? "Posting\u2026" : "Ask for an update"}</button>
      </header>
      <div className="messages feed-list">
        {plans.length > 0 && <section className="upcoming">
          <div className="upcoming-title">{"\u{1F4C5}"} Upcoming meet-ups</div>
          {[...plans].sort((x, y) => x.dueAt - y.dueAt).map((p) => {
            if (p.groupId) {
              const g = groups.find((x) => x.id === p.groupId);
              if (!g) return null;
              const attNames = (p.attendeeIds?.length ? p.attendeeIds.map((id) => byId(id)?.name).filter(Boolean) as string[] : g.memberIds.map((id) => byId(id)?.name).filter(Boolean) as string[]);
              return (
                <div key={p.id} className="upcoming-row" onClick={() => onOpenGroup?.(g)}>
                  {p.status === "ready" ? "\u2705 " : ""}{groupPlanSummary(p, g.name, attNames)}
                </div>
              );
            }
            const c = byId(p.charId);
            return c ? (
              <div key={p.id} className="upcoming-row" onClick={() => onOpenChar(c)}>{p.status === "ready" ? "\u2705 " : ""}{planSummary(p, c.name)}</div>
            ) : null;
          })}
        </section>}
        {posts.length === 0 && <div className="mem-empty">Nothing yet. Updates appear here over time, or press "Ask for an update".</div>}
        {posts.map((p) => {
          const c = byId(p.characterId);
          if (!c) return null;
          return (
            <article key={p.id} className="post">
              <div className="post-head">
                <span onClick={() => onOpenChar(c)} className="post-who"><Avatar emoji={c.avatar} path={c.avatarPath} color={c.color} /><b>{c.name}</b> {MOOD_EMOJI[c.mood]}</span>
                <small>{ago(p.createdAt)}</small><span className="spacer" />
                <button className="link" onClick={() => remove(p)} title="Delete post">{"\u2715"}</button>
              </div>
              <div className="post-text">{me.emoticons ? convertSmileys(p.content) : p.content}</div>
              {p.imagePath && <PhotoBubble path={p.imagePath} caption="" onOpen={() => setBox({ c, path: p.imagePath! })} />}
              <div className="post-react">
                {REACTIONS.map((e) => <button key={e} className={p.reaction === e ? "sel" : ""} onClick={() => react(p, e)}>{e}</button>)}
              </div>
              {!!p.likes?.length && <div className="post-likes">{"\u2764\uFE0F"} Liked by {p.likes.map((id) => byId(id)?.name).filter(Boolean).join(", ")}</div>}
              {p.comments.map((m) => { const who = m.authorId ? byId(m.authorId) : undefined; return <div key={m.id} className={`comment${m.fromUser ? " mine" : ""}${who ? " friend" : ""}`}><b>{m.fromUser ? "You" : who ? who.name : m.authorId ? "A friend" : c.name}:</b> {me.emoticons ? convertSmileys(m.content) : m.content}</div>; })}
              {replying[p.id] && <div className="typing">{c.name} is replying<span className="dots"><i/><i/><i/></span></div>}
              <div className="mem-add">
                <input value={drafts[p.id] ?? ""} placeholder={"Write a comment\u2026"} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && comment(p)} />
                <button onClick={() => comment(p)} disabled={!!replying[p.id]}>Comment</button>
              </div>
            </article>
          );
        })}
      </div>
      {box && <Lightbox path={box.path} title={`${box.c.name}_update`} onClose={() => setBox(null)} onAvatar={() => { onAvatar(box.c, box.path); setBox(null); }} />}
    </div>
  );
}
