import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { financeView, offerViews } from '@arch/engine';
import { HUMAN, useGame, type Tab } from '../store';
import { useI18n } from '../i18n';
import { DealsTab } from './DealsTab';
import { IslandTab } from './IslandTab';
import { ActionsTab } from './ActionsTab';
import { DreamBlock } from './DreamBlock';
import { GoalsBlock, MobileGoals } from './GoalsBlock';
import { FreedomBlock, Statement } from './ReportPanel';

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

function TabContent({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'deals': return <DealsTab />;
    case 'island': return <IslandTab />;
    case 'actions': return <ActionsTab />;
    case 'report': return <div className="tab-body"><FreedomBlock /><DreamBlock /><GoalsBlock /><Statement /></div>;
    case 'goals': return <div className="tab-body"><GoalsBlock /></div>;
  }
}

function Tabs({ tabs, extra }: { tabs: Tab[]; extra?: ReactNode }) {
  const { t } = useI18n();
  const world = useGame((s) => s.world)!;
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  const affordable = offerViews(world, HUMAN).filter((v) => v.canAfford && !v.locked && !v.slotFull).length;
  const tired = world.players[0].employed && world.players[0].happiness < 30;
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((tabName) => (
        <button key={tabName} role="tab" aria-selected={tab === tabName} className={`tab ${tab === tabName ? 'active' : ''}`} onClick={() => setTab(tabName)}>
          {tabName === 'goals' ? t.ui.goals.title : t.ui.tabs[tabName]}
          {tabName === 'deals' && affordable > 0 && <span className="badge-count">{affordable}</span>}
          {tabName === 'actions' && tired && <span className="badge-count alert" title={t.ui.restHint}>!</span>}
        </button>
      ))}
      {extra}
    </nav>
  );
}

export function NextWeekButton({ compact }: { compact?: boolean }) {
  const { t, signed } = useI18n();
  const world = useGame((s) => s.world)!;
  const endWeek = useGame((s) => s.endWeek);
  const busy = useGame((s) => s.busy);
  const fin = financeView(world, HUMAN);
  return (
    <button className={`btn next ${compact ? 'compact' : ''}`} onClick={endWeek} disabled={busy} data-coach="next-week">
      <span className="next-main">{t.ui.nextWeek} <span aria-hidden>→</span></span>
      {!compact && <span className="next-sub">{t.ui.nextCash(signed(fin.net))}</span>}
    </button>
  );
}

/** Компьютер: отчёт слева, вкладки справа (цели — своей вкладкой: в левой колонке им не хватает высоты), кнопка хода внизу по центру. */
export function DesktopLayout() {
  const tab = useGame((s) => s.tab);
  const current = tab === 'report' ? 'deals' : tab;
  return (
    <>
      <aside className="col-left">
        <div className="panel pad"><FreedomBlock /></div>
        <DreamBlock panel />
        <div className="panel pad scroll"><Statement /></div>
      </aside>
      <aside className="col-right panel">
        <Tabs tabs={['deals', 'island', 'actions', 'goals']} />
        <div className="tab-scroll"><TabContent tab={current} /></div>
      </aside>
      <div className="col-center"><NextWeekButton /></div>
    </>
  );
}

/** Телефон: компактная полоса свободы и выдвижная шторка со вкладками. */
export function MobileLayout() {
  const { t } = useI18n();
  const tab = useGame((s) => s.tab);
  const open = useGame((s) => s.sheetOpen);
  const setOpen = useGame((s) => s.setSheetOpen);
  const free = useGame((s) => s.world!.players[0].freedomWeek !== null);
  const [seenGoals, setSeenGoals] = useState('');
  const [closedHeight, setClosedHeight] = useState<number>();
  const [dragHeight, setDragHeight] = useState<number>();
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const freedomRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const gesture = useRef<{ id: number; x: number; y: number; time: number; height: number; min: number; max: number; active: boolean } | null>(null);

  useLayoutEffect(() => {
    const sheet = sheetRef.current!, header = headerRef.current!, freedom = freedomRef.current!, cta = ctaRef.current!;
    const measure = () => {
      // Скрытая мини-шкала сохраняет размеры для закрытого положения.
      const border = sheet.offsetHeight - sheet.clientHeight;
      setClosedHeight(header.getBoundingClientRect().height + (open ? freedom.getBoundingClientRect().height : 0) + cta.getBoundingClientRect().height + border);
    };
    measure();
    const observer = new ResizeObserver(measure);
    [header, freedom, cta].forEach((element) => observer.observe(element));
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [open]);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || closedHeight === undefined) return;
    suppressClick.current = false;
    const sheet = sheetRef.current!;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp,
      height: sheet.getBoundingClientRect().height, min: closedHeight,
      max: Math.min(innerHeight * 0.58, parseFloat(getComputedStyle(sheet).maxHeight)), active: false };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active) {
      // Горизонтальный жест и простое касание не переключают шторку.
      if (Math.abs(dx) > 6 && Math.abs(dx) >= Math.abs(dy)) { gesture.current = null; return; }
      if (Math.abs(dy) <= 6 || Math.abs(dy) <= Math.abs(dx)) return;
      drag.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    setDragHeight(Math.max(Math.min(drag.min, drag.max), Math.min(drag.max, drag.height - dy)));
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    gesture.current = null;
    if (drag.active) {
      suppressClick.current = true;
      const dy = event.clientY - drag.y;
      const fast = Math.abs(dy) >= 10 && Math.abs(dy) / Math.max(1, event.timeStamp - drag.time) >= 0.5;
      if (!cancelled && (Math.abs(dy) >= 40 || fast)) setOpen(dy < 0);
    }
    setDragHeight(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div ref={sheetRef} className={`sheet panel ${open ? 'open' : ''} ${dragHeight !== undefined ? 'dragging' : ''}`} style={{ height: dragHeight ?? (open ? undefined : closedHeight) }}>
      <div ref={headerRef} className="sheet-header" onPointerDown={start} onPointerMove={move}
        // lostpointercapture всплывает от ручки, когда касание переходит к шапке, — это не отмена жеста.
        onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => { if (event.target === event.currentTarget) finish(event, true); }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
        }}>
        <button className="sheet-handle" onClick={() => setOpen(!open)} aria-label={open ? t.ui.collapse : t.ui.expand}>
          <span />
        </button>
        <div ref={freedomRef} className="sheet-freedom" aria-hidden={open}><FreedomBlock compact /></div>
        <Tabs tabs={['report', 'deals', 'island', 'actions']} />
      </div>
      {open && <div className="tab-scroll">{tab === 'report' ? (
        <div className="tab-body">
          <FreedomBlock />
          {free && <DreamBlock />}
          <MobileGoals seen={seenGoals} onSeen={setSeenGoals} />
          <Statement />
          {!free && <DreamBlock />}
        </div>
      ) : <TabContent tab={tab} />}</div>}
      <div ref={ctaRef} className="sheet-cta"><NextWeekButton compact /></div>
    </div>
  );
}
