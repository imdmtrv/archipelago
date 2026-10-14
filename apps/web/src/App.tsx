import { useEffect, useMemo, useState } from 'react';
import { IslandScene } from './scene/IslandScene';
import { dreamProgress, placedItems, useGame } from './store';
import { TopBar } from './ui/TopBar';
import { DesktopLayout, MobileLayout, useMediaQuery } from './ui/Panels';
import { ToastView, WeekModal, WelcomeModal } from './ui/Modals';
import { ShareDialog } from './ui/ShareDialog';
import { NeighborModal } from './ui/Neighbors';
import { ChoiceModal } from './ui/ChoiceModal';
import { FeedbackPrompt } from './ui/FeedbackPrompt';
import { useUiSound } from './audio/useUiSound';
import { Coach } from './ui/GuidedCoach';
import { initAnalytics, track } from './analytics';
import { decodeChallenge } from './challenge';

initAnalytics();

const challengeUrl = new URL(location.href);
const code = challengeUrl.searchParams.get('c');
const incomingChallenge = code === null ? null : decodeChallenge(code);
if (code !== null) {
  track('challenge-open');
  challengeUrl.searchParams.delete('c');
  window.history.replaceState(window.history.state, '', challengeUrl.href);
}

/** Какую долю ширины экрана занимают боковые колонки интерфейса (только раскладка для компьютера). */
function useSideInsets(enabled: boolean): [number, number] {
  const measure = (): [number, number] => {
    if (!enabled) return [0, 0];
    const w = window.innerWidth;
    const l = document.querySelector('.col-left')?.getBoundingClientRect();
    const r = document.querySelector('.col-right')?.getBoundingClientRect();
    return [l ? +(l.right / w).toFixed(3) : 0, r ? +((w - r.left) / w).toFixed(3) : 0];
  };
  const [insets, setInsets] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const update = () => setInsets(measure());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [enabled]);
  return insets;
}

export default function App() {
  useUiSound();
  const world = useGame((s) => s.world);
  const [invite, setInvite] = useState(incomingChallenge);
  const floats = useGame((s) => s.floats);
  const weather = useGame((s) => s.weather);
  const sheetOpen = useGame((s) => s.sheetOpen);
  const focusItem = useGame((s) => s.focusItem);
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const items = useMemo(() => (world ? placedItems(world) : []), [world]);
  // Мечта — по примитивам, чтобы сцена не получала новый объект после каждого действия
  const dp = world ? dreamProgress(world) : null;
  const dreamBuilt = dp?.built, dreamStages = dp?.stages, dreamBuilding = dp?.building;
  const dream = useMemo(
    () => (dreamBuilt === undefined || dreamStages === undefined ? null : { built: dreamBuilt, stages: dreamStages, building: !!dreamBuilding }),
    [dreamBuilt, dreamStages, dreamBuilding],
  );
  const sideInsets = useSideInsets(!isMobile && !!world);

  return (
    <>
      <IslandScene
        items={items}
        dream={dream}
        floats={floats}
        weather={weather}
        bottomInset={isMobile ? (sheetOpen ? 0.58 : 0.26) : 0}
        sideInsets={sideInsets}
        onItemClick={focusItem}
      />
      {world && (
        <div className={`hud ${isMobile ? 'mobile' : 'desktop'}`}>
          <TopBar />
          {isMobile ? <MobileLayout /> : <DesktopLayout />}
        </div>
      )}
      {(!world || invite) && <WelcomeModal challenge={invite} onDismiss={() => setInvite(null)} />}
      {world && isMobile && <NeighborModal />}
      <WeekModal />
      <ChoiceModal />
      {world && <FeedbackPrompt />}
      <ToastView />
      <ShareDialog />
      {!invite && <Coach />}
    </>
  );
}
