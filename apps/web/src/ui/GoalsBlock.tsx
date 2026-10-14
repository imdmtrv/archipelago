import { goalsView } from '@arch/engine';
import { HUMAN, useGame } from '../store';
import { goalCopy, goalRewardText, useI18n } from '../i18n';

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
