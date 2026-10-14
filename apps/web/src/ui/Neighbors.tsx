// Соседи на экране: полоска с аватарами поверх острова и карточка соседа по нажатию.
// Карточка — урок сравнения: те же правила, разные привычки, разный результат.
import { useEffect, useRef, useState } from 'react';
import {
  assetViews, financeView, getPlayer, leaderboard,
  type AssetView, type PlayerState, type WorldState,
} from '@arch/engine';
import { HUMAN, useGame, type FreedomHistory } from '../store';
import { fmt } from '../format';
import { assetCopy, displayPlayer, getI18n, newsText, useI18n } from '../i18n';
import { levelTitle, lowerFirst, percent } from './text';
import { Meter } from './common';

/** Цвет аватара по порядку игроков в мире: вы, Мия, Тимур, Борис. */
const AVATAR = ['#3E9A9A', '#E8735A', '#F0A93B', '#7B6CC4'];

const colorOf = (world: WorldState, playerId: string) =>
  AVATAR[Math.max(0, world.players.findIndex((p) => p.id === playerId)) % AVATAR.length];

const renderedNews = (item: ReturnType<typeof useGame.getState>['news'][number], players: readonly PlayerState[]) =>
  'text' in item ? item.text : newsText(item, players);

// ───────── Аватар с кольцом прогресса к свободе ─────────

function RingAvatar({ letter, color, ratio, size = 40, free }: { letter: string; color: string; ratio: number; size?: number; free: boolean }) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const k = Math.max(0, Math.min(1, ratio));
  return (
    <span className={`ring-avatar ${free ? 'free' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(31,42,68,.12)" strokeWidth="3.5" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F5B83D" strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={`${c * k} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-face" style={{ background: color, inset: 5, fontSize: size * 0.36 }}>{letter}</span>
    </span>
  );
}

// ───────── Вывод о стратегии соседа ─────────

interface Insight { text: string; tone: 'good' | 'bad' | 'neutral' }

function insightFor(world: WorldState, p: PlayerState, views: AssetView[]): Insight {
  const { t } = getI18n();
  const shown = displayPlayer(p);
  const bot = t.bots[p.id as keyof typeof t.bots];
  const fin = financeView(world, p.id);
  const me = getPlayer(world, HUMAN);
  const total = fin.expenses.total;
  const status = views.filter((v) => v.def.kind === 'status');
  const statusUpkeep = status.reduce((s, v) => s + v.upkeep, 0);
  const emergency = p.loans.some((l) => l.emergency);
  // Афера выдаёт себя только тем, кто учился, — как на доске сделок
  const scam = me.knowledge >= 1 && views.some((v) => v.def.kind === 'scam');

  if (emergency) {
    return { tone: 'bad', text: t.ui.neighbors.insightEmergency(shown.name, fmt(fin.expenses.interest), p.id === 'bot-mia') };
  }
  if (scam) {
    return { tone: 'bad', text: t.ui.neighbors.insightScam(bot?.genitive ?? shown.name) };
  }
  if (status.length > 0 && total > 0 && statusUpkeep / total >= 0.12) {
    const names = status.map((v) => lowerFirst(assetCopy(v.def.id, v.level).title)).join(', ');
    return { tone: 'bad', text: t.ui.neighbors.insightStatus(names, fmt(statusUpkeep), percent(statusUpkeep / total)) };
  }
  if (fin.debt > 0 && fin.expenses.interest > 0) {
    return { tone: 'neutral', text: t.ui.neighbors.insightDebt(fmt(fin.debt), fmt(fin.expenses.interest)) };
  }
  if (fin.freedomRatio >= 1) {
    return {
      tone: 'good',
      text: t.ui.neighbors.insightFree(fmt(fin.passiveIncome), fmt(total), p.employed),
    };
  }
  const salary = p.employed ? p.salary : 0;
  const share = salary + fin.passiveIncome > 0 ? fin.passiveIncome / (salary + fin.passiveIncome) : 0;
  if (share >= 0.3) {
    return { tone: 'good', text: t.ui.neighbors.insightShare(percent(share)) };
  }
  if (p.happiness < 25) {
    return { tone: 'bad', text: t.ui.neighbors.insightTired };
  }
  const assets = views.filter((v) => v.def.kind !== 'status').length;
  return {
    tone: 'neutral',
    text: assets === 0 ? t.ui.neighbors.insightNoAssets : t.ui.neighbors.insightAssets(assets),
  };
}

// ───────── График пути к свободе ─────────

function Sparkline({ history, id, color }: { history: FreedomHistory; id: string; color: string }) {
  const { t } = useI18n();
  const line = history[id] ?? [];
  const mine = history[HUMAN] ?? [];
  if (line.length < 2) return <div className="muted-text">{t.ui.neighbors.graphSoon}</div>;

  const W = 320, H = 70, pad = 4;
  const weeks = [...line, ...mine].map((p) => p.week);
  const w0 = Math.min(...weeks), w1 = Math.max(...weeks);
  const top = Math.max(1.25, ...line.map((p) => p.ratio), ...mine.map((p) => p.ratio)) * 1.05;
  const x = (w: number) => pad + ((w - w0) / Math.max(1, w1 - w0)) * (W - pad * 2);
  const y = (r: number) => H - pad - (r / top) * (H - pad * 2);
  const path = (pts: { week: number; ratio: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.week).toFixed(1)},${y(p.ratio).toFixed(1)}`).join(' ');

  return (
    <div className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={t.ui.neighbors.graphLabel}>
        <line x1={pad} x2={W - pad} y1={y(1)} y2={y(1)} className="spark-goal" />
        {mine.length > 1 && <path d={path(mine)} className="spark-me" />}
        <path d={path(line)} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="spark-legend">
        <span><i style={{ background: color }} /> {t.ui.neighbors.neighbor}</span>
        <span><i className="me" /> {t.ui.neighbors.you}</span>
        <span className="muted">{t.ui.neighbors.dashed}</span>
      </div>
    </div>
  );
}

// ───────── Карточка соседа ─────────

export function NeighborCard({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const { t } = useI18n();
  const world = useGame((s) => s.world)!;
  const history = useGame((s) => s.history);
  const news = useGame((s) => s.news);
  const p = getPlayer(world, playerId);
  const shown = displayPlayer(p);
  const bot = t.bots[p.id as keyof typeof t.bots];
  const fin = financeView(world, playerId);
  const mine = financeView(world, HUMAN);
  const views = assetViews(world, playerId);
  const color = colorOf(world, playerId);
  const insight = insightFor(world, p, views);
  const free = p.freedomWeek !== null;
  const card = useRef<HTMLDivElement>(null);

  // Закрывается по Esc и по нажатию в любом месте вне карточки (кроме аватаров соседей — они переключают карточку сами)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || card.current?.contains(target) || target.closest('.nb-chip')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  // Что стоит на острове: одинаковые объекты — одной плашкой «Баркас ×2»
  const groups = new Map<string, { title: string; count: number; status: boolean }>();
  for (const v of views) {
    const title = assetCopy(v.def.id, v.level).title;
    const key = `${v.def.kind === 'status'}|${title}`;
    const g = groups.get(key) ?? { title, count: 0, status: v.def.kind === 'status' };
    g.count++;
    groups.set(key, g);
  }
  const items = [...groups.values()].sort((a, b) => Number(a.status) - Number(b.status));

  const status = free
    ? `${t.ui.neighbors.freedomSince(p.freedomWeek!)} · ${p.employed ? t.ui.neighbors.works : t.ui.neighbors.noWork}`
    : `${p.employed ? t.ui.neighbors.working : t.ui.neighbors.withoutWork} · ${t.ui.neighbors.toFreedom(percent(fin.freedomRatio))}`;
  const myNews = news.filter((n) => n.playerId === playerId).slice(0, 4);

  return (
    <div ref={card} className="neighbor-card panel" role="dialog" aria-label={`${t.ui.neighbors.neighbor.charAt(0).toUpperCase()}${t.ui.neighbors.neighbor.slice(1)}: ${shown.name}`}>
      <button className="icon-btn close" onClick={onClose} aria-label={t.ui.neighbors.close}>×</button>
      <div className="nc-head">
        <RingAvatar letter={shown.name.slice(0, 1)} color={color} ratio={fin.freedomRatio} size={52} free={free} />
        <div>
          <div className="nc-name">{shown.name} <span className="muted">· {t.ui.neighbors.island} {shown.islandName}</span></div>
          <div className="nc-sub">{bot?.style ?? ''}{p.botStyle ? ' · ' : ''}{status}</div>
        </div>
      </div>

      <div className="freedom compact">
        <div className="freedom-head">
          <span>{fin.level >= 1 ? levelTitle(fin.level) : t.ui.neighbors.toFreedomLabel}</span>
          <b>{percent(fin.freedomRatio)}%</b>
        </div>
        <div className="bar"><div className="fill" style={{ width: `${Math.min(100, percent(fin.freedomRatio))}%` }} /></div>
      </div>

      <div className={`insight ${insight.tone}`}>{insight.text}</div>

      <div className="nc-grid">
        <div><span>{t.ui.neighbors.assetIncome}</span><b className="pos">+{fmt(fin.passiveIncome)}<small>{t.ui.perWeek}</small></b><em>{t.ui.neighbors.yours(fmt(mine.passiveIncome))}</em></div>
        <div><span>{t.ui.neighbors.expenses}</span><b className="neg">−{fmt(fin.expenses.total)}<small>{t.ui.perWeek}</small></b><em>{t.ui.neighbors.yoursNeg(fmt(mine.expenses.total))}</em></div>
        <div><span>{t.ui.neighbors.cash}</span><b>{fmt(p.cash)}</b></div>
        <div><span>{t.ui.neighbors.debt}</span><b className={fin.debt > 0 ? 'neg' : ''}>{fin.debt > 0 ? `−${fmt(fin.debt)}` : '0'}</b></div>
        <div><span>{t.ui.neighbors.netWorth}</span><b>{fmt(fin.netWorth)}</b><em>{t.ui.neighbors.yoursPlain(fmt(mine.netWorth))}</em></div>
        <div><span>{t.ui.neighbors.happiness}</span><b>{Math.round(p.happiness)}</b><Meter value={p.happiness} /></div>
      </div>

      <div className="list-title">{t.ui.neighbors.onIsland}</div>
      {items.length === 0
        ? <div className="muted-text">{t.ui.neighbors.onlyHome}</div>
        : (
          <div className="nc-items">
            {items.map((g) => (
              <span key={`${g.status}|${g.title}`} className={`nc-item ${g.status ? 'liability' : 'asset'}`}>
                {g.title}{g.count > 1 ? ` ×${g.count}` : ''}
              </span>
            ))}
          </div>
        )}

      <div className="list-title">{t.ui.neighbors.path}</div>
      <Sparkline history={history} id={playerId} color={color} />

      {myNews.length > 0 && (
        <>
          <div className="list-title">{t.ui.neighbors.recent}</div>
          {myNews.map((n, i) => (
            <div key={i} className="news"><span className="muted">{t.ui.weekShort} {n.week}</span> {renderedNews(n, world.players)}</div>
          ))}
        </>
      )}
    </div>
  );
}

// ───────── Лента новостей недели ─────────

function NewsTicker() {
  const world = useGame((s) => s.world)!;
  const news = useGame((s) => s.news);
  const week = world.lastReport?.week;
  const fresh = week === undefined ? [] : news.filter((n) => n.week === week);
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (fresh.length < 2) return;
    const t = window.setInterval(() => setI((k) => k + 1), 3800);
    return () => window.clearInterval(t);
  }, [week, fresh.length]);
  if (fresh.length === 0) return null;
  const item = fresh[i % fresh.length];
  return <div key={`${week}-${i}`} className="ticker">{renderedNews(item, world.players)}</div>;
}

// ───────── Полоска соседей ─────────

export type NeighborsSize = 'full' | 'medium' | 'compact' | 'badge';

/** Компьютер: три размера в верхней строке; телефон (`compact`) — аватары в плашке. */
export function NeighborsBar({ compact, size = 'full' }: { compact?: boolean; size?: NeighborsSize }) {
  const { t } = useI18n();
  const world = useGame((s) => s.world)!;
  const selected = useGame((s) => s.neighborId);
  const show = useGame((s) => s.showNeighbor);
  const rows = leaderboard(world);

  const chips = (mode: NeighborsSize, interactive = true) => rows.map((r, place) => {
    const me = !r.isBot;
    const shown = displayPlayer({ id: r.playerId, name: r.name, islandName: r.islandName, isBot: r.isBot });
    const color = colorOf(world, r.playerId);
    const free = r.freedomWeek !== null;
    const label = `${shown.name}${me ? t.ui.neighbors.meSuffix : ''}: ${t.ui.neighbors.toFreedom(percent(r.freedomRatio))}`;
    const contents = <>
      <RingAvatar letter={me ? t.ui.neighbors.you.slice(0, 1).toUpperCase() : shown.name.slice(0, 1)} color={color} ratio={r.freedomRatio} size={mode === 'full' ? 38 : 32} free={free} />
      {(mode === 'full' || mode === 'medium') && (
        <span className="nb-text">
          <b>{me ? t.ui.neighbors.youLabel : shown.name}</b>
          <small>{mode === 'medium' ? `${percent(r.freedomRatio)}%` : `${free ? t.ui.neighbors.freedom : `${percent(r.freedomRatio)}%`} · ${t.ui.neighbors.place(place + 1)}`}</small>
        </span>
      )}
    </>;
    if (!interactive) return <span key={r.playerId} className="nb-chip">{contents}</span>;
    return (
      <button
        key={r.playerId}
        className={`nb-chip ${me ? 'me' : ''} ${selected === r.playerId ? 'active' : ''}`}
        onClick={() => { if (!me) show(r.playerId); }}
        disabled={me && compact}
        title={label}
        aria-label={label}
      >
        {contents}
      </button>
    );
  });

  if (compact) return <div className="nb-mini">{chips('compact')}</div>;
  const race = t.ui.neighbors.race.split('\n');
  const label = <span className="nb-label">{race[0]}<br />{race[1]}</span>;
  return (
    <div className="neighbors" data-size={size}>
      <div className={`nb-bar panel nb-${size}`}>
        {size === 'full' && label}
        {chips(size)}
      </div>
      <div className="nb-measure" aria-hidden="true">
        {(['full', 'medium', 'compact'] as const).map((mode) => (
          <div key={mode} className={`nb-probe panel nb-${mode}`} data-neighbors-probe={mode}>
            {mode === 'full' && label}{chips(mode, false)}
          </div>
        ))}
      </div>
      <div className="neighbor-dropdown">
        <NewsTicker />
        {selected && <NeighborCard playerId={selected} onClose={() => show(null)} />}
      </div>
    </div>
  );
}

/** Телефон: карточка соседа — окном поверх всего. */
export function NeighborModal() {
  const selected = useGame((s) => s.neighborId);
  const show = useGame((s) => s.showNeighbor);
  if (!selected) return null;
  return (
    <div className="modal-backdrop neighbor-modal" onClick={() => show(null)}>
      <div onClick={(e) => e.stopPropagation()}>
        <NeighborCard playerId={selected} onClose={() => show(null)} />
      </div>
    </div>
  );
}
