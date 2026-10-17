// Селектор архипелага для UI. Контракт — types.ts (ArchipelagoView), смысл полей — docs/specs/archipelago-screen.md.
import type { ArchipelagoView, IslandId, WorldState } from '../types';

/** Порядок островов на карте и в панели (не путать с порядком обхода в правилах). */
export const ARCH_MAP_ORDER: IslandId[] = ['lighthouse', 'pelican', 'shell', 'cedar', 'big'];

/** null — архипелаг ещё закрыт (world.archipelago === null). */
export function archipelagoView(world: WorldState, playerId: string): ArchipelagoView | null {
  void playerId;
  if (!world.archipelago) return null;
  return null; // TODO(Codex 1): собрать вид по правилам archipelago.md
}
