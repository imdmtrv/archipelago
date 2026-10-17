// Прототип «Архипелага»: острова и крупные дела. Числа — стартовые для подбора симулятором (пределы — в спецификации).
import type { BusinessDef, BusinessId, IslandDef, IslandId } from '../types';

/** Пять островов, которые уже нарисованы на горизонте сцены (apps/web/src/scene/world/Ambient.tsx, NEIGHBORS). */
export const ISLANDS: Record<IslandId, IslandDef> = {
  pelican: { id: 'pelican', resident: 'bot-boris', business: 'cannery' },   // Пеликан, рыбацкий
  shell: { id: 'shell', resident: 'bot-mia', business: 'hotel' },          // Ракушка, пляжи
  lighthouse: { id: 'lighthouse', resident: 'bot-timur', business: 'coldStore' }, // Маяк, порт
  cedar: { id: 'cedar', resident: null, business: 'shipyard' },            // Кедровый, лес
  big: { id: 'big', resident: null, business: 'bank' },                    // Большой, центр архипелага
};

export const ISLAND_ORDER: IslandId[] = ['pelican', 'shell', 'lighthouse', 'cedar', 'big'];

/**
 * Урок каждого дела:
 * - завод — переработка дороже сырья, а крупный игрок двигает цену для всех;
 * - отель — большой доход идёт вместе с большим риском (сезон, кризис, шторм);
 * - склад — защита от риска стоит денег и приносит мало, но спасает в плохой год;
 * - верфь — зарабатывать на том, что нужно всем (паромы, ремонт после штормов);
 * - банк — процент это плата за риск.
 */
export const BUSINESSES: Record<BusinessId, BusinessDef> = {
  cannery: {
    id: 'cannery', island: 'pelican', price: 8000, baseIncome: 160, upkeep: 50,
    sector: 'fish', stormRisk: 0.15, resaleRate: 0.7,
  },
  hotel: {
    id: 'hotel', island: 'shell', price: 10000, baseIncome: 380, upkeep: 90,
    sector: 'tourism', stormRisk: 0.3, resaleRate: 0.7,
  },
  coldStore: {
    id: 'coldStore', island: 'lighthouse', price: 2000, baseIncome: 45, upkeep: 10,
    sector: 'stable', stormRisk: 0.1, resaleRate: 0.7,
  },
  shipyard: {
    id: 'shipyard', island: 'cedar', price: 5000, baseIncome: 110, upkeep: 30,
    sector: 'stable', stormRisk: 0.2, resaleRate: 0.7,
  },
  bank: {
    id: 'bank', island: 'big', price: 4000, baseIncome: 0, upkeep: 20,
    sector: 'stable', stormRisk: 0, resaleRate: 0.8,
  },
};

/**
 * Наборы «как улицы одного цвета»: три дела, которые вместе приносят больше. Верфь — в обоих:
 * она строит лодки для рыбной связки и паромы, которые везут гостей курорта.
 */
export const SETS: Record<'fishing' | 'resort', BusinessId[]> = {
  fishing: ['cannery', 'coldStore', 'shipyard'],  // рыбная связка
  resort: ['hotel', 'shipyard', 'bank'],          // курорт
};

