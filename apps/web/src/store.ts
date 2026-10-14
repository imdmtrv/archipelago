import { create } from 'zustand';
import {
  applyAction, assetViews, choiceView, createWorld, financeView, getPlayer, migrateWorld, ASSET_DEFS, DREAMS, DREAM_UPKEEP_UID,
  type Action, type GameEvent, type ProfessionId, type WeekNewsItem, type WeekReport, type WorldState,
} from '@arch/engine';
import type { DreamProgress, FloatLabel, PlacedItem, Weather } from './scene/contract';
import { onAction, onWeek, onWeather, startGameSounds, stopGameSounds } from './audio/gameSounds';
import { errorText, getI18n } from './i18n';
import { validChallenge, validMoments, type ChallengeData, type Moment } from './challenge';
import type { SharePayload } from './share';

export const HUMAN = 'p1';
const SAVE_KEY = new URLSearchParams(location.search).has('director') ? 'archipelago.director.save' : 'archipelago.save.v1';

/** 'goals' — только на компьютере; на телефоне цели во вкладке «Отчёт». */
export type Tab = 'deals' | 'island' | 'actions' | 'report' | 'goals';

export interface Toast { id: number; text: string; tone: 'good' | 'bad' | 'neutral' }
/** `epilogue` — на этой неделе достроена мечта: вместо обычных итогов недели показываем эпилог. */
export interface WeekModal { report: WeekReport; events: GameEvent[]; freedom: boolean; epilogue: boolean }
/** playerId нет у новостей из сохранений до экрана соседей. */
export type NewsItem = ({ week: number; text: string; playerId?: string } | ({ week: number; playerId: string; kind: 'ghost'; name: string; moment: Moment }) | ({ week: number } & WeekNewsItem));
/** Доля свободы каждого игрока по неделям — для графиков на карточках соседей. */
export type FreedomHistory = Record<string, { week: number; ratio: number }[]>;

const HISTORY_LIMIT = 160;

interface Saved { world: WorldState; news: NewsItem[]; history: FreedomHistory; moments: Moment[]; challenge: ChallengeData | null; boughtDefIds: string[] }

/** Сохранение любой поддерживаемой версии мира → текущая версия. Непонятное сохранение игнорируем. */
function load(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { world?: unknown; news?: NewsItem[]; history?: FreedomHistory; moments?: unknown; challenge?: unknown; boughtDefIds?: unknown } | null;
    const world = migrateWorld(saved?.world);
    if (!world) return null;
    const history = saved?.history && typeof saved.history === 'object' ? saved.history : {};
    // Старые графики отмечали начало следующей недели; запись вызова — конец сыгранной.
    if (saved?.moments === undefined) for (const id of Object.keys(history)) {
      history[id] = history[id].map((p) => ({ ...p, week: p.week - 1 })).filter((p) => p.week > 0);
    }
    const moments = validMoments(saved?.moments, world.week) ? saved.moments : [];
    const boughtDefIds = Array.isArray(saved?.boughtDefIds) ? saved.boughtDefIds.filter((id): id is string => typeof id === 'string' && Object.hasOwn(ASSET_DEFS, id))
      : [...new Set([...moments.filter((m) => m.kind === 'bought').map((m) => m.defId!), ...getPlayer(world, HUMAN).owned.map((a) => a.defId)])];
    return { world, news: Array.isArray(saved?.news) ? saved.news : [], history, moments, boughtDefIds,
      challenge: validChallenge(saved?.challenge) && saved.challenge.seed === world.seed
        ? { ...saved.challenge, profession: saved.challenge.profession ?? 'teacher' } : null };
  } catch {
    return null;
  }
}

/** Добавить в историю точку текущей недели для всех игроков. */
function recordHistory(history: FreedomHistory, world: WorldState): FreedomHistory {
  const week = world.lastReport?.week ?? 0;
  if (week === 0) return history;
  const next: FreedomHistory = { ...history };
  for (const p of world.players) {
    const ratio = Math.round(financeView(world, p.id).freedomRatio * 1000) / 1000;
    const line = (next[p.id] ?? []).filter((pt) => pt.week < week);
    const points = [...line, { week, ratio }];
    next[p.id] = p.id === HUMAN ? points : points.slice(-HISTORY_LIMIT);
  }
  return next;
}

function save(data: Saved | null) {
  try {
    if (data) localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // приватный режим или запрет хранилища — игра работает без сохранения
  }
}

interface GameStore {
  world: WorldState | null;
  news: NewsItem[];
  history: FreedomHistory;
  moments: Moment[];
  /** Помним первую покупку даже после вытеснения её момента из короткой записи. */
  boughtDefIds: string[];
  challenge: ChallengeData | null;
  shareFallback: SharePayload | null;
  /** Чья карточка соседа открыта; null — ничья. */
  neighborId: string | null;
  floats: FloatLabel[];
  weather: Weather;
  toast: Toast | null;
  modal: WeekModal | null;
  choiceOpen: boolean;
  tab: Tab;
  sheetOpen: boolean;
  highlightUid: string | null;
  busy: boolean;

  newGame(islandName: string, playerName: string, seed?: number, challenge?: ChallengeData | null, profession?: ProfessionId): void;
  resetGame(): void;
  act(action: Exclude<Action, { type: 'endWeek' }>, success?: string): boolean;
  endWeek(): void;
  closeModal(): void;
  closeChoice(): void;
  setTab(tab: Tab): void;
  setSheetOpen(open: boolean): void;
  focusItem(uid: string): void;
  showNeighbor(playerId: string | null): void;
  showToast(text: string, tone?: Toast['tone']): void;
}

const saved = load();
if (saved) save(saved); // старое сохранение переписываем в текущей версии — ключ тот же
let toastSeq = 0;
let floatSeq = 0;

export const useGame = create<GameStore>((set, get) => {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let choicePromptSeq = 0;
  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  const pushFloats = (labels: Omit<FloatLabel, 'id'>[], stagger = 170, onFloat?: (label: FloatLabel) => void) => {
    labels.forEach((label, i) => {
      schedule(() => {
        const f: FloatLabel = { ...label, id: `f${++floatSeq}` };
        set((s) => ({ floats: [...s.floats, f] }));
        onFloat?.(f);
        schedule(() => set((s) => ({ floats: s.floats.filter((x) => x.id !== f.id) })), 2600);
      }, i * stagger);
    });
  };

  return {
    world: saved?.world ?? null,
    news: saved?.news ?? [],
    history: saved?.history ?? {},
    moments: saved?.moments ?? [],
    boughtDefIds: saved?.boughtDefIds ?? [],
    challenge: saved?.challenge ?? null,
    shareFallback: null,
    neighborId: null,
    floats: [],
    weather: 'clear',
    toast: null,
    modal: null,
    choiceOpen: false,
    tab: 'deals',
    sheetOpen: false,
    highlightUid: null,
    busy: false,

    newGame(islandName, playerName, seed, challenge = null, profession = 'teacher') {
      clearTimers();
      if (get().world) stopGameSounds();
      const world = createWorld({ seed: seed ?? Math.floor(Math.random() * 2 ** 31), playerName, islandName, profession: challenge?.profession ?? profession });
      const history = recordHistory({}, world);
      set({ world, news: [], history, moments: [], boughtDefIds: [], challenge, shareFallback: null, neighborId: null, modal: null, choiceOpen: false, tab: 'deals', sheetOpen: false, floats: [], weather: 'clear', busy: false, toast: null });
      save({ world, news: [], history, moments: [], boughtDefIds: [], challenge });
      startGameSounds(world);
    },

    resetGame() {
      clearTimers();
      stopGameSounds();
      save(null);
      set({ world: null, news: [], history: {}, moments: [], boughtDefIds: [], challenge: null, shareFallback: null, neighborId: null, modal: null, choiceOpen: false, floats: [], weather: 'clear', busy: false, toast: null });
    },

    act(action, success) {
      const { world } = get();
      if (!world) return false;
      const res = applyAction(world, action);
      if (res.error) {
        // Движок может снять устаревшую развилку даже при ошибке (актив уже продан).
        if (action.type === 'resolveChoice') {
          set({ world: res.world, choiceOpen: !!choiceView(res.world, HUMAN) });
          save({ world: res.world, news: get().news, history: get().history, moments: get().moments, boughtDefIds: get().boughtDefIds, challenge: get().challenge });
        }
        onAction(action, world, res.world, res.error);
        get().showToast(errorText(res.error), 'bad');
        return false;
      }
      const moments = [...get().moments];
      const boughtDefIds = [...get().boughtDefIds];
      if (action.playerId === HUMAN) {
        if (action.type === 'buyOffer') {
          const prior = new Set(getPlayer(world, HUMAN).owned.map((a) => a.uid));
          const bought = getPlayer(res.world, HUMAN).owned.find((a) => !prior.has(a.uid));
          if (bought && !boughtDefIds.includes(bought.defId)) {
            moments.push({ week: world.week, kind: 'bought', defId: bought.defId });
            boughtDefIds.push(bought.defId);
          }
        } else if (action.type === 'upgradeAsset') {
          const asset = getPlayer(res.world, HUMAN).owned.find((a) => a.uid === action.assetUid);
          if (asset) moments.push({ week: world.week, kind: 'upgraded', defId: asset.defId, level: asset.level });
        }
      }
      set({ world: res.world, moments: moments.slice(-20), boughtDefIds, ...(action.type === 'resolveChoice' ? { choiceOpen: false } : {}) });
      save({ world: res.world, news: get().news, history: get().history, moments: get().moments, boughtDefIds, challenge: get().challenge });
      onAction(action, world, res.world);

      // Улучшение — над объектом всплывает прибавка к доходу
      if (action.type === 'upgradeAsset') {
        const before = world.players[0].owned.find((a) => a.uid === action.assetUid);
        const after = assetViews(res.world, HUMAN).find((v) => v.asset.uid === action.assetUid);
        if (before && after) {
          const gain = after.asset.income - before.income;
          if (gain > 0) schedule(() => {
            const { fmt, t } = getI18n();
            pushFloats([{ anchor: action.assetUid, text: `+${fmt(gain)} ${t.ui.store.perWeek}`, tone: 'pos' }]);
          }, 500);
        }
      }

      // Покупка/продажа — сразу видно на острове
      if (action.type === 'buyOffer') {
        const before = new Set(world.players[0].owned.map((a) => a.uid));
        const bought = res.world.players[0].owned.find((a) => !before.has(a.uid));
        if (bought) {
          const def = ASSET_DEFS[bought.defId];
          const tone = def.kind === 'status' ? 'neg' : 'pos';
          schedule(() => {
            const { fmt, t } = getI18n();
            const text = def.kind === 'status' ? `−${fmt(bought.upkeep)} ${t.ui.store.perWeek}` : `+${fmt(bought.income)} ${t.ui.store.perWeek}`;
            pushFloats([{ anchor: bought.uid, text, tone }]);
          }, 450);
        }
      }
      if (success) get().showToast(success, 'good');
      return true;
    },

    endWeek() {
      const { world, busy, modal } = get();
      if (!world || busy || modal) return;
      if (choiceView(world, HUMAN)) {
        choicePromptSeq++;
        set({ choiceOpen: true, neighborId: null });
        get().showToast(getI18n().t.ui.choices.pending);
        return;
      }
      const res = applyAction(world, { type: 'endWeek' });
      if (res.error || !res.world.lastReport) {
        if (res.error) get().showToast(errorText(res.error), 'bad');
        return;
      }
      const report = res.world.lastReport;
      const sounds = onWeek(report, world, res.world);
      const mine = report.players[HUMAN];
      const moments = [...get().moments];
      for (const event of mine.events) {
        if (event.id === 'dreamDone') moments.push({ week: report.week, kind: 'dreamStage', level: getPlayer(res.world, HUMAN).dream!.built });
        if (event.id === 'freedom' || event.id === 'dreamDone') moments.push({ week: report.week, kind: event.id });
        if (event.id === 'freedomLevel') moments.push({ week: report.week, kind: 'freedomLevel', level: Number(event.params?.level) });
        if (event.id === 'dreamStage') moments.push({ week: report.week, kind: 'dreamStage', level: Number(event.params?.finishedStage) + 1 });
      }
      const challenge = get().challenge;
      const ghostNews: NewsItem[] = challenge ? challenge.moments.filter((m) => m.week === report.week)
        .map((moment) => ({ week: report.week, playerId: 'challenge-ghost', kind: 'ghost', name: challenge.name, moment })) : [];
      const news = [
        ...ghostNews,
        ...report.news.map((n) => ({ week: report.week, ...n })),
        ...get().news,
      ].slice(0, 80);
      const history = recordHistory(get().history, res.world);
      set({ world: res.world, news, history, moments: moments.slice(-20), busy: true });
      save({ world: res.world, news, history, moments: get().moments, boughtDefIds: get().boughtDefIds, challenge });

      // Деньги «текут» на острове: зарплата над домом, доход над каждым активом
      const owned = new Map(res.world.players[0].owned.map((a) => [a.uid, a]));
      const { fmt, signed, t } = getI18n();
      const labels: Omit<FloatLabel, 'id'>[] = [{ anchor: 'home', text: `+${fmt(mine.salary)}`, tone: 'pos' }];
      for (const a of mine.assetIncome) if (a.amount > 0) labels.push({ anchor: a.assetUid, text: `+${fmt(a.amount)}`, tone: 'pos' });
      for (const u of mine.upkeep) {
        // Готовая шхуна тоже стоит денег каждую неделю — красный минус над стапелем
        if (u.assetUid === DREAM_UPKEEP_UID && u.amount > 0) {
          labels.push({ anchor: 'dream', text: `−${fmt(u.amount)}`, tone: 'neg' });
          continue;
        }
        const asset = owned.get(u.assetUid);
        if (asset && u.amount > 0 && ASSET_DEFS[asset.defId].kind === 'status') labels.push({ anchor: u.assetUid, text: `−${fmt(u.amount)}`, tone: 'neg' });
      }
      pushFloats(labels, 170, sounds.onFloat);

      if (report.worldEvents.some((e) => e.id === 'storm')) {
        set({ weather: 'storm' });
        onWeather('storm');
        schedule(() => { set({ weather: 'clear' }); onWeather('clear'); }, 7000);
      }

      // Событие 'freedom' показываем отдельным праздничным заголовком, а не карточкой;
      // 'dreamDone' открывает эпилог вместо обычного окна недели
      const events = [...report.worldEvents, ...mine.events.filter((e) => e.id !== 'freedom')];
      const epilogue = mine.events.some((e) => e.id === 'dreamDone');
      schedule(() => {
        if (events.length > 0 || mine.freedomReached || epilogue) {
          set({ modal: { report, events, freedom: mine.freedomReached, epilogue }, busy: false });
          sounds.onModal();
        } else {
          set({ busy: false });
          sounds.onModal(false);
          get().showToast(t.ui.store.weekToast(report.week, signed(mine.net), fmt(mine.cashAfter)), mine.net >= 0 ? 'good' : 'bad');
          // Сначала игрок читает тост недели; затем — новое решение.
          const uid = choiceView(res.world, HUMAN)?.uid;
          const prompt = ++choicePromptSeq;
          if (uid) schedule(() => {
            const latest = get();
            if (prompt === choicePromptSeq && latest.world?.week === res.world.week && choiceView(latest.world, HUMAN)?.uid === uid && !latest.modal && !latest.busy) {
              set({ choiceOpen: true, neighborId: null });
            }
          }, 3200);
        }
      }, events.length > 0 || mine.freedomReached || epilogue || sounds.hasNotice ? 1100 : 500);
    },

    closeModal() {
      choicePromptSeq++;
      const { world } = get();
      const choiceOpen = !!world && !!choiceView(world, HUMAN);
      set({ modal: null, choiceOpen, ...(choiceOpen ? { neighborId: null } : {}) });
    },
    closeChoice() { choicePromptSeq++; set({ choiceOpen: false }); },
    setTab(tab) { set({ tab, sheetOpen: true }); },
    setSheetOpen(open) { set({ sheetOpen: open }); },

    focusItem(uid) {
      if (uid === 'dream') {
        // Мечта живёт в блоке «Мечта»: на телефоне — во вкладке «Отчёт», на компьютере он всегда на виду
        const mobile = window.matchMedia('(max-width: 1023px)').matches;
        set(mobile ? { tab: 'report', sheetOpen: true, highlightUid: uid } : { highlightUid: uid });
      } else {
        set({ tab: 'island', sheetOpen: true, highlightUid: uid });
      }
      schedule(() => { if (get().highlightUid === uid) set({ highlightUid: null }); }, 2200);
    },

    showNeighbor(playerId) {
      set((s) => ({ neighborId: playerId !== null && s.neighborId === playerId ? null : playerId }));
    },

    showToast(text, tone = 'neutral') {
      const id = ++toastSeq;
      set({ toast: { id, text, tone } });
      schedule(() => { if (get().toast?.id === id) set({ toast: null }); }, 3200);
    },
  };
});

if (saved) startGameSounds(saved.world);

/** Что стоит на острове у игрока — в формате сцены. */
export function placedItems(world: WorldState): PlacedItem[] {
  return world.players[0].owned.map((a) => {
    const def = ASSET_DEFS[a.defId];
    return { uid: a.uid, model: def.model, slot: def.slot, slotIndex: a.slotIndex, damaged: a.damaged, level: a.level ?? 1 };
  });
}

/** Мечта игрока в формате сцены; null — мечты нет. */
export function dreamProgress(world: WorldState): DreamProgress | null {
  const dream = getPlayer(world, HUMAN).dream;
  if (!dream) return null;
  return { built: dream.built, stages: DREAMS[dream.id].stages.length, building: dream.building };
}
