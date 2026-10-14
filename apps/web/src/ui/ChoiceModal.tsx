import { useEffect, useRef } from 'react';
import { choiceView, type ChoiceView } from '@arch/engine';
import { HUMAN, useGame } from '../store';
import { assetCopy, coins, displayPlayer, errorText, useI18n } from '../i18n';
import { percent } from './text';

/** Решение живёт в движке; закрытие окна оставляет его на следующую попытку хода. */
export function ChoiceModal() {
  const { t } = useI18n();
  const world = useGame((s) => s.world);
  const open = useGame((s) => s.choiceOpen);
  const weekModal = useGame((s) => s.modal);
  const close = useGame((s) => s.closeChoice);
  const act = useGame((s) => s.act);
  const showNeighbor = useGame((s) => s.showNeighbor);
  const ref = useRef<HTMLDivElement>(null);
  const view = world && open && !weekModal ? choiceView(world, HUMAN) : null;
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
  let details;
  if (view.kind === 'neighborLoan') {
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
  } else if (view.kind === 'promotion') {
    const promotion = copy.promotion;
    title = promotion.title;
    text = promotion.text(coins(view.salaryIncrease), coins(view.livingIncrease));
    hint = promotion.hint;
    accept = promotion.accept;
    decline = promotion.decline;
    success = promotion.done;
    details = <><div className="choice-money pos">{promotion.net(coins(view.netChange))}</div><ChoiceFreedom view={view} /></>;
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
  const blocked = view.kind === 'neighborLoan' && !view.canAccept;
  const reason = view.kind === 'neighborLoan' && view.reason ? errorText(view.reason) : undefined;
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
          <button className="btn ghost" onClick={() => resolve(false)}>{decline}</button>
        </div>
      </div>
    </div>
  );
}

function ChoiceFreedom({ view }: { view: Extract<ChoiceView, { kind: 'promotion' | 'buyer' }> }) {
  const { t } = useI18n();
  const before = percent(view.freedomBefore), after = percent(view.freedomAfter);
  return <div className={`freedom-line ${after < before ? 'neg' : after > before ? 'pos' : ''}`}>{t.ui.choices.freedom(before, after)}</div>;
}
