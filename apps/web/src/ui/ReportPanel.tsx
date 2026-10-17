import { assetViews, financeView, getPlayer, FREEDOM_LEVEL_RATIOS, THREAT_WEEKS } from '@arch/engine';
import { HUMAN, useGame } from '../store';
import { Meter, Pips } from './common';
import { lowerFirst, percent } from './text';
import { levelGenitive, levelTitle, useI18n, weeks, weeksAcc } from '../i18n';
import { ShareButton } from './ShareButton';
import { ArchReport } from './arch/ArchReport';

/** До свободы шкала 0–100%; после — шкала запаса до последнего уровня, с отметками уровней. */
export function FreedomBlock({ compact = false }: { compact?: boolean }) {
  const { t, fmt } = useI18n();
  const world = useGame((s) => s.world)!;
  const fin = financeView(world, HUMAN);
  const me = getPlayer(world, HUMAN);
  const pct = percent(fin.freedomRatio);

  // Свобода засчитывается движком в конце недели и только по настоящим активам
  if (me.freedomWeek === null) {
    const covered = fin.freedomRatio >= 1;
    return (
      <div className="freedom" data-coach="freedom">
        <div className="freedom-head"><span>{t.ui.report.toFreedom}</span><b>{pct}%</b></div>
        <div className="bar"><div className="fill" style={{ width: `${Math.min(100, pct)}%` }} /></div>
        <div className="freedom-foot">
          {covered
            ? <>{t.ui.report.covered} <b>{t.ui.report.hold}</b></>
            : <>{t.ui.report.passiveCovers(fmt(fin.passiveIncome), fmt(fin.expenses.total))}</>}
        </div>
      </div>
    );
  }

  const level = fin.level;
  const free = level >= 1;
  const ticks = FREEDOM_LEVEL_RATIOS.slice(0, -1);
  const top = FREEDOM_LEVEL_RATIOS[FREEDOM_LEVEL_RATIOS.length - 1];
  const at = (ratio: number) => `${(ratio / top) * 100}%`;
  const weeksToReturn = Math.max(0, THREAT_WEEKS - me.threatWeeks);
  const shortfall = !free && fin.freedomRatio < 1;

  return (
    <div className={`freedom after ${free ? 'free' : ''}`} data-coach="freedom">
      <div className="freedom-head"><span>{levelTitle(level)}</span><b>{pct}%</b></div>
      <div className="bar scaled">
        <div className="fill" style={{ width: `${Math.min(100, (fin.freedomRatio / top) * 100)}%` }} />
        {ticks.map((r) => <i key={r} className="tick" style={{ left: at(r) }} />)}
      </div>
      <div className="scale" aria-hidden>
        {[...ticks, top].map((r) => <span key={r} style={{ left: at(r) }}>{percent(r)}%</span>)}
      </div>
      <div className="freedom-foot">
        {level < FREEDOM_LEVEL_RATIOS.length
          ? <>{t.ui.report.toLevel(levelGenitive(level), percent(FREEDOM_LEVEL_RATIOS[level]))}</>
          : <>{t.ui.report.highest} <b>{lowerFirst(levelTitle(level))}</b></>}
      </div>
      {!world.archipelago && !compact && <p className="arch-promise">{t.arch.promise(pct)}</p>}
      {!me.employed && me.threatWeeks > 0 && (
        <div className="warning freedom-warn">
          <span className="long">
            {t.ui.report.threat(weeksToReturn)}
          </span>
          <span className="short">{t.ui.report.threatShort(weeksToReturn)}</span>
        </div>
      )}
      {!me.employed && me.threatWeeks === 0 && shortfall && (
        <div className="freedom-note warn">
          {t.ui.report.shortfall(weeks(THREAT_WEEKS))}
        </div>
      )}
      {me.employed && shortfall && (
        <div className="freedom-note">
          {t.ui.report.employedShortfall}
        </div>
      )}
      {/* Вызов — только после свободы: понятный результат «свобода за N недель» и полный путь призрака */}
      {!compact && <ShareButton challenge className="btn ghost challenge-button" />}
    </div>
  );
}

function Row({ label, value, tone, strong, muted }: {
  label: string; value: number; tone?: 'pos' | 'neg'; strong?: boolean; muted?: boolean;
}) {
  const { fmt, signed } = useI18n();
  return (
    <div className={`row ${strong ? 'strong' : ''} ${muted ? 'muted-row' : ''}`}>
      <span>{label}</span>
      <b className={muted ? undefined : tone}>{muted ? fmt(value) : tone === 'neg' && value >= 0 ? `−${fmt(value)}` : signed(value)}</b>
    </div>
  );
}

/** Финансовый отчёт недели — главный обучающий инструмент, всегда на виду. */
export function Statement() {
  const { t, fmt } = useI18n();
  const world = useGame((s) => s.world)!;
  const me = getPlayer(world, HUMAN);
  const fin = financeView(world, HUMAN);
  const assets = assetViews(world, HUMAN);
  const assetsValue = assets.reduce((s, a) => s + a.saleValue, 0);
  const incomeCount = assets.filter((a) => a.currentIncome > 0).length;

  return (
    <div className="statement">
      <div className="st-group">
        <div className="st-title">{t.ui.report.incomeWeek}</div>
        {me.employed
          ? <Row label={`${me.extraShift && me.layoffWeeks === 0 ? t.ui.report.salaryShift : t.ui.report.salary} · ${lowerFirst(t.professions[me.profession ?? 'teacher'].title)}`} value={fin.salary} tone="pos" />
          : <Row label={t.ui.report.noJob} value={0} muted />}
        {me.layoffWeeks > 0 && <div className="st-note neg">{t.ui.report.layoff(weeksAcc(me.layoffWeeks))}</div>}
        <Row label={`${t.ui.report.assets}${incomeCount ? ` (${incomeCount})` : ''}`} value={fin.passiveIncome} tone="pos" />
        {world.archipelago && <div className="arch-finance-detail"><Row label={`${t.arch.report.included}: ${t.arch.report.title}`} value={fin.arch.income} tone="pos" /></div>}
      </div>
      <div className="st-group">
        <div className="st-title">{t.ui.report.expensesWeek}</div>
        <Row label={t.ui.report.living} value={fin.expenses.living} tone="neg" />
        {fin.expenses.upkeep > 0 && <Row label={t.ui.report.upkeep} value={fin.expenses.upkeep} tone="neg" />}
        {world.archipelago && <div className="arch-finance-detail"><Row label={`${t.arch.report.included}: ${t.arch.report.title}`} value={fin.arch.expenses} tone="neg" /></div>}
        {fin.expenses.interest > 0 && <Row label={t.ui.report.interest} value={fin.expenses.interest} tone="neg" />}
        {fin.expenses.insurance > 0 && <Row label={t.ui.report.insurance} value={fin.expenses.insurance} tone="neg" />}
      </div>
      <Row label={t.ui.report.net} value={fin.net} tone={fin.net >= 0 ? 'pos' : 'neg'} strong />
      {fin.net < 0 && <div className="st-note neg">{t.ui.report.negative}</div>}
      {me.employed && !(me.layoffWeeks > 0) && me.happiness < 30 && <div className="st-note neg">{t.ui.report.burnout}</div>}
      {world.lastReport?.players[HUMAN]?.arch && <section className="arch-actual"><div className="st-title">{t.ui.weekModal.kicker(world.lastReport.week)}</div><ArchReport lines={world.lastReport.players[HUMAN].arch} /></section>}

      <div className="capital">
        <div><span>{t.ui.cash}</span><b>{fmt(me.cash)}</b></div>
        <div><span>{t.ui.report.property}</span><b>{fmt(assetsValue)}</b></div>
        <div><span>{t.ui.report.debt}</span><b className={fin.debt > 0 ? 'neg' : ''}>{fin.debt > 0 ? `−${fmt(fin.debt)}` : '0'}</b></div>
        <div className="total"><span>{t.ui.report.netWorth}</span><b>{fmt(fin.netWorth)}</b></div>
      </div>

      <div className="traits">
        <div>
          <span>{t.ui.happiness}</span>
          <Meter value={me.happiness} />
        </div>
        <div>
          <span>{t.ui.knowledge}</span>
          <Pips value={me.knowledge} max={3} />
        </div>
      </div>
    </div>
  );
}
