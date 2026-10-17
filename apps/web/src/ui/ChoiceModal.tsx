import { useEffect, useRef, type ReactNode } from 'react';
import { choiceView, type ChoiceView } from '@arch/engine';
import { HUMAN, useGame } from '../store';
import { assetCopy, coins, displayPlayer, errorText, rumorWhen, useI18n, weeks, weeksAcc } from '../i18n';
import { percent } from './text';
import { playerName } from './arch/ArchPanel';

/** Решение живёт в движке; закрытие окна оставляет его на следующую попытку хода. */
export function ChoiceModal() {
  const { t } = useI18n();
  const world = useGame((s) => s.world);
  const open = useGame((s) => s.choiceOpen);
  const weekModal = useGame((s) => s.modal);
  const archNotice = useGame((s) => s.archNotice);
  const close = useGame((s) => s.closeChoice);
  const act = useGame((s) => s.act);
  const showNeighbor = useGame((s) => s.showNeighbor);
  const ref = useRef<HTMLDivElement>(null);
  const view = world && open && !weekModal && !archNotice ? choiceView(world, HUMAN) : null;
  const uid = view?.uid;

  useEffect(() => {
    if (!uid) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key !== 'Tab') return;
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, [uid, close]);

  if (!world || !view) return null;
  const copy = t.ui.choices;
  let title: string, text: string, hint: string, accept: string, decline: string, success: string;
  let details: ReactNode;
  let later: ReactNode;
  if (view.kind === 'partner') {
    const partner = t.arch.choices.partner;
    const name = playerName(world, view.botId);
    const business = t.arch.businesses[view.business];
    title = partner.title(name);
    text = partner.text(name, view.botId === 'bot-mia', business.accusative);
    hint = partner.slot(view.slot.used + 1, view.slot.max);
    accept = partner.accept(coins(view.half));
    decline = partner.decline(view.botId === 'bot-mia');
    success = accept;
    details = <div className="choice-money"><span>{partner.half}</span><b>{coins(view.half)}</b></div>;
    const remaining = view.expiresWeek - world.week;
    if (remaining > 0) later = <button className="btn ghost" onClick={() => {
      if (act({ type: 'deferChoice', playerId: HUMAN })) close();
    }}>{partner.later(weeks(remaining))}</button>;
  } else if (view.kind === 'bankLoan') {
    const loan = t.arch.choices.bankLoan;
    title = view.borrower === 'npc' ? loan.titleNpc(coins(view.amount)) : loan.titleNeighbor(playerName(world, view.borrower), coins(view.amount));
    text = loan.terms(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(view.weeklyRate * 100), weeksAcc(view.term), coins(view.weeklyInterest));
    hint = loan.risk[view.cls];
    accept = loan.accept(coins(view.amount));
    decline = loan.decline;
    success = accept;
    details = <><div className={`arch-risk ${view.cls}`}>{loan.cls[view.cls]}</div>
      {view.crisisRumor && <p className="warning">{loan.rumor(rumorWhen(view.crisisRumor, world.week))}</p>}</>;
  } else if (view.kind === 'bizBuyer') {
    const buyer = t.arch.choices.bizBuyer, business = t.arch.businesses[view.business];
    title = buyer.title(business.accusative);
    text = view.weeksOfIncome === null ? buyer.textNoIncome(coins(view.offer), business.title)
      : buyer.text(coins(view.offer), business.title, coins(view.weeklyIncome), weeksAcc(view.weeksOfIncome));
    hint = t.arch.card.limitHint;
    accept = buyer.accept(coins(view.offer));
    decline = buyer.decline;
    success = accept;
    details = <div className="freedom-line">{t.arch.card.freedom(percent(view.freedomBefore), percent(view.freedomAfter))}</div>;
  } else if (view.kind === 'neighborLoan') {
    const neighbor = world.players.find((p) => p.id === view.neighborId);
    const name = neighbor ? displayPlayer(neighbor).name : view.neighborId;
    const loan = copy.neighborLoan;
    title = loan.title(name);
    text = loan.text(name, view.neighborId === 'bot-mia', coins(view.amount), coins(view.returnAmount));
    hint = loan.hint;
    accept = loan.accept(coins(view.amount));
    decline = loan.decline;
    success = loan.lent(name, coins(view.amount));
    details = <>
      <div className="choice-money"><span>{loan.amount}</span><b>{coins(view.amount)}</b><small>{loan.back(coins(view.returnAmount))}</small></div>
      <button className="link-btn" onClick={() => { close(); showNeighbor(view.neighborId); }}>{loan.viewNeighbor}</button>
    </>;
  } else if (view.kind === 'fireSale') {
    const neighbor = world.players.find((p) => p.id === view.neighborId);
    const name = neighbor ? displayPlayer(neighbor).name : view.neighborId;
    const sale = copy.fireSale;
    const asset = assetCopy(view.defId, view.level);
    title = sale.title(name);
    text = sale.text(name, view.neighborId === 'bot-mia', asset.accusative, coins(view.price), coins(view.usualPrice));
    hint = sale.hint;
    accept = sale.accept(coins(view.price));
    decline = sale.decline;
    success = sale.bought(asset.title, coins(view.price));
    details = <>
      <div className="choice-money pos">{sale.income(coins(view.weeklyIncome))}{view.paybackWeeks !== null && <small>{sale.payback(weeksAcc(view.paybackWeeks))}</small>}</div>
      <ChoiceFreedom view={view} />
      <button className="link-btn" onClick={() => { close(); showNeighbor(view.neighborId); }}>{copy.neighborLoan.viewNeighbor}</button>
    </>;
  } else {
    const buyer = copy.buyer;
    const asset = assetCopy(view.defId, view.level);
    title = buyer.title(asset.accusative);
    text = buyer.text(asset.accusative, coins(view.offer), coins(view.saleValue));
    hint = buyer.hint;
    accept = buyer.accept(coins(view.offer));
    decline = buyer.decline;
    success = buyer.sold(asset.title, coins(view.offer));
    details = <><div className="choice-money">{buyer.income(coins(view.weeklyIncome))}</div><ChoiceFreedom view={view} /></>;
  }
  const blocked = 'canAccept' in view && !view.canAccept;
  const reason = 'reason' in view && view.reason ? errorText(view.reason) : undefined;
  const resolve = (accepted: boolean) => {
    if (act({ type: 'resolveChoice', playerId: HUMAN, accept: accepted }, accepted ? success : copy.declined)) close();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div ref={ref} className="modal panel choice-modal" role="dialog" aria-modal="true" aria-labelledby="choice-title" aria-describedby="choice-text" onClick={(e) => e.stopPropagation()}>
        <div className="kicker">{copy.kicker}</div>
        <h2 id="choice-title">{title}</h2>
        <p id="choice-text" className="lead">{text}</p>
        {details}
        <p className="hint-text">{hint}</p>
        <div className="choice-buttons">
          <button className="btn primary" disabled={blocked} onClick={() => resolve(true)}>{blocked && reason ? reason : accept}</button>
          {later}
          <button className="btn ghost" onClick={() => resolve(false)}>{decline}</button>
        </div>
      </div>
    </div>
  );
}

function ChoiceFreedom({ view }: { view: Extract<ChoiceView, { kind: 'fireSale' | 'buyer' }> }) {
  const { t } = useI18n();
  const before = percent(view.freedomBefore), after = percent(view.freedomAfter);
  return <div className={`freedom-line ${after < before ? 'neg' : after > before ? 'pos' : ''}`}>{t.ui.choices.freedom(before, after)}</div>;
}
