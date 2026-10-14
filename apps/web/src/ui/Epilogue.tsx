import { useEffect } from 'react';
import { financeView, getPlayer, leaderboard } from '@arch/engine';
import { HUMAN, useGame, type WeekModal } from '../store';
import { Confetti, ConfirmButton, Meter } from './common';
import { levelTitle, percent } from './text';
import { displayPlayer, getI18n, useI18n, weeksAcc } from '../i18n';
import { ShareButton } from './ShareButton';
import { track } from '../analytics';

/** «Мия, Борис и Тимур». */
const names = (list: string[]) => {
  if (list.length < 2) return list[0];
  const { t } = getI18n();
  return t.ui.epilogue.joinAnd(list.slice(0, -1).join(', '), list[list.length - 1]);
};

/** Соседи: кто и когда достиг свободы. Без склонений имён — они придумываются ботам заново. */
function neighboursLine(rows: ReturnType<typeof leaderboard>): string {
  const { t } = getI18n();
  const bots = rows.filter((r) => r.isBot);
  if (bots.length === 0) return '';
  const reached = bots
    .filter((r) => r.freedomWeek !== null)
    .sort((a, b) => a.freedomWeek! - b.freedomWeek!);
  const waiting = bots.filter((r) => r.freedomWeek === null).map((r) => displayPlayer({ id: r.playerId, name: r.name, islandName: r.islandName, isBot: true }).name);
  if (reached.length === 0) return t.ui.epilogue.neighborsWaiting;
  const done = reached.map((r, i) => {
    const name = displayPlayer({ id: r.playerId, name: r.name, islandName: r.islandName, isBot: true }).name;
    return i === 0 ? t.ui.epilogue.neighborFirst(name, r.freedomWeek!) : t.ui.epilogue.neighborNext(name, r.freedomWeek!);
  }).join(', ');
  const tail = waiting.length > 0 ? `; ${t.ui.epilogue.still(names(waiting))}` : '';
  return `${t.ui.epilogue.neighborsPrefix} ${done}${tail}.`;
}

/** Эпилог: мечта построена. Итог по четырём осям, без единого счёта — разные пути одинаково честные. */
export function EpilogueModal({ modal }: { modal: WeekModal }) {
  const { t } = useI18n();
  const world = useGame((s) => s.world)!;
  const close = useGame((s) => s.closeModal);
  const resetGame = useGame((s) => s.resetGame);
  const me = getPlayer(world, HUMAN);
  const fin = financeView(world, HUMAN);
  const neighbours = neighboursLine(leaderboard(world));

  // Escape тоже «играть дальше»; Enter на кнопке нажимает её саму
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const dreamWeek = me.dream?.doneWeek ?? modal.report.week;
  const happiness = Math.round(me.happiness);
  const feedbackUrl = import.meta.env.VITE_FEEDBACK_URL?.trim();

  return (
    <div className="modal-backdrop" onClick={close}>
      <Confetti />
      <div className="modal panel week epilogue" onClick={(e) => e.stopPropagation()}>
        <div className="kicker">{t.ui.epilogue.kicker}</div>
        <h2>{t.ui.epilogue.title}</h2>
        <p className="lead">{t.ui.epilogue.lead(displayPlayer(me).islandName)}</p>

        <div className="results">
          <div className="result">
            <span>{t.ui.epilogue.freedom}</span>
            <b>{me.freedomWeek !== null ? t.ui.epilogue.since(me.freedomWeek) : t.ui.epilogue.ahead}</b>
          </div>
          <div className="result">
            <span>{t.ui.epilogue.dream}</span>
            <b>{t.ui.epilogue.built(dreamWeek)}</b>
          </div>
          <div className="result">
            <span>{t.ui.epilogue.reserve}</span>
            <b>{levelTitle(fin.level)} · {percent(fin.freedomRatio)}%</b>
          </div>
          <div className="result">
            <span>{t.ui.epilogue.happiness}</span>
            <b>{happiness}</b>
            <Meter value={me.happiness} />
          </div>
        </div>

        {neighbours && <p className="neighbours">{neighbours}</p>}
        <p className="hint-text">
          {t.ui.epilogue.hint}
        </p>

        <div className="epilogue-actions">
          <button className="btn primary big" onClick={close} autoFocus>{t.ui.epilogue.continue}</button>
          <ConfirmButton className="btn ghost big" confirmText={t.ui.epilogue.resetConfirm} onConfirm={resetGame}>
            {t.ui.epilogue.newGame}
          </ConfirmButton>
          <ShareButton className="btn ghost big" text={t.ui.shareEpilogue(weeksAcc(me.freedomWeek ?? modal.report.week), weeksAcc(dreamWeek))} />
        </div>
        {feedbackUrl && <a className="secondary-link feedback-link" href={feedbackUrl} target="_blank" rel="noreferrer" onClick={() => track('feedback-open')}>{t.ui.welcome.feedback}</a>}
      </div>
    </div>
  );
}
