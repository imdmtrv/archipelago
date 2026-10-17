// Прототип «Архипелага» (вторая часть игры после «Уверенности»). Контракт: типы состояния слоя архипелага.
// Слой живёт ПОВЕРХ настоящего движка (src/) и не меняет его код: см. docs/specs/archipelago.md, «Прототип».
// В игру (apps/web) этот код не попадает.

import type { OwnedAsset } from '../../src/types';

/** Пять островов на горизонте. Три — соседей, два — необитаемые. */
export type IslandId = 'pelican' | 'shell' | 'lighthouse' | 'cedar' | 'big';

/** Крупные дела: по одному на остров. */
export type BusinessId = 'cannery' | 'hotel' | 'coldStore' | 'shipyard' | 'bank';

/** Чей индекс рынка множит базовый доход дела. */
export type ArchSector = 'fish' | 'tourism' | 'stable';

export interface IslandDef {
  id: IslandId;
  /** id бота-жителя (`bot-boris` …) или null — остров необитаем. */
  resident: string | null;
  business: BusinessId;
}

export interface BusinessDef {
  id: BusinessId;
  island: IslandId;
  price: number;
  /** База дохода в неделю до множителей (индекс сектора, гости, лодки…). Формулы — model.ts по спецификации. */
  baseIncome: number;
  upkeep: number;
  sector: ArchSector;
  /** Шанс повреждения, когда шторм пришёл именно на этот остров (до STORM_HIT_MULT). */
  stormRisk: number;
  /** Доля цены, которую дело стоит в капитале (и при обычной продаже). */
  resaleRate: number;
}

/** Доля в деле. Сумма долей одного дела = 1. `mainland` — продано компании с материка (доход уходит с архипелага). */
export interface Stake {
  playerId: string;          // 'p1' (человек), 'bot-mia', 'bot-boris', 'bot-timur' или 'mainland'
  share: number;             // 1 или 0.5
}

/**
 * Кто управляет делом человека (доля 1). `owner` — сам, занимает один день недели;
 * сосед — забирает NEIGHBOR_MANAGER_SHARE дохода; `hired` — наёмный, HIRED_MANAGER_SHARE.
 * У дела в партнёрстве управляет партнёр-бот бесплатно (`partner`). У дела ботов — `partner`.
 */
export type Manager = 'owner' | 'hired' | 'partner' | { neighborId: string };

export interface BusinessState {
  id: BusinessId;
  stakes: Stake[];
  manager: Manager;
  damaged: boolean;
  builtWeek: number;
}

/** Класс заёмщика банка: чем рискованнее, тем выше ставка и чаще невозврат. */
export type BankClass = 'reliable' | 'normal' | 'risky';

export interface BankLoan {
  uid: string;
  /** 'npc' — приезжий (проценты еженедельно); id бота — сосед (проценты и долг разом в конце срока). */
  borrower: string;
  cls: BankClass;
  principal: number;
  weeklyRate: number;
  startWeek: number;
  dueWeek: number;
  tries: number;             // соседу: сколько раз уже не смог вернуть
  crisisSeen: boolean;       // был ли кризис за срок (невозврат × CRISIS_DEFAULT_MULT)
}

export type ArchChoice =
  | { kind: 'partner'; week: number; botId: string; business: BusinessId }
  | { kind: 'loanRequest'; week: number; borrower: string; cls: BankClass; amount: number; weeklyRate: number; term: number }
  | { kind: 'buyer'; week: number; business: BusinessId; offer: number };

/** Действия стратегии человека в слое архипелага. */
export type ArchAction =
  | { type: 'buildRoute'; island: IslandId }
  | { type: 'buyBusiness'; business: BusinessId; loan: number } // loan — сколько взять кредитом (≤ BUSINESS_LOAN_SHARE × цены)
  | { type: 'setManager'; business: BusinessId; manager: Manager }
  | { type: 'repairBusiness'; business: BusinessId }
  | { type: 'setInsurance'; on: boolean }
  | { type: 'resolveChoice'; accept: boolean; loan?: number };

/** Счётчики для метрик симулятора (только человек, если не сказано иное). */
export interface ArchLog {
  decisionWeeks: number[];   // недели, в которые человек принял решение в слое (покупка, линия, развилка, заём)
  homeDecisionWeeks: number[]; // недели решений на родном острове (покупка, улучшение, ремонт, кредит, учёба, шхуна…)
  paidToNeighbors: number;   // монет, ушедших соседям как управляющим и партнёрам (наследие)
  bankLent: number;
  bankDefaulted: number;     // потерянный основной долг
  bankInterest: number;      // полученные проценты
  repairs: number;           // монет на ремонт дел
  businessIncome: number;    // чистый доход дел человека за всё время
  restoredShares: number;    // санитарный счётчик: сколько раз бот продал псевдоактив и слой его вернул (ожидается 0)
}

export interface ArchState {
  /** Неделя, когда архипелаг открылся (человек впервые достиг FREEDOM_LEVEL_RATIOS[1]); null — ещё закрыт. */
  openWeek: number | null;
  routes: IslandId[];        // паромы от родного острова; сеть = родной + эти острова
  businesses: BusinessState[];
  loans: BankLoan[];
  /** Страховка дел человека от штормов: с какой недели действует (оформление + INSURANCE_WAIT_WEEKS движка); null — нет. */
  insuredFrom: number | null;
  choice: ArchChoice | null; // одна развилка за раз, решается на следующей неделе (нерешённая = отказ)
  /** С какой недели компания с материка достраивает архипелаг (итерация 2); null — ещё не начала. */
  mainlandFrom: number | null;
  finaleWeek: number | null; // «Архипелаг процветает»: все острова связаны и на каждом работает дело
  rng: number;               // своё состояние ГПСЧ: состояние движка (world.rng) слой не трогает
  nextUid: number;
  /** Снимок перед endWeek: восстановление проданных ботом псевдоактивов. */
  syncedShares: { playerId: string; asset: OwnedAsset }[];
  log: ArchLog;
}
