import { useLayoutEffect, useRef, useState } from 'react';
import { financeView, getPlayer } from '@arch/engine';
import { HUMAN, useGame } from '../store';
import { Coin, ConfirmButton, Meter } from './common';
import { NeighborsBar, type NeighborsSize } from './Neighbors';
import { useMediaQuery } from './Panels';
import { AudioControls } from '../audio/AudioControls';
import { displayPlayer, useI18n } from '../i18n';

/** Выбираем размер по свободному промежутку, независимо от аватаров в плашке. */
function useNeighborsLayout(desktop: boolean, islandName: string, week: number, selected: string | null) {
  const topRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState<NeighborsSize>('compact');
  useLayoutEffect(() => {
    const top = topRef.current;
    if (!desktop || !top) return;
    const badge = top.querySelector<HTMLElement>('.badge')!;
    const stats = top.querySelector<HTMLElement>('.stats')!;
    const mini = badge.querySelector<HTMLElement>('.nb-mini')!;
    const probes = [...top.querySelectorAll<HTMLElement>('[data-neighbors-probe]')];
    const hud = top.parentElement!;
    const leftColumn = hud.querySelector<HTMLElement>('.col-left');
    const rightColumn = hud.querySelector<HTMLElement>('.col-right');
    let frame = 0;
    const measure = () => {
      const topRect = top.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      const topGap = parseFloat(getComputedStyle(top).columnGap);
      const badgeGap = parseFloat(getComputedStyle(badge).columnGap);
      const miniWidth = mini.getBoundingClientRect().width;
      // В fallback плашка сжимается: возвращаем ширину обрезанного текста и убираем mini.
      const textOverflow = Math.max(0, ...[...badge.querySelectorAll<HTMLElement>('.title, .sub')]
        .map((text) => text.scrollWidth - text.clientWidth));
      const baseBadgeWidth = badgeRect.width - (miniWidth ? miniWidth + badgeGap : 0) + textOverflow;
      const available = topRect.width - stats.getBoundingClientRect().width - baseBadgeWidth - topGap * 2;
      const next = probes.find((probe) => probe.getBoundingClientRect().width <= available)?.dataset.neighborsProbe as NeighborsSize | undefined;
      setSize(next ?? 'badge');

      const left = Math.max(16, (leftColumn?.getBoundingClientRect().right ?? 4) + 12);
      const right = Math.min(window.innerWidth - 16, (rightColumn?.getBoundingClientRect().left ?? window.innerWidth - 4) - 12);
      const width = Math.max(0, Math.min(400, right - left));
      const anchor = (size === 'badge' ? mini : top.querySelector<HTMLElement>('.nb-bar')!)
        .getBoundingClientRect();
      const desiredLeft = width < 400 ? anchor.right - width : (anchor.left + anchor.right - width) / 2;
      const popupLeft = Math.max(left, Math.min(right - width, desiredLeft));
      const popupTop = topRect.height + 8;
      const tickerHeight = top.querySelector<HTMLElement>('.ticker')?.getBoundingClientRect().height ?? 0;
      top.style.setProperty('--nb-dropdown-left', `${popupLeft - topRect.left}px`);
      top.style.setProperty('--nb-dropdown-width', `${width}px`);
      top.style.setProperty('--nb-dropdown-top', `${popupTop}px`);
      top.style.setProperty('--nb-card-height', `${Math.max(0, window.innerHeight - topRect.top - popupTop - 16 - (tickerHeight ? tickerHeight + 6 : 0))}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    [top, badge, stats, ...probes, leftColumn, rightColumn].forEach((element) => {
      if (element) observer.observe(element);
    });
    window.addEventListener('resize', schedule);
    document.fonts.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [desktop, islandName, week, selected, size]);
  return { topRef, size };
}

export function Emblem() {
  return (
    <div className="emblem">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
        <circle cx="17" cy="9" r="4.5" fill="#F5B83D" />
        <path d="M3 17c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M3 21.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" stroke="#fff" strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function TopBar() {
  const { t, fmt, lang, setLang } = useI18n();
  const world = useGame((s) => s.world)!;
  const resetGame = useGame((s) => s.resetGame);
  const me = getPlayer(world, HUMAN);
  const shown = displayPlayer(me);
  const fin = financeView(world, HUMAN);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const selected = useGame((s) => s.neighborId);
  const { topRef, size } = useNeighborsLayout(desktop, shown.islandName, world.week, selected);

  return (
    <header className="top" ref={topRef} data-neighbors-size={desktop ? size : undefined}>
      <div className="panel badge">
        <Emblem />
        <div className="badge-text">
          <div className="title">{shown.islandName}</div>
          <div className="sub">{t.ui.week} {world.week}<span className="badge-detail">{me.freedomWeek ? ` · ${t.ui.neighbors.freedom} ${t.ui.epilogue.since(me.freedomWeek)}` : ''}{me.employed ? '' : ` · ${t.ui.neighbors.withoutWork.toLowerCase()}`}</span></div>
        </div>
        <NeighborsBar compact />
        {/* На телефоне верхняя строка заполнена до предела: там язык — в приветствии и в настройках звука */}
        {desktop && (
          <div className="language-switch" aria-label={t.ui.language}>
            <button type="button" className={lang === 'ru' ? 'active' : ''} onClick={() => setLang('ru')}>RU</button>
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
        )}
        <AudioControls />
        <ConfirmButton className="icon-btn" confirmText={t.ui.epilogue.resetConfirm} onConfirm={resetGame}>
          <span aria-label={t.ui.epilogue.newGame}>↺</span>
        </ConfirmButton>
      </div>

      {desktop && <div className="neighbors-slot"><NeighborsBar size={size} /></div>}

      <div className="stats">
        <div className="panel stat">
          <Coin />
          <div><div className="label">{t.ui.cash}</div><div className="value">{fmt(me.cash)}</div></div>
        </div>
        <div className="panel stat">
          <div>
            <div className="label"><span className="long">{t.ui.passiveIncome}</span><span className="short">{t.ui.income}</span></div>
            <div className="value pos">+{fmt(fin.passiveIncome)} <small>{t.ui.perWeek}</small></div>
          </div>
        </div>
        <div className="panel stat">
          <div><div className="label">{t.ui.expenses}</div><div className="value neg">−{fmt(fin.expenses.total)} <small>{t.ui.perWeek}</small></div></div>
        </div>
        <div className="panel stat happiness">
          <div>
            <div className="label">{t.ui.happiness}</div>
            <div className="value">{Math.round(me.happiness)}</div>
            <Meter value={me.happiness} />
          </div>
        </div>
      </div>
    </header>
  );
}
