// Места на острове для каждого слота. Вместимость обязана совпадать с SLOT_CAPACITY
// из packages/engine/src/slots.ts: pier 4, plot 6, beach 3, plaza 2, sea 2 (finance — один банк).
import type { SlotType } from '@arch/engine';
import type { DreamProgress } from './contract';
import {
  BEACH_Y, FACE_CAMERA, GRASS_Y, PIER_A, PIER_LANDING, PIER_START, PLAZA_ANNEX_POS, PLAZA_POS,
  fromScreen, onBeach, type Reserve,
} from './layout';

export interface SlotPlace { x: number; y: number; z: number; rotY: number }

// Лодки у пирса: координаты в системе пирса (x — вдоль настила от берега, z — поперёк)
const pierPlace = (lx: number, lz: number, rot: number): SlotPlace => {
  const c = Math.cos(PIER_A), s = Math.sin(PIER_A);
  return { x: PIER_START.x + lx * c - lz * s, y: 0, z: PIER_START.z + lx * s + lz * c, rotY: -PIER_A + rot };
};

const plotPlace = (sx: number, d: number, rot: number): SlotPlace => {
  const p = fromScreen(sx, d);
  return { x: p.x, y: GRASS_Y, z: p.z, rotY: FACE_CAMERA + rot };
};

// На пляже фасад смотрит в море, немного довёрнут к камере
const beachPlace = (a: number, t: number, toCam = 0.4): SlotPlace => {
  const p = onBeach(a, t);
  const out = Math.PI / 2 - a;
  return { x: p.x, y: BEACH_Y, z: p.z, rotY: out + (FACE_CAMERA - out) * toCam };
};

const seaPlace = (a: number, r: number, rotY: number): SlotPlace => ({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, rotY });

export const SLOTS: Record<Exclude<SlotType, 'finance'>, SlotPlace[]> = {
  // по очереди с двух сторон пирса, сначала дальние. Шаг вдоль пирса рассчитан на два траулера (уровень 3, корпус 3.1)
  // подряд; ближние места — там, где под кормой уже вода (с правой стороны, −z, песчаное дно уходит дальше).
  pier: [pierPlace(7.75, 1.95, 0.05), pierPlace(8.05, -1.95, -0.06), pierPlace(4.2, 1.95, -0.05), pierPlace(4.7, -1.95, 0.07)],
  // участки на траве; первые — ближе к камере
  plot: [
    plotPlace(2.2, 8.0, -0.15),
    plotPlace(-5.2, 7.5, 0.25),
    plotPlace(6.2, 5.6, -0.3),
    plotPlace(7.0, -3.5, -0.2),
    plotPlace(-7.5, 2.0, 0.3),
    plotPlace(6.5, -8.0, -0.1),
  ],
  // два места на широком песке (справа и слева) и одно на узком у пирса — там фасадом строго к морю
  beach: [beachPlace(0.1, 0.45), beachPlace(2.25, 0.42), beachPlace(1.62, 0.55, 0.12)],
  plaza: [
    { x: PLAZA_POS.x, y: GRASS_Y + 0.14, z: PLAZA_POS.z, rotY: Math.atan2(PIER_LANDING.x - PLAZA_POS.x, PIER_LANDING.z - PLAZA_POS.z) },
    { x: PLAZA_ANNEX_POS.x, y: GRASS_Y + 0.1, z: PLAZA_ANNEX_POS.z, rotY: Math.atan2(PIER_LANDING.x - PLAZA_ANNEX_POS.x, PIER_LANDING.z - PLAZA_ANNEX_POS.z) },
  ],
  sea: [seaPlace(0.42, 20.5, 0.75), seaPlace(1.72, 20, 2.1)],
};

/** Банк — один на все финансовые вложения, у подножия холма рядом с домом. */
const bankP = fromScreen(-7, -5);
export const BANK_PLACE: SlotPlace = { x: bankP.x, y: GRASS_Y, z: bankP.z, rotY: FACE_CAMERA + 0.2 };

export function slotPlace(slot: SlotType, index: number): SlotPlace | null {
  if (slot === 'finance') return BANK_PLACE;
  return SLOTS[slot]?.[index] ?? null;
}

// ───── Мечта игрока: стапель на пляже справа от камеры по умолчанию ─────
// Между бунгало (пляж 0.1) и маяком: там песок свободен, а в море нет ни яхты (море 0.42), ни лодок пирса.
// Ось идёт по нормали к берегу в этой точке, т.е. почти поперёк взгляда камеры: стапель и шхуна видны сбоку.
const DREAM_START = onBeach(-0.36, 0);
/** Азимут оси стапеля (от берега к морю), рад. */
const DREAM_DIR = -0.35;
export const DREAM_PLACE = {
  x: DREAM_START.x,
  z: DREAM_START.z,
  /** высота песка в начале стапеля */
  y: BEACH_Y,
  /** rotation.y группы: локальная +x смотрит в море, +z — к камере вдоль берега */
  rotY: -DREAM_DIR,
  dir: DREAM_DIR,
};
/** Точка в системе стапеля (lx — вдоль оси в сторону моря, lz — поперёк) в мировых x/z. */
export const dreamPoint = (lx: number, lz: number): { x: number; z: number } => {
  const c = Math.cos(DREAM_DIR), s = Math.sin(DREAM_DIR);
  return { x: DREAM_PLACE.x + lx * c - lz * s, z: DREAM_PLACE.z + lx * s + lz * c };
};
/**
 * Где стоит достроенная шхуна (система стапеля): на воде у морского конца спуска, чуть сбоку к камере —
 * чтобы не лезть на сваи стапеля и вписаться в кадр. yaw — доворот носа относительно оси спуска.
 */
export const DREAM_SHIP_AT = { lx: 8.2, lz: 3.1, yaw: 0.12 };
/** Центр стапеля и стройплощадки (система стапеля): здесь их рисует Shipyard, сюда же поворачивается камера. */
export const DREAM_SLIP_AT = { lx: 4.2, lz: 0 };
export const DREAM_PROPS_AT = { lx: 1.5, lz: 2.9 };

/**
 * На что смотреть камере, когда мечта меняется: шхуна на воде, стапель с судном или (до первого этапа) стройплощадка.
 * null — рисовать пока нечего, поворачиваться не к чему.
 */
export function dreamFocusPoint({ built, stages, building }: DreamProgress): { x: number; z: number } | null {
  if (built >= Math.max(1, stages)) return dreamPoint(DREAM_SHIP_AT.lx, DREAM_SHIP_AT.lz);
  if (built >= 1) return dreamPoint(DREAM_SLIP_AT.lx, DREAM_SLIP_AT.lz);
  return building ? dreamPoint(DREAM_PROPS_AT.lx, DREAM_PROPS_AT.lz) : null;
}

/** Стапель (по оси до воды) и стройплощадка рядом — декор сюда не лезет. */
export const DREAM_RESERVES: Reserve[] = [
  ...[0.4, 2.3, 4.2].map((lx) => ({ ...dreamPoint(lx, 0), r: 2.2 })),
  { ...dreamPoint(1.5, 2.9), r: 1.9 },
];

/** Круги, свободные от декора (деревья, пальмы, камни, трава). */
export const SLOT_RESERVES: Reserve[] = [
  ...SLOTS.plot.map((p) => ({ x: p.x, z: p.z, r: 2.1, core: 1.8 })),
  ...SLOTS.beach.map((p) => ({ x: p.x, z: p.z, r: 2.5 })),
  { x: BANK_PLACE.x, z: BANK_PLACE.z, r: 2.3 },
  ...DREAM_RESERVES,
];
