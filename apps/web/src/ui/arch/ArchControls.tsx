import { useEffect, useRef } from 'react';
import { archipelagoView, financeView, getPlayer } from '@arch/engine';
import { HUMAN, useGame } from '../../store';
import { useI18n } from '../../i18n';
import { Confetti } from '../common';
import { percent } from '../text';

export function ArchToggle() {
  const { t } = useI18n();
  const world = useGame((s) => s.world)!;
  const on = useGame((s) => s.archMode);
  const focus = useGame((s) => s.archFocus);
  const setMode = useGame((s) => s.setArchMode);
  const setFocus = useGame((s) => s.setArchFocus);
  if (!world.archipelago && getPlayer(world, HUMAN).freedomWeek === null) return null;
  const view = archipelagoView(world, HUMAN);
  const promise = t.arch.promise(percent(financeView(world, HUMAN).freedomRatio));
  return <div className="arch-controls">
    {on && focus && <button className="btn ghost arch-back" onClick={() => setFocus(null)}>{t.arch.back}</button>}
    <button className="btn arch-toggle" disabled={!view} aria-pressed={on} title={!view ? promise : view.attention ? t.arch.toggle.attention : undefined}
      onClick={() => { if (on && focus) setFocus(null); else setMode(!on); }}>
      {!view ? '🔒 ' : ''}{on ? t.arch.toggle.home : t.arch.toggle.arch}
      {view?.attention && <span className="arch-dot" aria-label={t.arch.toggle.attention} />}
    </button>
    {!view && <span className="arch-lock-hint">{promise}</span>}
  </div>;
}

export function ArchLegacy() {
  const { t, fmt } = useI18n();
  const world = useGame((s) => s.world);
  const view = world && archipelagoView(world, HUMAN);
  if (!view) return null;
  return <div className="arch-legacy"><h3>{t.arch.epilogue.legacy}</h3><p>{t.arch.epilogue.legacyText(view.legacy.freeNeighbors, fmt(view.legacy.paidToNeighbors))}</p></div>;
}

export function ArchMilestoneModal() {
  const { t } = useI18n();
  const notice = useGame((s) => s.archNotice);
  const modal = useGame((s) => s.modal);
  const busy = useGame((s) => s.busy);
  const close = useGame((s) => s.closeArchNotice);
  const setMode = useGame((s) => s.setArchMode);
  const ref = useRef<HTMLDivElement>(null);
  const visible = !!notice && !modal && !busy;
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') { e.preventDefault(); ref.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, [visible, close, notice]);
  if (!visible) return null;
  const intro = notice === 'intro';
  const copy = intro ? t.arch.intro : t.arch.events.archFinale;
  return <div className="modal-backdrop arch-milestone-backdrop" onClick={close}>
    <Confetti />
    <div ref={ref} className="modal panel arch-milestone" role="dialog" aria-modal="true" aria-labelledby="arch-milestone-title" aria-describedby="arch-milestone-text" onClick={(e) => e.stopPropagation()}>
      <h2 id="arch-milestone-title">{copy.title}</h2><p id="arch-milestone-text" className="lead">{copy.text}</p>
      {!intro && <ArchLegacy />}
      <button className="btn primary big" onClick={() => { setMode(true); close(); }}>{intro ? t.arch.intro.button : t.ui.epilogue.continue}</button>
    </div>
  </div>;
}
