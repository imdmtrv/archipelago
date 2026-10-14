// Развилки, цели и слухи — производные данные для UI. Логику недели (выпадение развилок, проверка целей,
// планирование событий) делает week.ts. Пока здесь заглушки контракта: интерфейс уже может на них опираться.
import type { ChoiceView, GoalsView, PlayerState, RumorView, WorldState } from './types';

/** Нерешённая развилка игрока с расчётом последствий; null — развилки нет. */
// TODO(движок): реализовать по docs/specs/engagement-1.md
export function choiceView(_world: WorldState, _playerId: string): ChoiceView | null {
  return null;
}

/** Активные и выполненные цели игрока; null — у игрока нет целей (боты). */
// TODO(движок): реализовать по docs/specs/engagement-1.md
export function goalsView(_world: WorldState, _playerId: string): GoalsView | null {
  return null;
}

/** Слухи о запланированных общих событиях, как их видит игрок (с учётом его знаний). */
// TODO(движок): реализовать по docs/specs/engagement-1.md
export function rumorViews(_world: WorldState, _playerId: string): RumorView[] {
  return [];
}

/** Действует ли страховка на неделе `week` (её оформляют заранее). */
export function insuranceActive(player: PlayerState, week: number): boolean {
  return player.insured && player.insuranceFrom !== null && week >= player.insuranceFrom;
}
