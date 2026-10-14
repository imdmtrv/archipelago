import type { ProfessionId } from '../src/types';

interface ProfessionMedians {
  id: ProfessionId;
  median: number;
  capital: number;
}

/** Равенство по любой оси не считается превосходством: оба сравнения строгие. */
export function checkProfessionComparison(rows: ProfessionMedians[]): [string, boolean][] {
  const dominated = rows.some((a) => rows.some((b) => a.median < b.median && a.capital > b.capital));
  const keeper = rows.find((r) => r.id === 'keeper');
  return [
    ['Профессии: Парето — никто не лучше другой по свободе и капиталу одновременно', !dominated],
    ['Смотритель: самая ранняя медиана свободы', !!keeper && rows.every((r) => keeper.median <= r.median)],
  ];
}
