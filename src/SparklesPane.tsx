// ✨ Sparkles pane: Café clicker, character shops, inventory and wallet history.
import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { api } from "./api";
import { CATEGORIES, Category, cafe, CafeState, clickValue, costOf, levelOf, maxed, offlineCap, prestigeNeed, rate, softCap, branchMult, staffBoost, staffPerk, staffSlots, unlocked, unlockHint, UPGRADES } from "./cafe";
import { econApi, getStock, Item, onWallet, priceFor, saleToday, sellValue, SPARK, SPECIAL_MIN_CLOSENESS, visibleItem, Stock, Tx, dayKey, emitWallet, closenessDiscount } from "./economy";
import { Character, closenessLabel, Settings } from "./types";
import { adultGiftCheck, ADULT_CATALOG, ADULT_DEPTS, isAdult, weeklyAdult } from "./afterdark";
import { addToBasket, BasketLine, dailyNew, basketCount, basketTotal, CATALOG, checkout, DEAL_OFF, DEPARTMENTS, DeptId, featured, giftFit, MallItem, PRICE_BANDS, PriceBand, priceOf, search, seasonalSpecials, setQty, TAGS, weeklyDeals } from "./mall";

export type EconTab = "cafe" | "mall" | "afterdark" | "shops" | "inventory" | "wallet";
interface Props { adult: boolean; chars: Character[]; me: Settings; tab: EconTab; onTab: (t: EconTab) => void; onBanner: (s: string) => void;
  onGift: (c: Character, it: Item) => Promise<void>; }

const fmtN = (n: number) => n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.floor(n).toLocaleString();
const PERK_LABEL = { passive: "brews faster", click: "bigger brews", luck: "lucky customers" } as const;

export function useBalance() {
  const [b, setB] = useState<number | null>(null);
  useEffect(() => { econApi.balance().then(setB).catch(() => {}); return onWallet((x) => setB(x)); }, []);
  return b;
}

export function EconomyPane({ adult, chars, me, tab, onTab, onBanner, onGift }: Props) {
  const balance = useBalance();
  const [s, setS] = useState<CafeState>(cafe.s);
  useEffect(() => cafe.subscribe(setS), []);
  const wallet = (balance ?? 0) + Math.floor(s.pending);
  return (
    <div className="feed econ">
      <header className="chat-head feed-head">
        <div className="ch-info"><div className="ch-name">{SPARK} Sparkles</div><div className="ch-pm">{fmtN(wallet)} {SPARK} in your purse{s.pending >= 1 ? " (incl. caf\u00E9 till)" : ""}</div></div>
        <span className="spacer" />
        <nav className="econ-tabs">
          {([["cafe", "\u2615 Caf\u00E9"], ["mall", "\u{1F3EC} Shopping Centre"], ...(adult ? [["afterdark", "\u{1F319} After Dark 18+"] as const] : []), ["shops", "\u{1F6CD}\uFE0F Stalls"], ["inventory", "\u{1F392} Inventory"], ["wallet", "\u{1F4DC} Purse"]] as const).map(([id, l]) =>
            <button key={id} className={tab === id ? "sel" : ""} onClick={() => onTab(id)}>{l}</button>)}
        </nav>
      </header>
      <div className="messages econ-body">
        {tab === "cafe" && <CafeTab s={s} chars={chars} balance={balance ?? 0} onBanner={onBanner} />}
        {tab === "mall" && <MallTab chars={chars} balance={balance ?? 0} onBanner={onBanner} onInventory={() => onTab("inventory")} />}
        {tab === "afterdark" && adult && <AfterDarkTab chars={chars} balance={balance ?? 0} onBanner={onBanner} onInventory={() => onTab("inventory")} />}
        {tab === "shops" && <ShopsTab chars={chars} me={me} balance={balance ?? 0} onBanner={onBanner} />}
        {tab === "inventory" && <InventoryTab adult={adult} chars={chars} onBanner={onBanner} onGift={onGift} />}
        {tab === "wallet" && <WalletTab />}
      </div>
    </div>
  );
}

function CafeTab({ s, chars, balance, onBanner }: { s: CafeState; chars: Character[]; balance: number; onBanner: (x: string) => void }) {
  const [pops, setPops] = useState<{ k: number; v: number }[]>([]);
  const [cat, setCat] = useState<Category>("click");
  const now = Date.now();
  const brew = () => { const v = cafe.click(); const k = Math.random(); setPops((p) => [...p.slice(-6), { k, v }]); setTimeout(() => setPops((p) => p.filter((x) => x.k !== k)), 900); };
  const err = (e: unknown) => onBanner(e instanceof Error ? e.message : String(e));
  const perMin = rate(s, chars) * 60;
  const have = balance + Math.floor(s.pending);
  return (
    <div className="cafe">
      {cafe.offline >= 1 && <div className="banner info" onClick={() => { cafe.offline = 0; }}>{"\u{1F319}"} While you were away the caf{"\u00E9"} earned {fmtN(cafe.offline)} {SPARK} (up to {offlineCap(s) / 3600_000} hours count).</div>}
      <section className="cafe-main">
        <div className="cafe-counter">
          <button className={`brew${now < s.rushUntil ? " rush" : ""}`} onClick={brew} title="Brew a coffee">{"\u2615"}
            {pops.map((p) => <span key={p.k} className="pop">+{p.v.toFixed(p.v < 10 ? 1 : 0)}</span>)}</button>
          <div className="cafe-stats">
            <b>{fmtN(have)} {SPARK}</b>
            <small>{clickValue(s, chars).toFixed(1)} per brew {"\u00B7"} {perMin.toFixed(1)} per minute passive{s.branches ? ` \u00B7 \u00D7${(1 + 0.25 * s.branches).toFixed(2)} branch bonus` : ""}</small>
            {now < s.rushUntil && <span className="cafe-event">{"\u{1F525}"} Rush hour! Brews are worth 3{"\u00D7"} for {Math.ceil((s.rushUntil - now) / 1000)}s</span>}
            {s.golden && <button className="golden" onClick={() => cafe.catchGolden().catch(err)}>{"\u{1F31F}"} A golden customer is here! Serve them (+{s.golden.reward} {SPARK})</button>}
          </div>
        </div>
      </section>
      <h4>Upgrades <small>{"\u2013"} passive limit {(softCap(s) * branchMult(s) * 3600).toFixed(0)}/h (seating raises it)</small></h4>
      <nav className="cafe-cats">
        {CATEGORIES.map((k) => { const ups = UPGRADES.filter((u) => u.cat === k.id), open = ups.filter((u) => unlocked(s, u)).length;
          const canBuy = ups.some((u) => unlocked(s, u) && !maxed(u, levelOf(s, u.id)) && costOf(u, levelOf(s, u.id)) <= have);
          return <button key={k.id} className={`${cat === k.id ? "sel" : ""}${open ? "" : " locked"}`} onClick={() => setCat(k.id)} title={k.blurb}>
            {k.emoji} {k.label} <small>{open}/{ups.length}</small>{canBuy && <i className="cat-dot" />}</button>; })}
      </nav>
      <p className="muted">{CATEGORIES.find((k) => k.id === cat)!.blurb}{cat === "staff" || cat === "night" ? " (kept when you open a new branch)" : ""}</p>
      <div className="shop-grid">
        {UPGRADES.filter((u) => u.cat === cat).map((u) => { const lvl = levelOf(s, u.id), cost = costOf(u, lvl), open = unlocked(s, u), top = maxed(u, lvl); return (
          <button key={u.id} className={`shop-card${open ? "" : " locked"}`} disabled={!open || top || have < cost} onClick={() => cafe.buy(u.id).catch(err)} title={open ? u.blurb : unlockHint(u)}>
            <span className="si-emoji">{open ? u.emoji : "\u{1F512}"}</span><b>{u.name}</b>{lvl > 0 && <span className="lvl">Lv {lvl}{u.max ? `/${u.max}` : ""}</span>}
            <small>{open ? u.blurb : unlockHint(u)}</small><span className="price">{!open ? "Locked" : top ? "MAX \u2714" : `${fmtN(cost)} ${SPARK}`}</span>
          </button>); })}
      </div>
      <h4>Staff ({s.staff.length}/{staffSlots(s)}) <small>{"\u2013"} boosts grow with closeness, so chatting helps the caf{"\u00E9"}</small></h4>
      <div className="staff-list">
        {chars.map((c) => { const on = s.staff.includes(c.id); return (
          <div key={c.id} className={`staff${on ? " on" : ""}`}>
            <Avatar emoji={c.avatar} path={c.avatarPath} color={c.color} />
            <div><b>{c.name}</b><small>{PERK_LABEL[staffPerk(c.id)]} +{Math.round(staffBoost(c.closeness) * 100)}% {"\u00B7"} {closenessLabel(c.closeness)}</small></div>
            <button onClick={() => cafe.toggleStaff(c.id).catch(err)}>{on ? "Let go" : "Hire"}</button>
          </div>); })}
      </div>
      <h4>Open a new branch</h4>
      <p className="muted">Starts a fresh caf{"\u00E9"} (upgrades reset except Staff and Night ones; hired staff stay) with a permanent +25% to everything. Progress: {fmtN(s.branchEarned)} / {fmtN(prestigeNeed(s))} {SPARK} earned in this branch.</p>
      <button className="primary" disabled={s.branchEarned < prestigeNeed(s)} onClick={() => confirm("Open a new branch? Your upgrades reset, but you keep staff and gain +25% forever.") && cafe.openBranch().catch(err)}>{"\u{1F3EA}"} Open branch #{s.branches + 2}</button>
    </div>
  );
}

function ShopsTab({ chars, me, balance, onBanner }: { chars: Character[]; me: Settings; balance: number; onBanner: (x: string) => void }) {
  const [who, setWho] = useState<string>(chars[0]?.id ?? "");
  const [stock, setStock] = useState<Stock | null>(null);
  const [busy, setBusy] = useState(false);
  const c = chars.find((x) => x.id === who);
  const day = dayKey();
  useEffect(() => {
    if (!c) return;
    let live = true; setStock(null); setBusy(true);
    getStock(c, me.userName, api.ollamaJson, day).then((s) => live && setStock(s)).catch((e) => live && onBanner(e instanceof Error ? e.message : String(e))).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [who]); // eslint-disable-line react-hooks/exhaustive-deps
  const buyIt = async (i: number) => {
    if (!c || !stock) return;
    const { price } = priceFor(stock.items[i], c, day);
    try {
      const [it, bal] = await econApi.shopBuy(c.id, day, i, price);
      emitWallet(bal, `Bought ${it.emoji} ${it.name}`);
      setStock({ ...stock, items: stock.items.map((x, j) => j === i ? { ...x, sold: true } : x) });
    } catch (e) { onBanner(String(e)); }
  };
  return (
    <div className="shops">
      <div className="staff-list who">
        {chars.map((x) => <button key={x.id} className={x.id === who ? "sel" : ""} onClick={() => setWho(x.id)}><Avatar emoji={x.avatar} path={x.avatarPath} color={x.color} /> {x.name}</button>)}
      </div>
      {c && <>
        {busy && <div className="typing">{c.name} is setting up the stall<span className="dots"><i/><i/><i/></span></div>}
        {stock && <>
          <h4>{stock.stallName} <small>{stock.tagline}</small></h4>
          <p className="muted">{saleToday(c.id, day) ? "\u{1F3F7}\uFE0F Sale today: 20% off everything! " : ""}{closenessDiscount(c.closeness) ? `${c.name} gives you ${Math.round(closenessDiscount(c.closeness) * 100)}% off as a ${closenessLabel(c.closeness)}. ` : `Get closer to ${c.name} for a friends discount. `}New stock tomorrow.</p>
          <div className="shop-grid">
            {stock.items.map((it, i) => {
              const { price, off } = priceFor(it, c, day);
              const locked = it.rarity === "special" && c.closeness < SPECIAL_MIN_CLOSENESS;
              return (
                <button key={i} className={`shop-card ${it.rarity}`} disabled={!!it.sold || locked || balance < price} onClick={() => buyIt(i)}
                  title={locked ? `Only for friends (closeness ${SPECIAL_MIN_CLOSENESS}+)` : it.description}>
                  <span className="si-emoji">{it.emoji}</span><b>{it.name}</b>{it.rarity !== "common" && <span className="lvl">{it.rarity}</span>}
                  {it.itemType && <span className="itype">{it.itemType}</span>}<small>{it.description}{it.wearable ? " \u00B7 wearable" : ""}</small>
                  <span className="price">{it.sold ? "Sold \u2714" : locked ? "\u{1F512} friends only" : <>{off > 0 && <s>{it.price}</s>} {price} {SPARK}</>}</span>
                </button>);
            })}
          </div>
        </>}
      </>}
    </div>
  );
}

function InventoryTab({ adult, chars, onBanner, onGift }: { adult: boolean; chars: Character[]; onBanner: (x: string) => void; onGift: (c: Character, it: Item) => Promise<void> }) {
  const [items, setItems] = useState<Item[]>([]);
  const [to, setTo] = useState<Record<number, string>>({});
  const reload = () => econApi.inventory(null).then(setItems).catch((e) => onBanner(String(e)));
  useEffect(() => { reload(); }, [adult]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => id === "afterdark" ? "After Dark" : id === "mall" ? "the Shopping Centre" : chars.find((c) => c.id === id)?.name ?? "a shop";
  const shown = items.filter((i) => adult ? true : visibleItem(i) && !isAdult(i));
  const mine = shown.filter((i) => i.owner === "me"), given = shown.filter((i) => i.owner !== "me");
  const gift = async (it: Item) => {
    const c = chars.find((x) => x.id === (to[it.id] ?? it.fromChar)) ?? chars[0];
    if (!c) return;
    if (isAdult(it)) {
      const chk = adultGiftCheck(c, adult);
      if (!chk.ok) { onBanner(chk.reason); return; }
      if (chk.warning && !confirm(`${chk.warning}\n\nGive ${it.emoji} ${it.name} to ${c.name} anyway?`)) return;
      try { await onGift(c, it); reload(); } catch (e) { onBanner(String(e)); }
      return;
    }
    const fit = giftFit(c, it, "you");
    if (fit.warning && !confirm(`${fit.warning}\n\nGive ${it.emoji} ${it.name} to ${c.name} anyway?`)) return;
    try { await onGift(c, it); reload(); } catch (e) { onBanner(String(e)); }
  };
  const sell = async (it: Item) => {
    const seller = chars.some((c) => c.id === it.fromChar);
    const v = sellValue(it, seller);
    if (!confirm(`Sell ${it.emoji} ${it.name} back to ${name(it.fromChar)} for ${v} ${SPARK}?`)) return;
    try { const b = await econApi.sell(it.id, v, name(it.fromChar)); emitWallet(b, `+${v} ${SPARK} sold ${it.name}`); reload(); } catch (e) { onBanner(String(e)); }
  };
  return (
    <div className="inventory">
      <h4>Your things</h4>
      {mine.length === 0 && <div className="mem-empty">Nothing yet. Buy something in the Shops tab.</div>}
      <div className="inv-list">
        {mine.map((it) => (
          <div key={it.id} className="inv-item">
            <span className="si-emoji">{it.emoji}</span>
            <div><b>{it.name}{it.qty > 1 && <span className="qty"> {"\u00D7"}{it.qty}</span>}{isAdult(it) && <span className="tag18">18+</span>}</b><small>{it.description} {"\u00B7"} from {name(it.fromChar)} {"\u00B7"} paid {it.price} {SPARK}</small></div>
            <select value={to[it.id] ?? it.fromChar} onChange={(e) => setTo((t) => ({ ...t, [it.id]: e.target.value }))}>
              {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="primary" onClick={() => gift(it)}>{"\u{1F381}"} Gift</button>
            <button onClick={() => sell(it)}>Sell ({sellValue(it, chars.some((c) => c.id === it.fromChar))} {SPARK})</button>
          </div>))}
      </div>
      <h4>Gifts you've given</h4>
      {given.length === 0 && <div className="mem-empty">Gifts you give stay with that character, and they'll remember them.</div>}
      <div className="inv-list">
        {given.map((it) => <div key={it.id} className="inv-item"><span className="si-emoji">{it.emoji}</span><div><b>{it.name}</b><small>kept by {name(it.owner)}{it.giftedAt ? ` since ${new Date(it.giftedAt).toLocaleDateString()}` : ""}</small></div></div>)}
      </div>
    </div>
  );
}

function WalletTab() {
  const [tx, setTx] = useState<Tx[]>([]);
  const [streak, setStreak] = useState(0);
  useEffect(() => { econApi.history(80).then(setTx).catch(() => {}); econApi.kvGet<{ streak: number }>("econ_streak").then((s) => setStreak(s?.streak ?? 0)).catch(() => {}); }, []);
  return (
    <div className="wallet">
      <p className="muted">{"\u{1F525}"} Daily streak: {streak} day{streak === 1 ? "" : "s"}. Earn by visiting daily, chatting (up to 120 a day), closeness levels, milestones, the caf{"\u00E9"}, lucky finds and selling things.</p>
      <ul className="tx-list">
        {tx.map((t) => <li key={t.id}><span className={t.amount >= 0 ? "plus" : "minus"}>{t.amount >= 0 ? "+" : ""}{t.amount}</span> {t.reason} <small>{new Date(t.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></li>)}
      </ul>
    </div>
  );
}

function MallTab({ chars, balance, onBanner, onInventory }: { chars: Character[]; balance: number; onBanner: (x: string) => void; onInventory: () => void }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<DeptId | "all">("all");
  const [band, setBand] = useState<PriceBand>("any");
  const [tag, setTag] = useState("");
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [seasonal, setSeasonal] = useState<MallItem[]>([]);
  const [asking, setAsking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [fresh, setFresh] = useState<MallItem[]>([]);
  const [freshBusy, setFreshBusy] = useState(false);
  useEffect(() => { seasonalSpecials("", null).then(setSeasonal).catch(() => {}); }, []);
  useEffect(() => {
    let live = true; setFreshBusy(true);
    dailyNew(chars[0]?.model ?? "", api.ollamaJson).then((x) => live && setFresh(x)).catch(() => {}).finally(() => live && setFreshBusy(false));
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const deals = weeklyDeals(), dealSet = new Set(deals.map((d) => d.sku));
  const all = [...CATALOG, ...seasonal, ...fresh];
  const freshSet = new Set(fresh.map((f) => f.sku));
  const browsing = !q && dept === "all" && band === "any" && !tag;
  const results = browsing ? [] : search(all, q, dept, band, tag);
  const total = basketTotal(basket);
  const add = (it: MallItem) => setBasket((b) => addToBasket(b, it, priceOf(it, dealSet)));
  const askSeasonal = async () => {
    const model = chars[0]?.model; if (!model) return;
    setAsking(true);
    try { const s = await seasonalSpecials(model, api.ollamaJson); setSeasonal(s); if (!s.length) onBanner("No seasonal specials came back, try again later."); }
    catch (e) { onBanner(String(e)); } finally { setAsking(false); }
  };
  const pay = async () => {
    setPaying(true);
    try { const [, bal] = await checkout(basket); emitWallet(bal, `Bought ${basketCount(basket)} item${basketCount(basket) > 1 ? "s" : ""} at the Shopping Centre`); setBasket([]); }
    catch (e) { onBanner(String(e)); } finally { setPaying(false); }
  };
  const card = (it: MallItem) => { const p = priceOf(it, dealSet), inB = basket.find((l) => l.item.sku === it.sku)?.qty ?? 0; return (
    <div key={it.sku} className={`shop-card mall-card t${it.tier}`} title={`${it.description}\nTags: ${it.tags.join(", ")}`}>
      <span className="si-emoji">{it.emoji}</span><b>{it.name}</b>{dealSet.has(it.sku) && <span className="lvl deal">-{DEAL_OFF * 100}%</span>}{freshSet.has(it.sku) && <span className="lvl new">{"\u2728"} New</span>}
      {it.itemType && <span className="itype">{it.itemType}</span>}<small>{it.description}{it.wearable ? " \u00B7 wearable" : ""}</small>
      <div className="mall-tags">{it.tags.slice(0, 3).map((t) => <i key={t}>{t}</i>)}</div>
      <span className="price">{dealSet.has(it.sku) && <s>{it.price}</s>} {p} {SPARK}</span>
      <button className="add" onClick={() => add(it)}>{inB ? `In basket \u00D7${inB} \u002B` : "Add to basket"}</button>
    </div>); };
  return (
    <div className="mall">
      <div className="mall-bar">
        <input className="mall-search" value={q} placeholder={"\u{1F50D} Search the Shopping Centre\u2026"} onChange={(e) => setQ(e.target.value)} />
        <select value={band} onChange={(e) => setBand(e.target.value as PriceBand)}>{PRICE_BANDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">Any style</option>{TAGS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      </div>
      <nav className="cafe-cats">
        <button className={dept === "all" ? "sel" : ""} onClick={() => setDept("all")}>{"\u{1F3EC}"} All</button>
        {DEPARTMENTS.map((d) => <button key={d.id} className={dept === d.id ? "sel" : ""} onClick={() => setDept(d.id)}>{d.emoji} {d.label}</button>)}
      </nav>
      {basket.length > 0 && <div className="basket">
        <b>{"\u{1F6D2}"} Basket</b>
        {basket.map((l) => <div key={l.item.sku} className="basket-line">{l.item.emoji} {l.item.name}
          <span className="spacer" /><button onClick={() => setBasket((b) => setQty(b, l.item.sku, l.qty - 1))}>{"\u2212"}</button>
          <span className="qty">{l.qty}</span><button onClick={() => setBasket((b) => setQty(b, l.item.sku, l.qty + 1))}>+</button>
          <span className="bl-price">{l.unit * l.qty} {SPARK}</span></div>)}
        <div className="basket-line"><b>Total {total} {SPARK}</b><span className="spacer" /><button onClick={() => setBasket([])}>Empty</button>
          <button className="primary" disabled={paying || total > balance} onClick={pay}>{total > balance ? `Need ${total - balance} more ${SPARK}` : paying ? "Paying\u2026" : "Checkout"}</button></div>
      </div>}
      {browsing ? <>
        <h4>{"\u{1F195}"} New in today {freshBusy && <small>{"\u2013"} unpacking today's deliveries{"\u2026"}</small>}</h4><div className="shop-grid">{[...fresh, ...featured()].map(card)}</div>
        <h4>{"\u{1F3F7}\uFE0F"} This week's deals <small>{"\u2013"} {DEAL_OFF * 100}% off until Monday</small></h4><div className="shop-grid">{deals.map(card)}</div>
        <p className="muted">{all.length} items across {DEPARTMENTS.length} departments. Bought things go to your <a href="#" onClick={(e) => { e.preventDefault(); onInventory(); }}>Inventory</a>, ready to gift to anyone.</p>
      </> : <>
        {dept === "seasonal" && <p className="muted">{seasonal.length ? `${seasonal.length} seasonal specials this week. ` : ""}
          {!seasonal.length && <button onClick={askSeasonal} disabled={asking}>{asking ? "Stocking the aisle\u2026" : "\u2728 Ask for this week's seasonal specials"}</button>}</p>}
        <h4>{results.length} item{results.length === 1 ? "" : "s"}</h4>
        {results.length === 0 && <div className="mem-empty">Nothing matches. Try another word or department.</div>}
        <div className="shop-grid">{results.map(card)}</div>
      </>}
    </div>
  );
}

function AfterDarkTab({ chars, balance, onBanner, onInventory }: { chars: Character[]; balance: number; onBanner: (x: string) => void; onInventory: () => void }) {
  const [dept, setDept] = useState<string>("all");
  const [q, setQ] = useState("");
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [weekly, setWeekly] = useState<MallItem[]>([]);
  const [asking, setAsking] = useState(false);
  const [paying, setPaying] = useState(false);
  useEffect(() => { weeklyAdult("", null).then(setWeekly).catch(() => {}); }, []);
  const all = [...weekly, ...ADULT_CATALOG], weeklySet = new Set(weekly.map((w) => w.sku));
  const list = search(all, q, dept as DeptId | "all", "any");
  const total = basketTotal(basket);
  const ask = async () => {
    const model = chars[0]?.model; if (!model) return;
    setAsking(true);
    try { const w = await weeklyAdult(model, api.ollamaJson); setWeekly(w); if (!w.length) onBanner("No new After Dark items came back, try again later."); }
    catch (e) { onBanner(String(e)); } finally { setAsking(false); }
  };
  const pay = async () => {
    setPaying(true);
    try { const [, bal] = await checkout(basket, "afterdark"); emitWallet(bal, `Bought ${basketCount(basket)} item${basketCount(basket) > 1 ? "s" : ""} at After Dark`); setBasket([]); }
    catch (e) { onBanner(String(e)); } finally { setPaying(false); }
  };
  return (
    <div className="mall afterdark">
      <p className="muted">{"\u{1F319}"} A discreet 18+ boutique. Gifts from here only go to adult characters (age 18+ set in their editor), never to family, and they may say no. <a href="#" onClick={(e) => { e.preventDefault(); onInventory(); }}>Inventory</a></p>
      <div className="mall-bar"><input className="mall-search" value={q} placeholder={"\u{1F50D} Search After Dark\u2026"} onChange={(e) => setQ(e.target.value)} />
        {!weekly.length && <button onClick={ask} disabled={asking}>{asking ? "Restocking\u2026" : "\u2728 This week's new items"}</button>}</div>
      <nav className="cafe-cats">
        <button className={dept === "all" ? "sel" : ""} onClick={() => setDept("all")}>All</button>
        {ADULT_DEPTS.map((d) => <button key={d.id} className={dept === d.id ? "sel" : ""} onClick={() => setDept(d.id)}>{d.emoji} {d.label}</button>)}
      </nav>
      {basket.length > 0 && <div className="basket">
        <b>{"\u{1F6CD}\uFE0F"} Discreet bag</b>
        {basket.map((l) => <div key={l.item.sku} className="basket-line">{l.item.emoji} {l.item.name}
          <span className="spacer" /><button onClick={() => setBasket((b) => setQty(b, l.item.sku, l.qty - 1))}>{"\u2212"}</button>
          <span className="qty">{l.qty}</span><button onClick={() => setBasket((b) => setQty(b, l.item.sku, l.qty + 1))}>+</button>
          <span className="bl-price">{l.unit * l.qty} {SPARK}</span></div>)}
        <div className="basket-line"><b>Total {total} {SPARK}</b><span className="spacer" /><button onClick={() => setBasket([])}>Empty</button>
          <button className="primary" disabled={paying || total > balance} onClick={pay}>{total > balance ? `Need ${total - balance} more ${SPARK}` : paying ? "Paying\u2026" : "Checkout"}</button></div>
      </div>}
      <div className="shop-grid">
        {list.map((it) => { const inB = basket.find((l) => l.item.sku === it.sku)?.qty ?? 0; return (
          <div key={it.sku} className={`shop-card mall-card t${it.tier}`} title={it.description}>
            <span className="si-emoji">{it.emoji}</span><b>{it.name}</b>{weeklySet.has(it.sku) ? <span className="lvl new">{"\u2728"} New</span> : <span className="lvl tag18">18+</span>}
            {it.itemType && <span className="itype">{it.itemType}</span>}<small>{it.description}{it.wearable ? " \u00B7 wearable" : ""}</small>
            <span className="price">{it.price} {SPARK}</span>
            <button className="add" onClick={() => setBasket((b) => addToBasket(b, it, it.price))}>{inB ? `In bag \u00D7${inB} +` : "Add to bag"}</button>
          </div>); })}
      </div>
    </div>
  );
}
