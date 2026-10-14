import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ASSET_DEFS, financeView, migrateWorld, offerViews, type WorldState } from '@arch/engine';
import { PerspectiveCamera, Vector3 } from 'three';
import { asset } from '../asset';
import { audio } from '../audio/engine';
import type { CueId } from '../audio/cues';
import { getI18n, useLanguage } from '../i18n';
import { IslandScene } from '../scene/IslandScene';
import type { DreamProgress, FloatLabel, PlacedItem } from '../scene/contract';
import { slotPlace } from '../scene/slots';
import fixturesData from './fixtures.json';
import { BEAT, EDIT, SHOTS, cameraAt, type ShotId, type TrailerFormat, type TrailerLang } from './shots';
import './director.css';

const App = lazy(() => import('../App'));
type CueEntry =
  | { t: number; cue: CueId; pitchStep?: number; variant?: number }
  | { t: number; weather: 'clear' | 'storm' };
type CaptionFrame = { visible: boolean; top: number | null; height: number | null; modalOverlap: boolean };
type SubjectPoint = { name: string; x: number; y: number };
type Save = { world: WorldState; news: unknown[]; history: Record<string, unknown[]> };
type Fixtures = {
  seed: number;
  F: number;
  S: number;
  N: number;
  heroItemsByWeek: PlacedItem[][];
  scamCard: Save;
  neighbors: Save;
  freedom: Save;
};
const fixtures = fixturesData as unknown as Fixtures;
// Кадры сохранены в v4; до любых расчётов переводим их в текущий контракт.
for (const key of ['scamCard', 'neighbors', 'freedom'] as const) {
  const world = migrateWorld(fixtures[key].world);
  if (!world) throw new Error(`Invalid director fixture: ${key}`);
  fixtures[key] = { ...fixtures[key], world };
}
const DIRECTOR_EDIT = { ...EDIT, shotSpecs: SHOTS };
const pearlOffer = (() => {
  const offer = offerViews(fixtures.scamCard.world, 'p1').find((view) => view.def.id === 'pearlFarm');
  if (!offer) throw new Error('scamCard fixture must contain a pearlFarm offer');
  return offer;
})();
const pearlFarm: PlacedItem = {
  uid: 'director-pearl',
  model: 'pearlFarm',
  slot: 'sea',
  slotIndex: 0,
  damaged: false,
  level: 1,
};

const hookChanges = (() => {
  const changes: PlacedItem[][] = [];
  let working = structuredClone(fixtures.heroItemsByWeek[0] ?? []) as PlacedItem[];
  for (let week = 1; week <= 100; week++) {
    const target = fixtures.heroItemsByWeek[week] ?? [];
    const targetIds = new Set(target.map((item) => item.uid));
    // Исчезновения идут в прежнем порядке данных, затем появления/уровни — в новом.
    for (const old of [...working]) {
      if (targetIds.has(old.uid)) continue;
      working = working.filter((item) => item.uid !== old.uid);
      changes.push(structuredClone(working));
    }
    for (const item of target) {
      const index = working.findIndex((old) => old.uid === item.uid);
      if (index < 0) {
        working.push(structuredClone(item));
        changes.push(structuredClone(working));
      } else if (working[index].level !== item.level) {
        working[index] = { ...working[index], level: item.level };
        changes.push(structuredClone(working));
      }
    }
  }
  return changes;
})();

declare global {
  interface Window {
    __director: {
      ready: boolean;
      shotReady: boolean;
      start(): void;
      cueLog: CueEntry[];
      captionLog: CaptionFrame[];
      captureCaption(): CaptionFrame;
      subjects(): SubjectPoint[];
      sceneItems(): PlacedItem[];
      edit: typeof DIRECTOR_EDIT;
      errors: string[];
      frameOffset: number;
      renderCue?: (cue: CueId, pitchStep?: number, variant?: number) => Promise<number[][]>;
    };
  }
}

const director: Window['__director'] = (window.__director = {
  ready: false,
  shotReady: false,
  start() {},
  cueLog: [],
  captionLog: [],
  captureCaption() {
    const caption = document.querySelector<HTMLElement>('.director-caption:not([data-director-measure])');
    const modal = document.querySelector<HTMLElement>('.modal');
    const rect = caption?.getBoundingClientRect();
    const measuredRect = document
      .querySelector<HTMLElement>('.director-root[data-shot="scam-collapse"] .director-caption[data-director-measure]')
      ?.getBoundingClientRect();
    const modalRect = modal?.getBoundingClientRect();
    const modalOverlap = !!(
      rect &&
      modalRect &&
      rect.right > modalRect.left &&
      rect.left < modalRect.right &&
      rect.bottom > modalRect.top &&
      rect.top < modalRect.bottom
    );
    const frame = { visible: !!rect, top: rect?.top ?? null, height: measuredRect?.height ?? rect?.height ?? null, modalOverlap };
    director.captionLog.push(frame);
    return frame;
  },
  subjects() {
    return [];
  },
  sceneItems() {
    return [];
  },
  edit: DIRECTOR_EDIT,
  errors: [],
  frameOffset: 0,
});
let directorSeconds = 0;
let started = false;
let startAt = 0;
const startHandlers = new Set<() => void>();
const directorNow = () => (started ? (performance.now() - startAt) / 1000 : directorSeconds);
audio.getScene = (() => null) as typeof audio.getScene;
audio.subscribeScene = (() => () => {}) as typeof audio.subscribeScene;
audio.unlock = (() => {}) as typeof audio.unlock;
audio.audition = (async () => false) as typeof audio.audition;
audio.play = ((cue: CueId, options: { delayMs?: number; pitchStep?: number; variant?: number } = {}) => {
  director.cueLog.push({
    t: directorNow() + (options.delayMs ?? 0) / 1000,
    cue,
    ...(options.pitchStep === undefined ? {} : { pitchStep: options.pitchStep }),
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  });
  return true;
}) as typeof audio.play;
audio.setWeather = ((weather: 'clear' | 'storm') => {
  director.cueLog.push({ t: directorNow(), weather });
}) as typeof audio.setWeather;
audio.setScene = (() => {}) as typeof audio.setScene;
audio.setAmbience = (() => {}) as typeof audio.setAmbience;
audio.duck = (() => {}) as typeof audio.duck;
audio.stop = (() => {}) as typeof audio.stop;
audio.unlock = (() => {}) as typeof audio.unlock;
audio.snapshot = (() => ({
  contextState: 'locked',
  scene: null,
  weather: 'clear',
  ambience: false,
  voices: [],
  pending: 0,
  master: 0,
  buses: null,
})) as typeof audio.snapshot;

window.addEventListener('error', (e) => director.errors.push(String(e.error?.message ?? e.message)));
window.addEventListener('unhandledrejection', (e) => director.errors.push(String(e.reason?.message ?? e.reason)));

function setFixture(save: Save, lang: TrailerLang) {
  const copy = structuredClone(save) as Save;
  copy.world.players[0].name = lang === 'ru' ? 'Вы' : 'You';
  copy.world.players[0].islandName = lang === 'ru' ? 'Лагуна' : 'Lagoon';
  localStorage.setItem('archipelago.director.save', JSON.stringify(copy));
  localStorage.setItem('archipelago.coach.v1', 'done');
  localStorage.setItem('archipelago.lang.v1', lang);
  useLanguage.getState().setLang(lang);
}

function captionHtml(text: string) {
  return {
    __html: text.replace(
      /\*\*(.+?)\*\*/g,
      (_, word) => `<span class="${/Пассив|Liabil/.test(word) ? 'liability' : 'asset'}">${word}</span>`,
    ),
  };
}

const projectionCamera = new PerspectiveCamera(30, 1, 0.5, 1200);
const projectionTarget = new Vector3();
const projectionPoint = new Vector3();
const DEG = Math.PI / 180;
function projectSubject(point: [number, number, number], pose: ReturnType<typeof cameraAt>) {
  const az = pose.az * DEG,
    el = pose.el * DEG,
    cosEl = Math.cos(el);
  projectionTarget.set(...pose.target);
  projectionCamera.aspect = innerWidth / Math.max(1, innerHeight);
  projectionCamera.position.set(
    pose.target[0] + pose.d * cosEl * Math.sin(az),
    pose.target[1] + pose.d * Math.sin(el),
    pose.target[2] + pose.d * cosEl * Math.cos(az),
  );
  projectionCamera.lookAt(projectionTarget);
  projectionCamera.updateProjectionMatrix();
  projectionCamera.updateMatrixWorld();
  projectionPoint.set(...point).project(projectionCamera);
  return { x: ((projectionPoint.x + 1) * innerWidth) / 2, y: ((1 - projectionPoint.y) * innerHeight) / 2 };
}

function subjectWorldPoints(id: ShotId): { name: string; point: [number, number, number] }[] {
  if (id === 'hook' || id === 'storm' || id === 'end') return [{ name: 'island', point: [0, 1.4, 0] }];
  if (id === 'asset' || id === 'upgrade') {
    const boat = slotPlace('pier', 0)!;
    return [{ name: 'boat', point: [boat.x, boat.y, boat.z] }];
  }
  if (id === 'liability') {
    const statue = slotPlace('plaza', 0)!;
    const yacht = slotPlace('sea', 0)!;
    return [
      { name: 'statue', point: [statue.x, statue.y, statue.z] },
      { name: 'yacht', point: [yacht.x, yacht.y, yacht.z] },
    ];
  }
  if (id === 'scam-pays' || id === 'scam-collapse') {
    const farm = slotPlace('sea', 0)!;
    return [{ name: 'pearlFarm', point: [farm.x, farm.y + 1.1, farm.z] }];
  }
  if (id === 'dream')
    return [
      { name: 'slipway', point: [16, 0.6, -6] },
      { name: 'schooner', point: [20.8, 0, -4.4] },
    ];
  return [];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
function cubicBezierEase(t: number) {
  const x1 = 0.2,
    y1 = 0.9,
    x2 = 0.3,
    y2 = 1.2;
  const sample = (u: number, a: number, b: number) =>
    3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (sample(mid, x1, x2) < t) lo = mid;
    else hi = mid;
  }
  return sample((lo + hi) / 2, y1, y2);
}

function captionStyle(
  id: ShotId,
  format: TrailerFormat,
  kind: 'scene' | 'game',
  sec: number,
  startSec: number,
  endSec: number,
): CSSProperties | null {
  if (sec < startSec || sec > endSec + (id === 'scam-collapse' ? 1 / 30 : 0)) return null;
  if (id === 'freedom' && document.querySelector('.modal')) return null;
  const enter = cubicBezierEase(clamp01((sec - startSec) / 0.28));
  const leave = id === 'scam-collapse' ? 1 : clamp01((endSec - sec) / 0.18);
  const opacity = Math.min(1, Math.max(0, Math.min(enter, leave)));
  const progress = Math.min(1, Math.max(0, enter));
  const style: CSSProperties = {
    opacity,
    transform: `translateX(-50%) translateY(${12 * (1 - progress)}px) scale(${0.96 + 0.04 * progress})`,
  };
  const headerBottom = document.querySelector('.top')?.getBoundingClientRect().bottom ?? 0;
  const defaultTop = format === 'v' ? (kind === 'scene' ? innerHeight * 0.13 : headerBottom + 14) : null;
  if (defaultTop !== null) style.top = defaultTop;
  else style.bottom = '9%';
  const modal = document.querySelector('.modal')?.getBoundingClientRect();
  const measure = document
    .querySelector<HTMLElement>('.director-caption[data-director-measure]')
    ?.getBoundingClientRect();
  if (modal && measure && measure.width > 0 && measure.height > 0) {
    const top = defaultTop ?? innerHeight * 0.91 - measure.height;
    const left = (innerWidth - measure.width) / 2;
    const right = left + measure.width;
    const bottom = top + measure.height;
    const overlap = right > modal.left && left < modal.right && bottom > modal.top && top < modal.bottom;
    if (overlap) {
      const minTop = format === 'v' ? headerBottom + 14 : 16;
      const maxBottom = format === 'v' ? innerHeight * 0.8 : innerHeight - 16;
      const aboveSpace = modal.top - 16 - minTop;
      const belowSpace = maxBottom - (modal.bottom + 16);
      if (Math.max(aboveSpace, belowSpace) < measure.height) return null;
      delete style.bottom;
      style.top = aboveSpace >= belowSpace ? modal.top - 16 - measure.height : modal.bottom + 16;
    }
  }
  return style;
}

function useClock() {
  const [, bump] = useState(0);
  useEffect(() => {
    let id = 0;
    const tick = (now: number) => {
      if (started) directorSeconds = (now - startAt) / 1000;
      bump((v) => v + 1);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  return directorSeconds;
}

function useDirectorStart(handler: () => void, deps: readonly unknown[]) {
  useEffect(() => {
    startHandlers.add(handler);
    return () => {
      startHandlers.delete(handler);
    };
    // The caller provides the values that define the scheduled shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function hookTimeline(durationBeats: number) {
  const last = Math.max(1, hookChanges.length - 1);
  return hookChanges.map((items, index) => ({
    items,
    beat: 0.5 + (durationBeats - 1) * (index / last),
  }));
}

function sceneState(id: ShotId, beats: number, durationBeats: number) {
  const boat: PlacedItem = {
    uid: 'director-boat',
    model: 'boat',
    slot: 'pier',
    slotIndex: 0,
    damaged: false,
    level: 1,
  };
  let items: PlacedItem[] = [];
  let floats: FloatLabel[] = [];
  let weather: 'clear' | 'storm' = 'clear';
  let dream: DreamProgress | null = null;
  if (id === 'hook') {
    const timeline = hookTimeline(durationBeats);
    const current = [...timeline].reverse().find((entry) => beats >= entry.beat);
    items = current?.items ?? fixtures.heroItemsByWeek[0] ?? [];
  }
  if (id === 'asset') {
    if (beats >= 0.5) items = [boat];
    if (beats >= 1.25 && beats < 2.8)
      floats = [{ id: 'a1', anchor: boat.uid, text: `+20 ${getI18n().t.ui.store.perWeek}`, tone: 'pos' }];
    if (beats >= 3.5) floats = [{ id: 'a2', anchor: boat.uid, text: '+20', tone: 'pos' }];
  }
  if (id === 'upgrade') {
    items = [{ ...boat, level: beats >= 3.5 ? 3 : beats >= 1 ? 2 : 1 }];
    if (beats >= 1.8 && beats < 3.4)
      floats = [{ id: 'u1', anchor: boat.uid, text: `+12 ${getI18n().t.ui.store.perWeek}`, tone: 'pos' }];
    if (beats >= 4.3)
      floats = [{ id: 'u2', anchor: boat.uid, text: `+8 ${getI18n().t.ui.store.perWeek}`, tone: 'pos' }];
  }
  if (id === 'liability') {
    items = [...(fixtures.heroItemsByWeek[12] ?? [])];
    if (beats >= 0.5)
      items.push({ uid: 'director-statue', model: 'statue', slot: 'plaza', slotIndex: 0, damaged: false, level: 1 });
    if (beats >= 2)
      items.push({ uid: 'director-yacht', model: 'yacht', slot: 'sea', slotIndex: 0, damaged: false, level: 1 });
    if (beats >= 1 && beats < 1.9)
      floats = [
        {
          id: 'l1',
          anchor: 'director-statue',
          text: `−${ASSET_DEFS.statue.upkeep} ${getI18n().t.ui.store.perWeek}`,
          tone: 'neg',
        },
      ];
    if (beats >= 2.5 && beats < 3.4)
      floats = [
        {
          id: 'l2',
          anchor: 'director-yacht',
          text: `−${ASSET_DEFS.yacht.upkeep} ${getI18n().t.ui.store.perWeek}`,
          tone: 'neg',
        },
      ];
    if (beats >= 3.75)
      floats = [
        { id: 'l3', anchor: 'director-statue', text: `−${ASSET_DEFS.statue.upkeep}`, tone: 'neg' },
        { id: 'l4', anchor: 'director-yacht', text: `−${ASSET_DEFS.yacht.upkeep}`, tone: 'neg' },
      ];
  }
  if (id === 'scam-pays' || id === 'scam-collapse') {
    items = [...(fixtures.heroItemsByWeek[fixtures.S] ?? []), ...(id === 'scam-collapse' && beats >= 0.5 ? [] : [pearlFarm])];
    if (id === 'scam-pays') {
      if (beats >= 0.5 && beats < 1.5)
        floats.push({ id: 'pearl-income-1', anchor: pearlFarm.uid, text: `+${pearlOffer.expectedIncome}`, tone: 'pos' });
      if (beats >= 2)
        floats.push({ id: 'pearl-income-2', anchor: pearlFarm.uid, text: `+${pearlOffer.expectedIncome}`, tone: 'pos' });
    } else if (beats >= 0.25) {
      floats = [{ id: 'pearl-loss', anchor: pearlFarm.uid, text: `−${pearlOffer.offer.price}`, tone: 'neg' }];
    }
  }
  if (id === 'storm') {
    items = (fixtures.heroItemsByWeek[fixtures.F] ?? []).map((x) => ({
      ...x,
      damaged: beats >= 0.5 && x.model === 'boat' ? true : x.damaged,
    }));
    weather = 'storm';
  }
  if (id === 'dream' || id === 'end') {
    items = fixtures.heroItemsByWeek[id === 'end' ? 100 : fixtures.F] ?? [];
    if (id === 'end' || beats >= 3.5) dream = { built: 3, building: false, stages: 3 };
    else if (beats >= 2) dream = { built: 2, building: true, stages: 3 };
    else if (beats >= 0.5) dream = { built: 1, building: true, stages: 3 };
    else dream = { built: 0, building: true, stages: 3 };
  }
  return { items, floats, weather, dream };
}

function SceneShot({ id, format, durationBeats }: { id: ShotId; format: TrailerFormat; durationBeats: number }) {
  const rawSec = useClock(),
    sec = rawSec - director.frameOffset,
    beats = sec / BEAT;
  const spec = SHOTS[id];
  const state = sceneState(id, beats, durationBeats);
  const progress = Math.min(1, Math.max(0, sec / (durationBeats * BEAT)));
  useDirectorStart(() => {
    const cue = (beat: number, name: CueId, pitchStep?: number) =>
      audio.play(name, { pitchStep, delayMs: (beat * BEAT + director.frameOffset) * 1000 });
    if (id === 'hook') {
      const halves = new Map<number, number>();
      for (const change of hookTimeline(durationBeats)) {
        const half = Math.max(0, Math.floor((change.beat - 0.5) * 2 + 1e-6));
        if (!halves.has(half)) halves.set(half, change.beat);
      }
      for (const [half, beat] of halves) cue(beat, 'build.pop', Math.min(7, half));
    }
    if (id === 'asset') {
      cue(0.5, 'coins.pay');
      cue(0.5 + 0.07 / BEAT, 'build.pop');
      cue(3, 'week.next');
      cue(3.5, 'coin.tick', 0);
    }
    if (id === 'upgrade') {
      cue(1, 'coins.pay');
      cue(1 + 0.2 / BEAT, 'upgrade');
      cue(3.5, 'coins.pay');
      cue(3.5 + 0.2 / BEAT, 'upgrade');
    }
    if (id === 'liability') {
      for (const b of [0.5, 2]) {
        cue(b, 'coins.pay');
        cue(b + 0.07 / BEAT, 'build.pop');
        cue(b + 0.16 / BEAT, 'status.joy');
      }
      cue(3.5, 'week.next');
      cue(3.75, 'coin.minus');
      cue(4, 'coin.minus');
    }
    if (id === 'scam-pays') {
      cue(0, 'week.next');
      cue(0.5, 'coin.tick', 0);
      cue(1.5, 'week.next');
      cue(2, 'coin.tick', 2);
    }
    if (id === 'scam-collapse') {
      cue(0.25, 'scam.collapse');
    }
    if (id === 'storm') {
      cue(0, 'storm');
      director.cueLog.push({ t: director.frameOffset, weather: 'storm' });
    }
    if (id === 'dream') {
      cue(0.5, 'dream.stage');
      cue(2, 'dream.stage');
      cue(3.5, 'dream.launch');
    }
  }, [id, durationBeats]);
  return (
    <div id="director-stage">
      <IslandScene {...state} cameraPose={() => cameraAt(spec, progress, format)} dpr={window.devicePixelRatio} />
      <SceneReady />
    </div>
  );
}

function EndCard({ lang, format, durationBeats }: { lang: TrailerLang; format: TrailerFormat; durationBeats: number }) {
  const rawSec = useClock();
  const sec = rawSec - director.frameOffset;
  const beats = sec / BEAT;
  useDirectorStart(() => {
    audio.play('freedom.level', { delayMs: (0.25 * BEAT + director.frameOffset) * 1000 });
  }, [durationBeats]);
  const cardStart = 0.25 * BEAT;
  const cardEase = cubicBezierEase(clamp01((sec - cardStart) / 0.4));
  const cardStyle: CSSProperties = {
    opacity: clamp01(cardEase),
    transform: `translate(-50%,-50%) translateY(${14 * (1 - cardEase)}px) scale(${0.98 + 0.02 * cardEase})`,
  };
  return (
    <>
      <SceneShot id="end" format={format} durationBeats={durationBeats} />
      <div className="director-dim" style={{ opacity: Math.min(1, beats / 0.5) }} />
      <div className="director-end-card" style={cardStyle}>
        <img src={asset('favicon.svg')} />
        <div className="director-end-title">{lang === 'ru' ? 'Архипелаг' : 'Archipelago'}</div>
        <div className="director-end-sub">
          {lang === 'ru' ? 'Уютная игра про деньги и свободу' : 'A cozy game about money and freedom'}
        </div>
        <div className="director-end-cta">
          {lang === 'ru' ? 'Играйте бесплатно в браузере' : 'Play free in your browser'}
        </div>
        <div className="director-end-url">imdmtrv.github.io/archipelago{lang === 'en' ? '/en' : ''}</div>
        <div className="director-end-bio">{lang === 'ru' ? 'Ссылка — в профиле' : 'Link in bio'}</div>
      </div>
    </>
  );
}

function GameShot({ id, lang, durationBeats }: { id: ShotId; lang: TrailerLang; durationBeats: number }) {
  const save =
    id === 'scam-card'
      ? fixtures.scamCard
      : id === 'neighbors'
          ? fixtures.neighbors
          : fixtures.freedom;
  useMemo(() => setFixture(save, lang), [save, lang]);
  const rawSec = useClock(),
    sec = rawSec - director.frameOffset;
  const storeRef = useRef<Awaited<typeof import('../store')>['useGame'] | null>(null);
  const timers = useRef<number[]>([]);
  const [storeReady, setStoreReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setStoreReady(false);
    void import('../store').then(({ useGame }) => {
      if (cancelled) return;
      storeRef.current = useGame;
      const s = useGame.getState();
      s.setTab('deals');
      s.setSheetOpen(id === 'scam-card');
      setStoreReady(true);
    });
    return () => {
      cancelled = true;
      storeRef.current = null;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [id]);
  useDirectorStart(() => {
    const useGame = storeRef.current;
    if (!useGame) {
      director.errors.push(`${id}: game store not ready at start`);
      return;
    }
    const schedule = (beat: number, run: () => void) => {
      const at = beat * BEAT + director.frameOffset;
      const timer = window.setTimeout(run, Math.max(0, at * 1000));
      timers.current.push(timer);
    };
    if (id === 'scam-card') {
      const clickBeat = durationBeats - 0.75,
        // The paying farm is shown by the next shot's independent fixture.
        // Commit the game purchase only after capture ends, keeping this offer readable through the cut.
        buyBeat = durationBeats + 1 / BEAT;
      schedule(clickBeat, () => audio.play('ui.click'));
      schedule(buyBeat, () => {
        const current = useGame.getState();
        const v = offerViews(current.world!, 'p1').find((x) => x.def.id === 'pearlFarm');
        if (v)
          current.act(
            { type: 'buyOffer', playerId: 'p1', offerUid: v.offer.uid },
            getI18n().t.ui.deals.bought(getI18n().t.assets.pearlFarm.title),
          );
      });
    }
    if (id === 'neighbors' || id === 'freedom')
      schedule(id === 'neighbors' ? 0.5 : 0.25, () => useGame.getState().endWeek());
    if (id === 'neighbors')
      schedule(3, () => {
        const current = useGame.getState();
        const bots = current
          .world!.players.filter((p) => p.isBot)
          .sort(
            (a, b) => financeView(current.world!, b.id).freedomRatio - financeView(current.world!, a.id).freedomRatio,
          );
        current.showNeighbor(bots[0]?.id ?? null);
      });
  }, [id, durationBeats]);
  useEffect(() => {
    if (id !== 'scam-card') return;
    let cancelled = false,
      frame = 0;
    const center = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>('[data-offer="pearlFarm"]');
      const scroller = el?.closest<HTMLElement>('.tab-scroll');
      if (el && scroller) {
        const card = el.getBoundingClientRect(),
          list = scroller.getBoundingClientRect();
        const desiredTop = list.top + (list.height - card.height) / 2;
        const next = scroller.scrollTop + card.top - desiredTop;
        scroller.scrollTop = Math.max(0, Math.min(next, scroller.scrollHeight - scroller.clientHeight));
      }
      frame = requestAnimationFrame(center);
    };
    frame = requestAnimationFrame(center);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [id]);
  useEffect(() => {
    if (id !== 'freedom') return;
    let frame = 0;
    const keepFreedomHeadingVisible = () => {
      const modal = document.querySelector<HTMLElement>('.freedom-modal');
      if (modal && modal.scrollTop !== 0) modal.scrollTop = 0;
      frame = requestAnimationFrame(keepFreedomHeadingVisible);
    };
    frame = requestAnimationFrame(keepFreedomHeadingVisible);
    return () => cancelAnimationFrame(frame);
  }, [id]);
  const [origin, setOrigin] = useState('center');
  // Keep measuring while the initial card scroll settles, then lock the title center for the zoom.
  useLayoutEffect(() => {
    if (id !== 'scam-card' || started) return;
    const stage = document.getElementById('director-stage');
    const title = document.querySelector<HTMLElement>('[data-offer="pearlFarm"] h3');
    if (!stage || !title) return;
    const stageRect = stage.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const nextOrigin = `${titleRect.left + titleRect.width / 2 - stageRect.left}px ${titleRect.top + titleRect.height / 2 - stageRect.top}px`;
    if (nextOrigin !== origin) setOrigin(nextOrigin);
  });
  // Video frames sample 1/fps through N/fps, so the final captured frame must reach 1.15.
  const zoom = id === 'scam-card' ? 1 + 0.15 * clamp01(sec / (durationBeats * BEAT - 1 / 30)) : 1;
  return (
    <div id="director-stage" style={{ transform: `scale(${zoom})`, transformOrigin: origin }}>
      <Suspense fallback={null}>
        <App />
        {storeReady && <ShotReady />}
      </Suspense>
    </div>
  );
}

function ScamCardRing({ sec, durationBeats }: { sec: number; durationBeats: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const beats = sec / BEAT;
  const visible = beats >= 0.5 && beats < durationBeats - 0.75;
  useLayoutEffect(() => {
    const ring = ref.current;
    const heading = document.querySelector<HTMLElement>('[data-offer="pearlFarm"] h3');
    if (!ring || !heading) return;
    // Bounds are sampled after React applies the current frame's #director-stage transform.
    const rect = heading.getBoundingClientRect();
    ring.style.left = `${rect.left - 9}px`;
    ring.style.top = `${rect.top - 9}px`;
    ring.style.width = `${rect.width + 18}px`;
    ring.style.height = `${rect.height + 18}px`;
  }, [sec]);
  return (
    <div
      ref={ref}
      className="director-scam-ring"
      style={{ opacity: visible ? 0.8 + 0.2 * Math.cos((2 * Math.PI * (sec - 0.5 * BEAT)) / 1.6) : 0 }}
      aria-hidden="true"
    />
  );
}

function ShotReady() {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      director.shotReady = true;
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}

function SceneReady() {
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        director.shotReady = true;
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, []);
  return null;
}

function ClickIndicator({ durationBeats }: { durationBeats: number }) {
  const sec = useClock() - director.frameOffset,
    beats = sec / BEAT;
  if (beats < durationBeats - 0.75 || beats > durationBeats - 0.75 + 0.35 / BEAT) return null;
  const button = document.querySelector('[data-offer="pearlFarm"] .btn.primary')?.getBoundingClientRect();
  if (!button) return null;
  const p = (beats - (durationBeats - 0.75)) / (0.35 / BEAT);
  return (
    <div
      className="director-click"
      style={{
        left: button.left + button.width / 2,
        top: button.top + button.height / 2,
        transform: `scale(${1 + 1.4 * p})`,
        opacity: 0.9 * (1 - p),
      }}
    />
  );
}

function AudioPage() {
  useEffect(() => {
    director.ready = true;
    director.renderCue = async (cue, pitchStep = 0, variant = 0) => {
      const [{ CUES }, { DEFAULT_AUDIO_SOURCES }, { synthesize }] = await Promise.all([
        import('../audio/cues'),
        import('../audio/defaultSources'),
        import('../audio/synth'),
      ]);
      const def = CUES[cue];
      const pitch = 2 ** (pitchStep / 12);
      const useFile = DEFAULT_AUDIO_SOURCES[cue] === 'file' && !!def.files?.length;
      const seconds = useFile ? 5 : Math.max(def.synth.duration + 0.35, 0.5);
      const ctx = new OfflineAudioContext(2, Math.ceil(48000 * seconds), 48000);
      const gain = ctx.createGain();
      gain.gain.value = def.volume;
      gain.connect(ctx.destination);
      if (useFile) {
        const file = def.files![Math.abs(Math.floor(variant)) % def.files!.length];
        const response = await fetch(file);
        if (!response.ok) throw new Error(`director audio ${cue}: ${response.status}`);
        const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.playbackRate.value = pitch;
        source.connect(gain);
        source.start(0);
      } else {
        synthesize(ctx, gain, def.synth, pitch, variant);
      }
      const out = await ctx.startRendering();
      return [Array.from(out.getChannelData(0)), Array.from(out.getChannelData(1))];
    };
  }, []);
  return <div className="director-audio">director audio</div>;
}

export default function Director() {
  const params = new URLSearchParams(location.search);
  const editOnly = params.has('edit'),
    audioOnly = params.has('audio');
  const id = (params.get('shot') || 'hook') as ShotId;
  const format = (params.get('format') === 'h' ? 'h' : 'v') as TrailerFormat;
  const lang = (params.get('lang') === 'en' ? 'en' : 'ru') as TrailerLang;
  const entry = (format === 'v' ? EDIT.v30 : EDIT.h45).shots.find(([shot]) => shot === id);
  const durationBeats = entry ? entry[2] - entry[1] : 4;
  useMemo(() => {
    localStorage.setItem('archipelago.lang.v1', lang);
    useLanguage.getState().setLang(lang);
  }, [lang]);
  const sec = useClock() - director.frameOffset;
  useEffect(() => {
    director.ready = false;
    director.shotReady = false;
    director.errors.length = 0;
    director.cueLog.length = 0;
    director.captionLog.length = 0;
    started = false;
    directorSeconds = 0;
    director.frameOffset = 0;
    director.start = () => {
      started = true;
      startAt = performance.now();
      directorSeconds = 0;
      director.captionLog.length = 0;
      for (const handler of startHandlers) handler();
    };
    if (editOnly || audioOnly) {
      director.ready = true;
      return;
    }
    let cancelled = false;
    (async () => {
      await Promise.all([document.fonts.load('700 20px Unbounded'), document.fonts.load('800 16px Manrope')]);
      await document.fonts.ready;
      if (cancelled) return;
      if (!document.fonts.check('700 20px Unbounded')) director.errors.push('Unbounded 700 unavailable');
      if (!document.fonts.check('800 16px Manrope')) director.errors.push('Manrope 800 unavailable');
      for (let i = 0; i < 180 && !director.shotReady && !cancelled; i++)
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (!cancelled && !director.shotReady) director.errors.push(`${id}: first frame not ready`);
      if (!cancelled) director.ready = director.errors.length === 0;
    })();
    return () => {
      cancelled = true;
    };
  }, [id, editOnly, audioOnly]);
  if (editOnly) return <div className="director-audio">edit ready</div>;
  if (audioOnly) return <AudioPage />;
  const spec = SHOTS[id];
  const showCaption = spec.caption && id !== 'end';
  const captionStartSec =
    (id === 'asset' || id === 'liability' ? 0.5 : 0.25) * BEAT;
  const captionEndSec = (durationBeats - (id === 'scam-collapse' ? 0 : 0.25)) * BEAT;
  const capStyle = showCaption ? captionStyle(id, format, spec.kind, sec, captionStartSec, captionEndSec) : null;
  const scamCaption = (measure: boolean) => (
    <>
      <span style={{ opacity: measure ? 1 : clamp01(((durationBeats - 0.25) * BEAT - sec) / 0.18) }}>{spec.caption?.[lang]}</span>
      <span
        className="director-caption-second"
        style={{ opacity: measure ? 1 : cubicBezierEase(clamp01((sec - 1.5 * BEAT) / 0.28)) }}
      >
        {lang === 'ru' ? 'Это пирамида' : "It's a pyramid scheme"}
      </span>
    </>
  );
  director.subjects =
    spec.kind === 'scene'
      ? () => {
          const localSec = directorNow() - director.frameOffset;
          const progress = Math.min(1, Math.max(0, localSec / (durationBeats * BEAT)));
          const pose = cameraAt(spec, progress, format);
          return subjectWorldPoints(id).map(({ name, point }) => ({ name, ...projectSubject(point, pose) }));
        }
      : () => [];
  director.sceneItems = spec.kind === 'scene'
    ? () => sceneState(id, (directorNow() - director.frameOffset) / BEAT, durationBeats).items
    : () => [];
  return (
    <div className={`director-root ${format === 'v' ? 'vertical' : 'horizontal'} ${spec.kind}`} data-shot={id}>
      {id === 'end' ? (
        <EndCard lang={lang} format={format} durationBeats={durationBeats} />
      ) : spec.kind === 'scene' ? (
        <SceneShot id={id} format={format} durationBeats={durationBeats} />
      ) : (
        <GameShot id={id} lang={lang} durationBeats={durationBeats} />
      )}{' '}
      {showCaption && (
        <div
          className="director-caption"
          data-director-measure
          aria-hidden="true"
          style={{ visibility: 'hidden', top: 0, pointerEvents: 'none' }}
        >
          {id === 'scam-collapse' ? scamCaption(true) : <span dangerouslySetInnerHTML={captionHtml(spec.caption![lang])} />}
        </div>
      )}{' '}
      {capStyle && (
        <div className="director-caption" style={capStyle}>
          {id === 'scam-collapse' ? scamCaption(false) : <span dangerouslySetInnerHTML={captionHtml(spec.caption![lang])} />}
        </div>
      )}{' '}
      {id === 'scam-card' && <ScamCardRing sec={sec} durationBeats={durationBeats} />}
      {id === 'scam-card' && <ClickIndicator durationBeats={durationBeats} />}
    </div>
  );
}
