// Все настраиваемые числа правил в одном месте. Баланс подбирается симулятором (scripts/simulate.ts).

// ───────────── Старт и деньги ─────────────
export const START_CASH = 600;
export const SALARY = 180;
export const LIVING = 150;

// ───────────── Счастье ─────────────
export const START_HAPPINESS = 70;
export const HAPPINESS_DRIFT = -3;          // «будни» каждую неделю
export const EXTRA_SHIFT_BONUS = 0.5;       // подработка: +50% зарплаты
export const EXTRA_SHIFT_JOY = -12;
export const REST_COST = 50;
export const REST_JOY = 12;
export const BURNOUT_THRESHOLD = 20;        // ниже — риск выгорания
/** Шанс выгорания: от BURNOUT_CHANCE_MIN (счастье чуть ниже порога) до BURNOUT_CHANCE_MAX (счастье 0). */
export const BURNOUT_CHANCE_MIN = 0.5;
export const BURNOUT_CHANCE_MAX = 1;
export const BURNOUT_SALARY_MUL = 0.5;

// ───────────── Знания ─────────────
export const MAX_KNOWLEDGE = 3;
export const STUDY_BASE_COST = 200;         // цена = 200 × (уровень + 1)
export const SCAM_SIGHT_KNOWLEDGE = 1;      // с этого уровня видны предупреждения об аферах
export const INCOME_BONUS_KNOWLEDGE = 3;
export const INCOME_BONUS = 0.1;            // +10% к доходу активов

// ───────────── Кредиты ─────────────
export const LOAN_RATE = 0.015;             // обычный кредит, в неделю
export const EMERGENCY_RATE = 0.04;         // ростовщик, в неделю
export const LOAN_LIMIT_SALARY_WEEKS = 3;   // лимит = 3 × зарплата + …
export const LOAN_LIMIT_ASSET_SHARE = 0.3;  // … + 30% стоимости продажи имущества − долги
export const LOAN_STEP = 100;               // лимит округляется вниз до сотен
export const EMERGENCY_STEP = 10;           // заём ростовщика округляется вверх до десятков

// ───────────── Страховка и ремонт ─────────────
export const INSURANCE_BASE = 5;            // премия = 5 + 1% цены имущества, которое боится штормов
export const INSURANCE_RATE = 0.01;
export const REPAIR_SHARE = 0.3;            // ремонт = 30% цены

// ───────────── Доска сделок ─────────────
export const BOARD_SIZE = 4;
export const OFFER_LIFETIME = 3;            // недель на доске
export const OFFER_PRICE_SPREAD = 0.15;     // цена ±15%
export const OFFER_INCOME_SPREAD = 0.2;     // доход ±20%
export const DEAL_KIND_WEIGHTS = { asset: 0.62, status: 0.28, scam: 0.10 } as const;
export const MAX_SCAMS_ON_BOARD = 1;

// ───────────── Продажа ─────────────
/** Насколько цена продажи рыбных/туристических активов следует за индексом сектора. */
export const RESALE_MARKET_SENSITIVITY = 0.5;
/** Сделки, цена продажи которых полностью следует за рынком (доли). */
export const MARKET_PRICED_DEALS: readonly string[] = ['shares'];

// ───────────── События ─────────────
export const PERSONAL_EVENT_CHANCE = 0.32;
export const PERSONAL_EVENT_WEIGHTS = { illness: 0.25, breakdown: 0.25, gift: 0.35, raise: 0.15 } as const;
export const ILLNESS_COST: [number, number] = [40, 90];
export const BREAKDOWN_COST: [number, number] = [30, 80];
export const GIFT_AMOUNT: [number, number] = [50, 130];
export const RAISE_SALARY = 15;
export const RAISE_LIVING = 10;

export const WORLD_EVENT_CHANCE = 0.13;
export const WORLD_EVENT_WEIGHTS = { storm: 0.4, fishShoal: 0.2, touristBoom: 0.2, crisis: 0.2 } as const;
export const SHOAL_FISH_SHOCK = 0.35;
export const BOOM_TOURISM_SHOCK = 0.35;
export const CRISIS_TOURISM_SHOCK = -0.35;
export const CRISIS_FISH_SHOCK = -0.15;

// ───────────── Второй акт ─────────────
export const DREAM_ID = 'schooner';         // мечта человека (выбор мечты — следующий этап)
export const DREAM_WORK_EMPLOYED = 1;       // дней в неделю на стройку мечты, пока работаешь
export const DREAM_WORK_FREE = 3;           // … и без работы
export const THREAT_WEEKS = 4;              // столько недель без свободы без работы — и придётся вернуться
export const RETURN_SALARY_MUL = 0.85;      // зарплата при возвращении на работу (округляется до 5)
/** Пороги уровней свободы: пассивный доход / расходы. Названия — в content.ts. */
export const FREEDOM_LEVEL_RATIOS = [1, 1.5, 2] as const;

// ───────────── Рынок ─────────────
export const FISH_MIN = 0.6;
export const FISH_MAX = 1.5;
export const FISH_REVERT = 0.15;            // доля пути назад к 1.0 за неделю
export const FISH_NOISE = 0.08;             // ± случайный шаг
export const TOURISM_MIN = 0.5;
export const TOURISM_MAX = 1.6;
export const TOURISM_AMPLITUDE = 0.25;
export const TOURISM_PERIOD = 26;           // недель
export const SHOCK_DECAY = 0.7;             // всплески затухают ×0.7 в неделю
