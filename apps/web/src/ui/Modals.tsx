import { useEffect, useState } from 'react';
import { DREAM_WORK_EMPLOYED, getPlayer } from '@arch/engine';
import { HUMAN, useGame, type WeekModal as WeekModalData } from '../store';
import { fmt, signed, weeksAcc } from '../format';
import { dictFor, dreamCopy, eventCopy, useI18n, type Lang } from '../i18n';
import { Confetti } from './common';
import { EpilogueModal } from './Epilogue';
import { daysText, lowerFirst, speedUpText } from './text';
import { Emblem } from './TopBar';
import { share } from '../share';
import { track } from '../analytics';

export function WelcomeModal() {
  const { t, lang, setLang } = useI18n();
  const newGame = useGame((s) => s.newGame);
  const [island, setIsland] = useState(t.meta.defaultIsland);
  const [name, setName] = useState('');
  const feedbackUrl = import.meta.env.VITE_FEEDBACK_URL?.trim();
  const switchLanguage = (next: Lang) => {
    const currentDefault = dictFor(lang).meta.defaultIsland;
    const nextDefault = dictFor(next).meta.defaultIsland;
    if (island === currentDefault) setIsland(nextDefault);
    setLang(next);
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal panel welcome"
        onSubmit={(e) => { e.preventDefault(); newGame(island.trim() || t.meta.defaultIsland, name.trim() || t.meta.defaultPlayer); }}
      >
        <div className="welcome-language language-switch" aria-label={t.ui.language}>
          <button type="button" className={lang === 'ru' ? 'active' : ''} onClick={() => switchLanguage('ru')}>RU</button>
          <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => switchLanguage('en')}>EN</button>
        </div>
        <Emblem />
        <h2>{t.meta.app}</h2>
        <p className="lead">{t.ui.welcome.lead}</p>
        <ul className="rules">
          <li><b className="pos">{t.ui.welcome.asset}</b> {t.ui.welcome.assetRule}</li>
          <li><b className="neg">{t.ui.welcome.liability}</b> {t.ui.welcome.liabilityRule}</li>
          <li><b>{t.ui.welcome.goal}</b> {t.ui.welcome.goalRule}</li>
          <li><b>{t.ui.welcome.dream}</b> {t.ui.welcome.dreamRule}</li>
        </ul>
        <label className="field">
          <span>{t.ui.welcome.island}</span>
          <input value={island} maxLength={24} onChange={(e) => setIsland(e.target.value)} />
        </label>
        <label className="field">
          <span>{t.ui.welcome.name}</span>
          <input value={name} maxLength={20} placeholder={t.meta.exampleName} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn primary big" type="submit">{t.ui.welcome.start}</button>
        {feedbackUrl && <a className="secondary-link feedback-link" href={feedbackUrl} target="_blank" rel="noreferrer" onClick={() => track('feedback-open')}>{t.ui.welcome.feedback}</a>}
      </form>
    </div>
  );
}

/** Развилка в момент свободы: остаться на работе или уйти. Решение можно поменять во вкладке «Действия». */
function FreedomChoice({ onStay, onQuit }: { onStay: () => void; onQuit: () => void }) {
  const { t } = useI18n();
  return (
    <div className="choice">
      <div className="choice-title">{t.ui.weekModal.whatNext}</div>
      <div className="choice-cards">
        <div className="choice-card">
          <h3>{t.ui.weekModal.stayTitle}</h3>
          <p>{t.ui.weekModal.stayText(daysText(DREAM_WORK_EMPLOYED))}</p>
          <button className="btn primary" onClick={onStay} autoFocus>{t.ui.weekModal.stay}</button>
        </div>
        <div className="choice-card">
          <h3>{t.ui.weekModal.quitTitle}</h3>
          <p>{t.ui.weekModal.quitText(speedUpText())}</p>
          <button className="btn ghost" onClick={onQuit}>{t.ui.weekModal.quit}</button>
        </div>
      </div>
      <p className="hint-text">{t.ui.weekModal.choiceHint}</p>
    </div>
  );
}

function WeekSummary({ modal }: { modal: WeekModalData }) {
  const { t } = useI18n();
  const mine = modal.report.players[HUMAN];
  const income = mine.salary + mine.assetIncome.reduce((s, a) => s + a.amount, 0);
  const expenses = mine.living + mine.upkeep.reduce((s, a) => s + a.amount, 0) + mine.interest + mine.insurance;
  return (
    <div className="week-sum">
      <div><span>{t.ui.weekModal.income}</span><b className="pos">+{fmt(income)}</b></div>
      <div><span>{t.ui.weekModal.expenses}</span><b className="neg">−{fmt(expenses)}</b></div>
      <div><span>{t.ui.weekModal.net}</span><b className={mine.net >= 0 ? 'pos' : 'neg'}>{signed(mine.net)}</b></div>
      <div><span>{t.ui.weekModal.cash}</span><b>{fmt(mine.cashAfter)}</b></div>
    </div>
  );
}

export function WeekModal() {
  const { t } = useI18n();
  const modal = useGame((s) => s.modal);
  const close = useGame((s) => s.closeModal);
  const act = useGame((s) => s.act);
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      // Enter на сфокусированной кнопке нажимает именно её; окно закрываем только по Enter «в пустоту»
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest('button')) return;
      if (e.key === 'Enter' || e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, close]);
  const world = useGame((s) => s.world);
  if (!modal || !world) return null;
  if (modal.epilogue) return <EpilogueModal modal={modal} />;

  const dream = getPlayer(world, HUMAN).dream;
  const dreamTitle = dream ? lowerFirst(dreamCopy().title) : null;
  const quit = () => {
    if (act({ type: 'quitJob', playerId: HUMAN }, t.ui.weekModal.quitSuccess)) close();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      {modal.freedom && <Confetti />}
      <div className={`modal panel week ${modal.freedom ? 'freedom-modal' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="kicker">{t.ui.weekModal.kicker(modal.report.week)}</div>
        {modal.freedom ? (
          <>
            <h2>{t.ui.weekModal.freedom}</h2>
            <p className="lead">
              {t.ui.weekModal.freedomLead1}{' '}
              {t.ui.weekModal.freedomLead2(weeksAcc(modal.report.week))}
            </p>
            <button className="btn ghost share-result" type="button" onClick={() => void share(t.ui.shareFreedom(weeksAcc(modal.report.week)))}>{t.ui.share.button}</button>
            {dreamTitle && <div className="dream-unlocked">{t.ui.weekModal.dreamUnlocked(dreamTitle)}</div>}
          </>
        ) : (
          <h2>{modal.events.some((e) => e.tone === 'bad') ? t.ui.weekModal.rough : t.ui.weekModal.interesting}</h2>
        )}

        <div className="events">
          {modal.events.map((e, i) => {
            const copy = eventCopy(e, world.players, world.week);
            return (
              <div key={i} className={`event ${e.tone}`}>
                <div className="event-head">
                  <b>{copy.title}</b>
                  {e.cashDelta ? <span className={e.cashDelta > 0 ? 'pos' : 'neg'}>{signed(e.cashDelta)}</span> : null}
                </div>
                <p>{copy.text}</p>
              </div>
            );
          })}
        </div>

        <WeekSummary modal={modal} />
        {modal.freedom
          ? <FreedomChoice onStay={close} onQuit={quit} />
          : <button className="btn primary big" onClick={close} autoFocus>{t.ui.weekModal.next}</button>}
      </div>
    </div>
  );
}

export function ToastView() {
  const toast = useGame((s) => s.toast);
  if (!toast) return null;
  return <div key={toast.id} className={`toast ${toast.tone}`} role="status">{toast.text}</div>;
}
