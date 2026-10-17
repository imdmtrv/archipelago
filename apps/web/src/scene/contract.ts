// Контракт между UI и 3D-сценой. UI знает только эти типы и компонент <IslandScene />.
import type { BusinessId, IslandId, ModelId, SlotType } from '@arch/engine';

/** Объект, который стоит на острове (купленный актив или статусная вещь). */
export interface PlacedItem {
  uid: string;
  model: ModelId;
  slot: SlotType;
  slotIndex: number;
  damaged: boolean;
  /** Уровень улучшения: 1 — как купили, 2–3 — модель крупнее и богаче. Смена уровня — праздничная анимация. */
  level: number;
}

/** Всплывающая сумма над объектом. Живёт ~2 секунды с момента первого появления id. */
export interface FloatLabel {
  id: string;
  /** uid объекта из items, 'home' (дом игрока на холме) или 'dream' (стапель / шхуна). */
  anchor: string;
  text: string;
  tone: 'pos' | 'neg';
}

export type Weather = 'clear' | 'storm';

export interface CameraPose {
  target: [number, number, number];
  az: number;
  el: number;
  d: number;
}

/** Мечта игрока (шхуна) на стапеле у берега. */
export interface DreamProgress {
  /** Сколько этапов готово: 0 — пусто, stages — шхуна на воде. */
  built: number;
  stages: number;
  /** Текущий этап оплачен и строится — рядом со стапелем видна стройка. */
  building: boolean;
}

export interface IslandSceneProps {
  items: PlacedItem[];
  floats: FloatLabel[];
  weather: Weather;
  /** null или отсутствует — мечты на острове пока нет (ничего не рисуется). */
  dream?: DreamProgress | null;
  /**
   * Доля высоты экрана, закрытая интерфейсом снизу (0..0.6).
   * На вертикальных экранах сцена сдвигает остров вверх, чтобы он был виден.
   */
  bottomInset?: number;
  /**
   * Доли ширины экрана, закрытые боковыми панелями [слева, справа].
   * Сцена центрирует остров в свободной полосе и немного отдаляет его.
   */
  sideInsets?: [number, number];
  cameraPose?: () => CameraPose;
  dpr?: number;
  onItemClick?: (uid: string) => void;
  /** Режим «Архипелаг»; null/нет — архипелаг закрыт, сцена как раньше. */
  arch?: ArchSceneProps | null;
}

// ───────────── Архипелаг (docs/specs/archipelago-screen.md, «Режим «Архипелаг»») ─────────────

/** Иконки дел — на метках над островами, в карточках и на схеме без WebGL. */
export const ARCH_ICONS: Record<BusinessId, string> = {
  cannery: '🏭', hotel: '🏨', coldStore: '❄️', shipyard: '⚓', bank: '🏦',
};

/** Цвет крыши здания и метки: бумага / золото / бирюза / серый. Доля в партнёрстве — 'mine'. */
export type ArchOwnerTone = 'free' | 'mine' | 'neighbor' | 'mainland';

export interface ArchSceneIsland {
  island: IslandId;
  business: BusinessId;
  route: boolean;            // паром проведён: пунктирная дуга, лодочка, причал с паромом
  built: boolean;            // дело построено: здание; иначе — участок с колышками и табличкой
  tone: ArchOwnerTone;
  damaged: boolean;          // тёмная заплата и дымок, красная точка на метке
  label: string;             // готовый текст метки: «🏭 Пеликан · ваше»
  attention: boolean;        // есть что решить — метка заметнее
}

export interface ArchSceneProps {
  /** Режим включён: камера на общем виде (или у острова focus); выключен — обычный вид родного острова. */
  on: boolean;
  focus: IslandId | null;
  islands: ArchSceneIsland[];
  /** Нажатие на остров или его метку (UI вызывает setArchFocus и раскрывает карточку). */
  onIslandClick: (island: IslandId) => void;
}

/**
 * Флаг для приёмки: после окончания перелёта сцена пишет document.documentElement.dataset.archCamera =
 * 'home' | 'overview' | <IslandId>. Пока камера летит — 'flying'.
 */
export const ARCH_CAMERA_FLAG = 'archCamera';
