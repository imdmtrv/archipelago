import { useEffect, useState } from 'react';
import { DREAM_WORK_EMPLOYED, getPlayer, PROFESSIONS, PROFESSION_ORDER, type ProfessionId } from '@arch/engine';
import { HUMAN, useGame, type WeekModal as WeekModalData } from '../store';
import { fmt, signed, weeksAcc } from '../format';
import { challengeComparison, challengeResult, dictFor, dreamCopy, eventCopy, useI18n, type Lang } from '../i18n';
import { Confetti, focusOnMount } from './common';
import { EpilogueModal } from './Epilogue';
import { daysText, lowerFirst, speedUpText } from './text';
import { Emblem } from './TopBar';
import { ShareButton } from './ShareButton';
import type { ChallengeData } from '../challenge';
import { track } from '../analytics';
import { ArchReport } from './arch/ArchReport';

export function WelcomeModal({ challenge = null, onDismiss }: { challenge?: ChallengeData | null; onDismiss?: () => void }) {
  const { t, lang, setLang } = useI18n();
  const newGame = useGame((s) => s.newGame);
  const hasGame = useGame((s) => !!s.world);
  const [island, setIsland] = useState(challenge?.island ?? t.meta.defaultIsland);
  const [name, setName] = useState('');
  const [selectedProfession, setProfession] = useState<ProfessionId>('teacher');
  const profession = challenge?.profession ?? selectedProfession;
  const feedbackUrl = import.meta.env.VITE_FEEDBACK_URL?.trim();
  const switchLanguage = (next: Lang) => {
    const currentDefault = dictFor(lang).meta.defaultIsland;
    const nextDefault = dictFor(next).meta.defaultIsland;
    if (!challenge && island === currentDefault) setIsland(nextDefault);
    setLang(next);
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal panel welcome"
        onSubmit={(e) => {
          e.preventDefault();
          newGame(island.trim() || t.meta.defaultIsland, name.trim() || t.meta.defaultPlayer, challenge?.seed, challenge, profession);
          track(`profession-${profession}`);
          if (challenge) track('challenge-start');
          onDismiss?.();
        }}
      >
        <div className="welcome-language language-switch" aria-label={t.ui.language}>
          <button type="button" className={lang === 'ru' ? 'active' : ''} onClick={() => switchLanguage('ru')}>RU</button>
          <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => switchLanguage('en')}>EN</button>
        </div>
        <div className="welcome-heading"><Emblem /><h2>{t.meta.app}</h2></div>
        <p className="lead">{challenge ? challengeResult(challenge) : t.ui.welcome.lead}</p>
        {challenge && hasGame && <p className="challenge-warning">{t.ui.challenge.replace}</p>}
        <ul className="rules">
          <li><b className="pos">{t.ui.welcome.asset}</b> {t.ui.welcome.assetRule}</li>
          <li><b className="neg">{t.ui.welcome.liability}</b> {t.ui.welcome.liabilityRule}</li>
          <li><b>{t.ui.welcome.goal}</b> {t.ui.welcome.goalRule}</li>
          <li><b>{t.ui.welcome.dream}</b> {t.ui.welcome.dreamRule}</li>
        </ul>
        <div className="welcome-fields">
          <label className="field">
            <span>{t.ui.welcome.island}</span>
            <input value={island} maxLength={24} onChange={(e) => setIsland(e.target.value)} />
          </label>
          <label className="field">
            <span>{t.ui.welcome.name}</span>
            <input value={name} maxLength={20} placeholder={t.meta.exampleName} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <fieldset className="profession-picker" aria-describedby="profession-hint">
          <legend>{t.ui.welcome.profession}</legend>
          <div className="profession-grid">
            {PROFESSION_ORDER.map((id) => {
              const copy = t.professions[id];
              const def = PROFESSIONS[id];
              return <label key={id} className={`profession-card ${profession === id ? 'selected' : ''}`}>
                <input type="radio" name="profession" value={id} checked={profession === id} disabled={!!challenge} onChange={() => setProfession(id)} />
                <b>{copy.title}</b>
                <span className="profession-text">{copy.text}</span>
                <span className="profession-stats">
                  <span>{t.ui.welcome.professionSalary(fmt(def.salary))}</span>
                  <span>{t.ui.welcome.professionLiving(fmt(def.living))}</span>
                  <span>{t.ui.welcome.professionCash(fmt(def.cash))}</span>
                  {def.loan > 0 && <span>{t.ui.welcome.professionLoan(fmt(def.loan))}</span>}
                </span>
              </label>;
            })}
          </div>
          <p id="profession-hint" className="profession-hint">{t.ui.welcome.professionHint}</p>
          {challenge && <p className="profession-hint">{t.ui.welcome.professionChallenge(t.professions[profession].title)}</p>}
        </fieldset>
        <button className="btn primary big" type="submit">{challenge && hasGame ? t.ui.challenge.accept : t.ui.welcome.start}</button>
        {challenge && hasGame && <button className="btn ghost big" type="button" onClick={onDismiss}>{t.ui.challenge.continue}</button>}
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
          <button className="btn primary" onClick={onStay} ref={focusOnMount}>{t.ui.weekModal.stay}</button>
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
  const arch = mine.arch;
  const income = mine.salary + mine.assetIncome.reduce((s, a) => s + a.amount, 0)
    + (arch ? arch.businesses + Math.max(0, arch.routes) + arch.bankInterest : 0);
  const expenses = mine.living + mine.upkeep.reduce((s, a) => s + a.amount, 0) + mine.interest + mine.insurance
    + (arch ? arch.managers + Math.max(0, -arch.routes) + arch.bankLost + arch.upkeep + arch.insurance + arch.repairs : 0);
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
  const challenge = useGame((s) => s.challenge);
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
            {challenge && <p className="challenge-comparison">{challengeComparison(modal.report.week, challenge)}</p>}
            <ShareButton />
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
        <ArchReport lines={modal.report.players[HUMAN].arch} />
        {modal.freedom
          ? <FreedomChoice onStay={close} onQuit={quit} />
          : <button className="btn primary big" onClick={close} ref={focusOnMount}>{t.ui.weekModal.next}</button>}
      </div>
    </div>
  );
}

export function ToastView() {
  const toast = useGame((s) => s.toast);
  if (!toast) return null;
  return <div key={toast.id} className={`toast ${toast.tone}`} role="status">{toast.text}</div>;
}
