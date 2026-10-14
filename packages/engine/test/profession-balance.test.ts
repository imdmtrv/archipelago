import { describe, expect, it } from 'vitest';
import { checkProfessionComparison } from '../scripts/profession-balance';

describe('сравнение профессий', () => {
  it('отвергает более раннюю свободу вместе с большим капиталом', () => {
    const checks = checkProfessionComparison([
      { id: 'keeper', median: 30, capital: 40000 },
      { id: 'teacher', median: 40, capital: 30000 },
    ]);
    expect(checks.map(([, ok]) => ok)).toEqual([false, true]);
  });

  it('принимает обмен ранней свободы на меньший капитал', () => {
    const checks = checkProfessionComparison([
      { id: 'keeper', median: 30, capital: 20000 },
      { id: 'teacher', median: 40, capital: 30000 },
    ]);
    expect(checks.every(([, ok]) => ok)).toBe(true);
  });

  it.each([
    { median: 30, capital: 30000 },
    { median: 40, capital: 40000 },
  ])('равенство по одной оси не считается превосходством: %o', (teacher) => {
    const checks = checkProfessionComparison([
      { id: 'keeper', median: 30, capital: 40000 },
      { id: 'teacher', ...teacher },
    ]);
    expect(checks.every(([, ok]) => ok)).toBe(true);
  });

  it('отвергает более раннюю свободу другой профессии', () => {
    const checks = checkProfessionComparison([
      { id: 'keeper', median: 40, capital: 40000 },
      { id: 'teacher', median: 30, capital: 30000 },
    ]);
    expect(checks.map(([, ok]) => ok)).toEqual([true, false]);
  });
});
