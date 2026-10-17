// Общая география для островов, паромов, меток и камеры. Это координаты сцены, не правила игры.
import type { IslandId } from '@arch/engine';
import type { ArchOwnerTone } from './contract';
import { PAL } from './palette';

export const ARCH_ISLAND_ORDER: IslandId[] = ['pelican', 'shell', 'lighthouse', 'cedar', 'big'];
export const ARCH_ISLAND_SCALE = 0.85;
export const ARCH_ROOFS: Record<ArchOwnerTone, number> = {
  free: PAL.marble, mine: PAL.roofGold, neighbor: PAL.roofTeal, mainland: PAL.rock,
};

export function archIslandPosition(island: IslandId): [number, number, number] {
  const angle = -Math.PI / 2 + ARCH_ISLAND_ORDER.indexOf(island) * Math.PI * 2 / 5;
  return [Math.cos(angle) * 59, 0, Math.sin(angle) * 59];
}
