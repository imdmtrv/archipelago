import { financeView, getPlayer, offerViews, rumorViews, type OfferView } from '@arch/engine';
import { HUMAN, useGame } from '../store';
import { assetCopy, marketLine, rumorWhen, scamWarning, sectorName, useI18n } from '../i18n';
import { FreedomLine } from './common';

function OfferCard({ v, cash, freedom }: { v: OfferView; cash: number; freedom: number }) {
  const { t, fmt, signed } = useI18n();
  const act = useGame((s) => s.act);
  const setTab = useGame((s) => s.setTab);
  const copy = assetCopy(v.def.id);
  // Афера выглядит как обычный актив — правду выдаёт только предупреждение от знаний
  const isStatus = v.def.kind === 'status';
  const reason = v.locked
    ? t.ui.deals.noKnowledge(v.def.minKnowledge)
    : v.slotFull
      ? t.ui.deals.noSpace
      : !v.canAfford
        ? t.ui.deals.missing(fmt(v.offer.price - cash))
        : null;

  return (
    <article className={`offer ${v.warning ? 'warned' : ''}`} data-offer={v.def.id} data-offer-uid={v.offer.uid}>
      <div className="offer-top">
        <span className={`tag ${isStatus ? 'liability' : 'asset'}`}>
          {isStatus ? t.ui.deals.liability : `${t.ui.deals.asset} · ${sectorName(v.def.sector)}`}
        </span>
        <span className={`expires ${v.weeksLeft === 0 ? 'last' : ''}`}>
          {v.weeksLeft === 0 ? t.ui.deals.lastWeek : t.ui.deals.moreWeeks(v.weeksLeft)}
        </span>
      </div>
      <h3>{copy.title}</h3>
      <p>{copy.description}</p>
      <div className="nums">
        <div className="num"><span>{t.ui.deals.price}</span><b>{fmt(v.offer.price)}</b></div>
        <div className="num"><span>{t.ui.income}</span><b className={v.expectedIncome ? 'pos' : ''}>{v.expectedIncome ? `+${fmt(v.expectedIncome)}` : '0'}<small>{t.ui.perWeek}</small></b></div>
        <div className="num"><span>{t.ui.deals.upkeep}</span>{v.upkeep > 0 ? <b className="neg">−{fmt(v.upkeep)}<small>{t.ui.perWeek}</small></b> : <b>0</b>}</div>
      </div>
      <div className={`net ${v.net > 0 ? 'pos' : 'neg'}`}>
        {v.net > 0 && v.paybackWeeks
          ? <>{t.ui.deals.total} {signed(v.net)}{t.ui.perWeek} · {t.ui.deals.pays(v.paybackWeeks)}</>
          : <>{t.ui.deals.total} {signed(v.net)}{t.ui.perWeek} — {t.ui.deals.onlyExpenses}{v.def.joy > 0 ? `, ${t.ui.deals.joy(v.def.joy)}` : ''}</>}
      </div>
      <FreedomLine before={freedom} after={v.freedomAfter} />
      {v.warning && <div className="warning"><span aria-hidden>⚠</span> {scamWarning(v.def.id)}</div>}
      <button
        className="btn primary"
        disabled={!!reason}
        onClick={() => act({ type: 'buyOffer', playerId: HUMAN, offerUid: v.offer.uid }, t.ui.deals.bought(copy.title))}
      >
        {reason ?? t.ui.deals.buy(fmt(v.offer.price))}
      </button>
      {v.slotFull && !isStatus && (
        <button className="link-btn" onClick={() => setTab('island')}>
          {t.ui.deals.improveInstead}
        </button>
      )}
    </article>
  );
}

export function DealsTab() {
  const { t } = useI18n();
  const world = useGame((s) => s.world)!;
  const me = getPlayer(world, HUMAN);
  const views = offerViews(world, HUMAN);
  const freedom = financeView(world, HUMAN).freedomRatio;
  const fish = marketLine(world.market.fish, 'fish');
  const tourism = marketLine(world.market.tourism, 'tourism');
  const rumors = rumorViews(world, HUMAN);

  return (
    <div className="tab-body">
      <div className="market">
        <span className={`chip ${fish.tone}`}>{fish.text}</span>
        <span className={`chip ${tourism.tone}`}>{tourism.text}</span>
        {rumors.map((rumor, i) => (
          <span key={`${rumor.kind}-${rumor.fromWeek}-${i}`} className={`chip rumor-chip ${rumor.kind === 'storm' || rumor.kind === 'crisis' ? 'neg' : 'pos'}`} title={rumor.exactWeek !== null ? t.ui.rumors.exactHint : undefined}>
            {t.ui.rumors.chip(t.ui.rumors.kinds[rumor.kind], rumorWhen(rumor, world.week))}
          </span>
        ))}
      </div>
      {views.length === 0
        ? <div className="empty">{t.ui.deals.empty}</div>
        : views.map((v) => <OfferCard key={v.offer.uid} v={v} cash={me.cash} freedom={freedom} />)}
      <div className="hint-text">{t.ui.deals.hint}</div>
    </div>
  );
}
