// Новости недели — только структурированные данные; формулировки живут в UI.
import type { PlayerState, WeekNewsItem } from './types';

export type NewsItem = WeekNewsItem;

export const boughtNews = (player: PlayerState, defId: string): NewsItem => ({ playerId: player.id, kind: 'bought', defId });
export const soldNews = (player: PlayerState, defId: string, level = 1): NewsItem => ({ playerId: player.id, kind: 'sold', defId, level });
export const upgradedNews = (player: PlayerState, defId: string, fromLevel: number): NewsItem => ({ playerId: player.id, kind: 'upgraded', defId, fromLevel });
export const loanNews = (player: PlayerState, amount: number): NewsItem => ({ playerId: player.id, kind: 'loan', amount });
export const repayNews = (player: PlayerState, amount: number): NewsItem => ({ playerId: player.id, kind: 'repaid', amount });
export const emergencyNews = (player: PlayerState, amount: number): NewsItem => ({ playerId: player.id, kind: 'emergency', amount });
export const scamNews = (player: PlayerState, defId: string): NewsItem => ({ playerId: player.id, kind: 'scam', defId });
export const freedomNews = (player: PlayerState, week: number): NewsItem => ({ playerId: player.id, kind: 'freedom', week });
export const dreamNews = (player: PlayerState): NewsItem => ({ playerId: player.id, kind: 'dreamDone' });
