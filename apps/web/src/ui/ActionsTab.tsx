import {
  financeView, getPlayer, insuranceActive, insurancePremium, loanLimit, studyCost,
  EMERGENCY_RATE, LOAN_RATE, REST_COST, REST_JOY, THREAT_WEEKS, INSURANCE_WAIT_WEEKS,
} from '@arch/engine';
import { HUMAN, useGame } from '../store';
import { ConfirmButton, Pips, Section } from './common';
import { returnSalary, speedUpText } from './text';
import { useI18n, weeks } from '../i18n';

export function ActionsTab() {
  const { t, fmt, lang } = useI18n();
  const world = useGame((s) => s.world)!;
  const act = useGame((s) => s.act);
  const me = getPlayer(world, HUMAN);
  const fin = financeView(world, HUMAN);
  const limit = loanLimit(world, HUMAN);
  const premium = insurancePremium(me);
  const cost = studyCost(me);
  const shiftBonus = Math.round(me.salary * 0.5);
  const free = me.freedomWeek !== null;
  const newSalary = returnSalary(me.salary);
  const pct = (rate: number) => `${(rate * 100).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 1 })}%`;

  return (
    <div className="tab-body">
      <Section title={t.ui.actions.workRest}>
        {me.employed && me.happiness < 30 && (
          <div className="warning">
            {t.ui.actions.burnout}
          </div>
        )}
        {me.employed ? (
          <label className={`toggle-row ${me.restedThisWeek ? 'off' : ''}`}>
            <div>
              <b>{t.ui.actions.extraShift}</b>
              <span>
                {me.restedThisWeek ? t.ui.actions.resting : t.ui.actions.shiftEffect(fmt(shiftBonus))}
              </span>
            </div>
            <input
              type="checkbox"
              className="switch"
              checked={me.extraShift}
              disabled={me.restedThisWeek}
              onChange={(e) => act({ type: 'setExtraShift', playerId: HUMAN, on: e.target.checked })}
            />
          </label>
        ) : (
          <div className="action-row col job">
            <div>
              <b>{t.ui.actions.notWorking}</b>
              <span>
                {t.ui.actions.notWorkingText(speedUpText(), weeks(THREAT_WEEKS))}
              </span>
              {me.threatWeeks > 0 && (
                <span className="neg">
                  {t.ui.actions.threat(Math.max(0, THREAT_WEEKS - me.threatWeeks))}
                </span>
              )}
            </div>
            <div className="job-foot">
              <span>{t.ui.actions.newSalary(fmt(newSalary), fmt(me.salary))}</span>
              <ConfirmButton
                className="btn ghost sm"
                confirmText={t.ui.actions.returnConfirm}
                onConfirm={() => act({ type: 'returnToWork', playerId: HUMAN }, t.ui.actions.returned)}
              >
                {t.ui.actions.returnWork}
              </ConfirmButton>
            </div>
          </div>
        )}
        {me.employed && free && (
          <div className="action-row col job">
            <div>
              <b>{t.ui.actions.quit}</b>
              <span>
                {t.ui.actions.quitText(speedUpText(), weeks(THREAT_WEEKS))}
              </span>
              {fin.freedomRatio < 1 && (
                <span className="neg">{t.ui.actions.shortfall}</span>
              )}
            </div>
            <ConfirmButton
              className="btn ghost sm"
              confirmText={t.ui.actions.quitConfirm}
              onConfirm={() => act({ type: 'quitJob', playerId: HUMAN }, t.ui.actions.quitSuccess)}
            >
              {t.ui.actions.quit}
            </ConfirmButton>
          </div>
        )}
        {me.employed && !free && (
          <div className="muted-text">{t.ui.actions.quitLocked}</div>
        )}
        <div className="action-row">
          <div>
            <b>{t.ui.actions.rest}</b>
            <span>
              {me.extraShift ? t.ui.actions.noRestShift : t.ui.actions.restEffect(fmt(REST_COST), REST_JOY)}
            </span>
          </div>
          <button
            className="btn ghost sm"
            disabled={me.restedThisWeek || me.extraShift}
            onClick={() => act({ type: 'rest', playerId: HUMAN }, t.ui.actions.restedSuccess)}
          >
            {me.restedThisWeek ? t.ui.actions.rested : t.ui.actions.restButton}
          </button>
        </div>
      </Section>

      <Section title={t.ui.actions.study} aside={<Pips value={me.knowledge} max={3} />}>
        {cost !== null ? (
          <div className="action-row">
            <div>
              <b>{t.ui.actions.course}</b>
              <span>{t.ui.actions.knowledgeUnlocks[me.knowledge]}</span>
            </div>
            <button
              className="btn primary sm"
              disabled={me.studiedThisWeek}
              onClick={() => act({ type: 'study', playerId: HUMAN }, t.ui.actions.studiedSuccess)}
            >
              {me.studiedThisWeek ? t.ui.actions.nextWeek : t.ui.actions.studyButton(fmt(cost))}
            </button>
          </div>
        ) : (
          <div className="muted-text">{t.ui.actions.allCourses}</div>
        )}
      </Section>

      <Section title={t.ui.actions.insurance}>
        <label className="toggle-row">
          <div>
            <b>{t.ui.actions.insure}</b>
            <span>{t.ui.actions.insureText(fmt(premium))}</span>
          </div>
          <input
            type="checkbox"
            className="switch"
            checked={me.insured}
            onChange={(e) => act({ type: 'setInsurance', playerId: HUMAN, on: e.target.checked })}
          />
        </label>
        {/* Публичный API пока не экспортирует срок ожидания; четыре недели заданы контрактом. */}
        <p className="hint-text">{t.ui.actions.insuranceWait(weeks(INSURANCE_WAIT_WEEKS))}</p>
        {me.insured && me.insuranceFrom !== null && !insuranceActive(me, world.week) && (
          <p className="hint-text insurance-pending">{t.ui.actions.insurancePending(me.insuranceFrom)}</p>
        )}
      </Section>

      <Section title={t.ui.actions.bank}>
        <div className="muted-text">
          {t.ui.actions.bankText(pct(LOAN_RATE), pct(EMERGENCY_RATE))}
        </div>
        <div className="loan-take">
          <span>{t.ui.actions.borrow(fmt(limit))}</span>
          <div className="btn-group">
            {[100, 500].map((amount) => (
              <button
                key={amount}
                className="btn ghost sm"
                disabled={limit < amount}
                onClick={() => act({ type: 'takeLoan', playerId: HUMAN, amount }, t.ui.actions.creditTaken(fmt(amount)))}
              >
                +{fmt(amount)}
              </button>
            ))}
          </div>
        </div>
        {me.loans.map((loan) => {
          const pay = Math.min(me.cash, loan.principal);
          return (
            <div key={loan.uid} className={`action-row loan ${loan.emergency ? 'emergency' : ''}`}>
              <div>
                <b>{loan.emergency ? t.ui.actions.shark : t.ui.actions.bankLoan}: {fmt(loan.principal)}</b>
                <span>{pct(loan.weeklyRate)} {t.ui.inWeek} = −{fmt(loan.principal * loan.weeklyRate)}</span>
              </div>
              <button
                className="btn ghost sm"
                disabled={pay <= 0}
                onClick={() => act({ type: 'repayLoan', playerId: HUMAN, loanUid: loan.uid, amount: pay }, t.ui.actions.debtReduced)}
              >
                {t.ui.actions.repay(fmt(pay))}
              </button>
            </div>
          );
        })}
        {fin.debt === 0 && <div className="muted-text">{t.ui.actions.noDebt}</div>}
      </Section>
    </div>
  );
}
