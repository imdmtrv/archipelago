import { useEffect, useState } from 'react';
import { goalsView } from '@arch/engine';
import { HUMAN, useGame } from '../store';
import { goalCopy, goalRewardText, useI18n } from '../i18n';

const OPEN_KEY = 'archipelago.goals.open.v1';

/** Телефон: краткая строка, полный список — по нажатию. */
export function MobileGoals({ seen, onSeen }: { seen: string; onSeen: (key: string) => void }) {
  const { t } = useI18n();
  const world = useGame((s) => s.world)!;
  const view = goalsView(world, HUMAN);
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) === 'true'; } catch { return false; }
  });
  const fresh = view?.done.filter((goal) => goal.week === world.lastReport?.week) ?? [];
  const key = fresh.map((goal) => `${goal.id}:${goal.week}`).join(',');
  useEffect(() => {
    if (open) onSeen(key);
  }, [open, key, onSeen]);
  if (!view) return null;
  const toggle = () => {
    try { localStorage.setItem(OPEN_KEY, String(!open)); } catch { /* Хранилище недоступно. */ }
    if (!open) onSeen(key);
    setOpen(!open);
  };
  const label = open ? t.ui.goals.hide : t.ui.goals.show;
  return (
    <section className="mobile-goals">
      <button className="goals-summary card" type="button" onClick={toggle} title={label} aria-label={label} aria-expanded={open} aria-controls="mobile-goals-list">
        <b>{t.ui.goals.title}</b>
        <span className="goals-count" aria-label={t.ui.goals.done(view.done.length, view.total)}>✓ {t.ui.goals.progress(String(view.done.length), String(view.total))}</span>
        <span className="goals-rings">
          {view.active.slice(0, 3).map((goal) => {
            const title = goalCopy(goal.id).title;
            const share = goal.target > 0 ? Math.max(0, Math.min(1, goal.value / goal.target)) : 0;
            return <span key={goal.id} className="goal-ring" role="img" title={title} aria-label={title}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <circle cx="9" cy="9" r="7" fill="none" stroke="var(--line)" strokeWidth="2" />
                <circle cx="9" cy="9" r="7" fill="none" stroke="var(--asset)" strokeWidth="2" pathLength="1" strokeDasharray={`${share} 1`} transform="rotate(-90 9 9)" />
              </svg>
            </span>;
          })}
        </span>
        {!open && fresh.length > 0 && seen !== key && <span className="goals-new">{t.ui.goals.newDone(fresh.length)}</span>}
        <span className="goals-chevron" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      <div id="mobile-goals-list" hidden={!open}>{open && <GoalsBlock />}</div>
    </section>
  );
}

/** Ближайшие цели без сроков: под мечтой в обеих раскладках. */
export function GoalsBlock({ panel }: { panel?: boolean }) {
  const { t, fmt } = useI18n();
  const world = useGame((s) => s.world);
  const view = world ? goalsView(world, HUMAN) : null;
  if (!view) return null;
  return (
    <section className={`goals ${panel ? 'panel pad' : 'card'}`} aria-labelledby="goals-title">
      <div className="goals-top"><h4 id="goals-title">{t.ui.goals.title}</h4><span>{t.ui.goals.done(view.done.length, view.total)}</span></div>
      {view.done.length >= view.total && view.active.length === 0 ? <p className="hint-text">{t.ui.goals.allDone}</p> : (
        <div className="goals-list">
          {view.active.map((goal) => {
            const copy = goalCopy(goal.id);
            const value = Math.max(0, Math.min(goal.target, goal.value));
            const share = goal.target > 0 ? value / goal.target : 0;
            return (
              <article className="goal" key={goal.id}>
                <h5>{copy.title}</h5>
                <p>{copy.text}</p>
                <div className="bar" role="progressbar" aria-label={copy.title} aria-valuemin={0} aria-valuenow={value} aria-valuemax={goal.target}>
                  <div className="fill" style={{ width: `${share * 100}%` }} />
                </div>
                <div className="goal-progress">{t.ui.goals.progress(fmt(goal.value), fmt(goal.target))}</div>
                <div className="goal-reward">{t.ui.goals.reward(goalRewardText(goal.reward))}</div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
