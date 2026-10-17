import { useEffect, useMemo, useRef } from 'react';
import { archipelagoView, choiceView, financeView, type ArchIslandView, type WorldState } from '@arch/engine';
import { HUMAN, useGame } from '../../store';
import { displayPlayer, errorText, getI18n, useI18n, weeksAcc } from '../../i18n';
import { ARCH_ICONS, type ArchOwnerTone, type ArchSceneProps } from '../../scene/contract';
import { percent } from '../text';

export function ownerTone(island: ArchIslandView): ArchOwnerTone {
  return island.own ? 'mine' : island.owner === 'mainland' ? 'mainland' : island.owner ? 'neighbor' : 'free';
}

export function playerName(world: WorldState, id: string) {
  const player = world.players.find((p) => p.id === id);
  return player ? displayPlayer(player).name : id;
}

export function useArchScene(): ArchSceneProps | null {
  const world = useGame((s) => s.world);
  const on = useGame((s) => s.archMode);
  const focus = useGame((s) => s.archFocus);
  const onIslandClick = useGame((s) => s.setArchFocus);
  const { t } = useI18n();
  return useMemo(() => {
    const view = world && archipelagoView(world, HUMAN);
    return view ? {
    on, focus, onIslandClick,
    islands: view.islands.map((i) => ({
      island: i.island, business: i.business, route: i.route === null,
      built: i.owner !== null, tone: ownerTone(i), damaged: i.damaged, attention: i.attention,
      label: `${ARCH_ICONS[i.business]} ${t.arch.islands[i.island]} · ${t.arch.status[i.damaged ? 'damaged' : i.status]}`,
    })),
    } : null;
  }, [world, on, focus, onIslandClick, t]);
}

/** Схема остаётся доступной и при отказе 3D-сцены. */
function ArchMap({ islands }: { islands: ArchIslandView[] }) {
  const { t } = useI18n();
  const focus = useGame((s) => s.archFocus);
  const setFocus = useGame((s) => s.setArchFocus);
  const points = [[52, 34], [106, 20], [195, 20], [248, 34], [235, 86]];
  return <svg className="arch-map" viewBox="0 0 300 120" role="group" aria-label={t.arch.toggle.arch}>
    {islands.map((i, n) => i.route === null && <line key={i.island} x1="145" y1="85" x2={points[n][0]} y2={points[n][1]} />)}
    <circle cx="145" cy="85" r="16" className="arch-map-home" /><text x="145" y="90" textAnchor="middle">🏝</text>
    {islands.map((i, n) => {
      const [x, y] = points[n];
      const select = () => setFocus(i.island);
      return <g key={i.island} role="button" tabIndex={0} aria-pressed={focus === i.island}
        aria-label={`${t.arch.islands[i.island]} · ${t.arch.status[i.damaged ? 'damaged' : i.status]}`}
        onClick={select} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } }}>
        <title>{t.arch.islands[i.island]} · {t.arch.businesses[i.business].title} · {t.arch.status[i.status]}</title>
        <circle cx={x} cy={y} r="15" className={`arch-map-node arch-tone-${ownerTone(i)} ${focus === i.island ? 'selected' : ''}`} />
        <text x={x} y={y + 5} textAnchor="middle">{ARCH_ICONS[i.business]}</text>
        <text className="arch-map-name" x={x} y={y + 27} textAnchor="middle">{t.arch.islands[i.island]}</text>
        {i.damaged && <circle cx={x + 12} cy={y - 11} r="4" className="arch-damage" />}
      </g>;
    })}
  </svg>;
}

function Cells({ values, muted }: { values: [string, string][]; muted?: boolean }) {
  return <div className={`arch-cells ${muted ? 'muted' : ''}`}>{values.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>;
}

function IslandCard({ island: i, expanded, onExpand }: { island: ArchIslandView; expanded: boolean; onExpand: () => void }) {
  const { t, fmt, signed, plural } = useI18n();
  const world = useGame((s) => s.world)!;
  const act = useGame((s) => s.act);
  const openChoice = useGame((s) => s.openChoice);
  const busy = useGame((s) => s.busy);
  const ref = useRef<HTMLElement>(null);
  const copy = t.arch.card, business = t.arch.businesses[i.business], cells = copy.cells;
  const own = i.own, buy = i.buy, route = i.route;
  const pending = choiceView(world, HUMAN);
  useEffect(() => { if (expanded) ref.current?.scrollIntoView({ block: 'nearest' }); }, [expanded]);
  const limit = buy?.reason?.code === 'businessLimit';
  const buyLabel = buy ? limit ? copy.limit(archipelagoView(world, HUMAN)!.businesses.max)
    : !buy.canBuy && buy.reason ? errorText(buy.reason)
    : buy.loanNeeded ? copy.buildLoan(fmt(buy.price - buy.loanNeeded), fmt(buy.loanNeeded)) : copy.build(fmt(buy.price)) : '';
  return <article ref={ref} className={`arch-card arch-tone-${ownerTone(i)} ${expanded ? 'expanded' : ''}`}>
    <button className="arch-card-summary" aria-expanded={expanded} aria-controls={`arch-card-${i.island}`} onClick={onExpand}>
      <span aria-hidden>{ARCH_ICONS[i.business]}</span><span><b>{t.arch.islands[i.island]}</b><small>{business.title} · {t.arch.status[i.damaged ? 'damaged' : i.status]}</small></span>
      {i.attention && <span className="arch-dot" aria-label={t.arch.toggle.attention} />}<span aria-hidden>{expanded ? '−' : '+'}</span>
    </button>
    <div id={`arch-card-${i.island}`} className="arch-card-body">
      <p className="hint-text">{i.resident ? copy.resident(playerName(world, i.resident)) : copy.uninhabited}</p>
      <div className="arch-badges"><span>{own ? copy.yours : business.badge}</span>{i.sets.map((id) => <span key={id} title={t.arch.sets[id].text}>{t.arch.sets.badge(t.arch.sets[id].title)}</span>)}</div>
      {own?.partnerId ? <h3>{copy.partnerWith(playerName(world, own.partnerId))}</h3>
        : i.owner && !own ? <h3>{copy.ownedBy(business.title, i.owner === 'mainland' ? copy.mainlandGenitive : displayOwner(world, i.owner))}</h3> : <h3>{business.title}</h3>}
      {!own && !i.owner && <p>{business.text}</p>}
      {own ? <>
        <Cells values={[[cells.income, t.arch.head.perWeek(signed(own.income))], [cells.upkeep, t.arch.head.perWeek(fmt(own.upkeep))], [cells.value, fmt(own.value)]]} />
        {own.managers.length > 0 && <fieldset className="arch-managers"><legend>{copy.manager}</legend>{own.managers.map((m) => {
          const manager = m.manager;
          const label = manager === 'owner' ? copy.managerOwner(`1 ${plural(1, t.units.day)}`) : manager === 'hired' ? copy.managerHired(percent(m.feeShare))
            : typeof manager === 'object' ? copy.managerNeighbor(playerName(world, manager.neighborId), percent(m.feeShare)) : '';
          return <div key={typeof manager === 'object' ? manager.neighborId : manager}>
            <button className="btn ghost sm" aria-pressed={m.current} disabled={busy || !m.available || m.current}
              onClick={() => act({ type: 'setManager', playerId: HUMAN, business: i.business, manager })}>{label}</button>
            {!m.available && m.reason && <small>{errorText(m.reason)}</small>}
          </div>;
        })}</fieldset>}
        {i.damaged && (own.insured ? <p className="hint-text">{copy.insuredRepair}</p> : <button className="btn primary" disabled={busy}
          onClick={() => act({ type: 'repairBusiness', playerId: HUMAN, business: i.business })}>{copy.repair(fmt(own.repairCost))}</button>)}
      </> : buy && !route ? <>
        <Cells muted={limit} values={[[cells.price, fmt(buy.price)], [cells.income, t.arch.head.perWeek(signed(buy.income))], [cells.payback, buy.paybackWeeks === null ? copy.never : weeksAcc(buy.paybackWeeks)]]} />
        <div className="freedom-line">{copy.freedom(percent(financeView(world, HUMAN).freedomRatio), percent(buy.freedomAfter))}</div>
        <button className="btn primary" disabled={busy || !buy.canBuy} onClick={() => act({ type: 'buyBusiness', playerId: HUMAN, business: i.business, loan: buy.loanNeeded ?? 0 })}>{buyLabel}</button>
        {limit && <p className="hint-text">{copy.limitHint}</p>}
      </> : null}
      {(own || !i.owner) && <p className="arch-effect">{business.effect}</p>}
      {i.effectOnYou && <p className="pos">{business.onYou}</p>}
      {route && <>
        {!i.owner && <p>{copy.canBuild(business.accusative)}</p>}
        <p className="hint-text">{copy.tickets(fmt(route.ticketsNet))}</p>
        <button className="btn primary" disabled={busy || !route.canBuild} onClick={() => act({ type: 'buildRoute', playerId: HUMAN, island: i.island })}>{copy.buildRoute(fmt(route.cost))}</button>
        {!route.canBuild && route.reason && <p className="hint-text">{errorText(route.reason)}</p>}
      </>}
      {i.partnerOfferUntil !== null && pending?.kind === 'partner' && pending.business === i.business && <div className="arch-offer">
        <p>{copy.partnerOffer(playerName(world, pending.botId), i.partnerOfferUntil)}</p><button className="btn ghost" onClick={openChoice}>{copy.partnerOpen}</button>
      </div>}
    </div>
  </article>;
}

function displayOwner(world: WorldState, id: string) {
  const player = world.players.find((p) => p.id === id);
  const { t } = getI18n();
  return t.bots[id as keyof typeof t.bots]?.genitive ?? (player ? displayPlayer(player).name : id);
}

export function ArchPanel() {
  const { t, fmt, signed } = useI18n();
  const world = useGame((s) => s.world)!;
  const focus = useGame((s) => s.archFocus);
  const setFocus = useGame((s) => s.setArchFocus);
  const act = useGame((s) => s.act);
  const busy = useGame((s) => s.busy);
  const openChoice = useGame((s) => s.openChoice);
  const view = archipelagoView(world, HUMAN);
  if (!view) return null;
  const first = view.islands.find((i) => i.attention) ?? view.islands[0];
  const selected = focus ?? first?.island;
  const choice = choiceView(world, HUMAN);
  return <div className="tab-body arch-panel">
    <header className="arch-head"><span>{t.arch.head.businesses} <b>{t.arch.head.of(view.businesses.have, view.businesses.max)}</b></span><span>{t.arch.head.days} <b>{t.arch.head.of(view.days.used, view.days.total)}</b></span><span>{t.arch.head.income} <b>{t.arch.head.perWeek(signed(view.weeklyNet))}</b></span></header>
    <div className="arch-sets">{view.sets.map((s) => <div key={s.id} className={s.active ? 'active' : ''} title={t.arch.sets[s.id].text}>
      {t.arch.sets.progress(t.arch.sets[s.id].title, s.have, s.total)}{s.active && <b>{t.arch.sets.active}</b>}
    </div>)}</div>
    <ArchMap islands={view.islands} />
    {view.islands.every((i) => i.route !== null) && <p className="arch-first-route">{t.arch.firstRouteHint}</p>}
    {choice && ['partner', 'bankLoan', 'bizBuyer'].includes(choice.kind) && <button className="btn ghost" onClick={openChoice}>{t.ui.choices.pending} · {t.arch.card.partnerOpen}</button>}
    {view.islands.map((i) => <IslandCard key={i.island} island={i} expanded={i.island === selected} onExpand={() => setFocus(i.island)} />)}
    <section className="arch-insurance"><label><input type="checkbox" role="switch" checked={view.insurance.on} disabled={busy}
      onChange={(e) => act({ type: 'setArchInsurance', playerId: HUMAN, on: e.target.checked })} /><b>{t.arch.insurance.title}</b><span>{t.arch.insurance.premium(fmt(view.insurance.premium))}</span></label>
      {view.insurance.on && view.insurance.activeFrom !== null && <p className="hint-text">{world.week < view.insurance.activeFrom ? t.arch.insurance.waiting(view.insurance.activeFrom) : t.arch.insurance.active}</p>}
    </section>
  </div>;
}
