import { useEffect, useRef } from 'react';
import { financeView } from '@arch/engine';
import { GHOST_ID, ghostProgress } from '../challenge';
import { HUMAN, useGame } from '../store';
import { momentText, useI18n } from '../i18n';
import { RingAvatar, Sparkline } from './Neighbors';
import { percent } from './text';

/** Запись друга показывает только путь: она не добавляет игрока в мир или рейтинг. */
export function GhostCard({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const world = useGame((s) => s.world)!;
  const challenge = useGame((s) => s.challenge)!;
  const history = useGame((s) => s.history);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && !card.current?.contains(target) && !target.closest('.nb-chip')) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);
  const theirs = ghostProgress(challenge, world.week);
  const mine = financeView(world, HUMAN).freedomRatio;
  const line = challenge.progress.slice(0, world.week).map((pct, i) => ({ week: i + 1, ratio: pct / 100 }));
  if (world.week > challenge.week) line.push({ week: world.week, ratio: theirs / 100 });
  const lines = { ...history, [GHOST_ID]: line,
    [HUMAN]: [...(history[HUMAN] ?? []).filter((p) => p.week < world.week), { week: world.week, ratio: mine }] };
  const moments = challenge.moments.filter((m) => m.week <= world.week);
  return <div ref={card} className="neighbor-card ghost-card panel" role="dialog" aria-label={`${challenge.name} · ${t.ui.challenge.label}`}>
    <button className="icon-btn close" onClick={onClose} aria-label={t.ui.neighbors.close}>×</button>
    <div className="nc-head">
      <span className="ghost-avatar"><RingAvatar letter={Array.from(challenge.name)[0]} color="#7B6CC4" ratio={theirs / 100} size={52} free={theirs >= 100} /></span>
      <div><div className="nc-name">{challenge.name}</div><div className="nc-sub">{t.ui.challenge.label} · {challenge.island}</div></div>
    </div>
    <div className="list-title">{t.ui.challenge.current(world.week)}</div>
    <div className="nc-grid">
      <div><span>{challenge.name}</span><b>{theirs}%</b></div>
      <div><span>{t.ui.neighbors.youLabel}</span><b>{percent(mine)}%</b></div>
    </div>
    <Sparkline history={lines} id={GHOST_ID} color="#7B6CC4" name={challenge.name} />
    <div className="list-title">{t.ui.neighbors.recent}</div>
    {moments.length ? [...moments].reverse().map((m, i) => <div className="news" key={i}>
      <span className="muted">{t.ui.weekShort} {m.week}</span> {momentText(m)}
    </div>) : <div className="muted-text">{t.ui.challenge.noMoments}</div>}
  </div>;
}
