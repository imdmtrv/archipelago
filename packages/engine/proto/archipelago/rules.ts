// Прототип «Архипелага»: все настраиваемые числа слоя. Пределы подбора — в docs/specs/archipelago.md, «Числа».
// Числа подбирает координатор по таблицам `npm run sim:arch`; исполнитель их не меняет.

// ───────────── Открытие ─────────────
/** Архипелаг открывается, когда настоящая свобода человека впервые достигает этой доли («Уверенность»). */
export const OPEN_RATIO = 1.5;

// ───────────── Паромы (единственное новое действие: «связать острова») ─────────────
export const ROUTE_COST = 700;
export const ROUTE_UPKEEP = 10;
/** Билеты: доход линии в неделю × индекс туризма. */
export const ROUTE_TICKETS = 20;

// ───────────── Управление ─────────────
/** Дней в неделю на свои дела: на работе / без работы (как стройка мечты: DREAM_WORK_EMPLOYED / DREAM_WORK_FREE). */
export const DAYS_EMPLOYED = 1;
export const DAYS_FREE = 3;
/** Наёмный управляющий забирает эту долю дохода дела, сосед-управляющий — свою (он учится, наследие дороже). */
export const HIRED_MANAGER_SHARE = 0.2;
export const NEIGHBOR_MANAGER_SHARE = 0.25;
/** Счастье за каждый день недели, который человек сам управляет делом. */
export const OWNER_DAY_JOY = -1;

// ───────────── Деньги на дела ─────────────
/** Кредит под дело: до этой доли цены, обычный кредит движка (ставка LOAN_RATE), мимо лимита. */
export const BUSINESS_LOAN_SHARE = 0.5;
/** Страховка дел от штормов: премия в неделю = доля цены (её части человека) у дел с stormRisk > 0. */
export const BUSINESS_INSURANCE_RATE = 0.0025;
/** Ремонт дела после шторма: доля цены. */
export const BUSINESS_REPAIR_SHARE = 0.3;

// ───────────── Шторм ─────────────
/** Шторм движка приходит на один из пяти островов архипелага; дело там ломается с шансом stormRisk × это. */
export const STORM_HIT_MULT = 3;
export const STORM_HIT_MAX = 0.9;

// ───────────── Эффекты дел ─────────────
/** Консервный завод: прибавка к цене улова (лодки и коптильни) всех, кто живёт в сети. */
export const CANNERY_FISH_BONUS = 0.2;
/** …и его доход растёт с каждой целой лодкой в сети. */
export const CANNERY_PER_BOAT = 10;
/** Отель: гостей больше с каждым обитаемым островом в сети (родной тоже обитаем). */
export const HOTEL_PER_ISLAND = 0.08;
/** Верфь: паромы дешевле; доход за каждую линию архипелага и за каждый повреждённый штормом актив в сети. */
export const SHIPYARD_ROUTE_DISCOUNT = 0.4;
export const SHIPYARD_PER_ROUTE = 25;
export const SHIPYARD_PER_REPAIR = 20;
/** Склад-холодильник: когда рыба дешевле FISH_FLOOR, улов в сети продаётся по FISH_FLOOR. */
export const COLD_STORE_FISH_FLOOR = 1;

// ───────────── Банк архипелага ─────────────
export const BANK_REQUEST_CHANCE = 0.4;       // шанс в неделю, что кто-то просит в долг
export const BANK_NEIGHBOR_SHARE = 0.35;      // …и это сосед в нужде (если такой есть в сети)
export const BANK_AMOUNT: [number, number] = [1500, 5000]; // приезжий просит, округляется до 100
export const BANK_TERM: [number, number] = [8, 12];        // недель
export const BANK_CLASS_WEIGHTS = { reliable: 0.4, normal: 0.4, risky: 0.2 } as const;
export const BANK_RATE = { reliable: 0.012, normal: 0.022, risky: 0.03 } as const;    // в неделю
export const BANK_DEFAULT = { reliable: 0.03, normal: 0.12, risky: 0.35 } as const;     // шанс невозврата в конце срока
/** Был кризис за срок займа — невозврат во столько раз чаще (не выше 0.95). */
export const CRISIS_DEFAULT_MULT = 2.5;
/** Сосед «в нужде»: занял у ростовщика или наличных меньше этого. */
export const NEIGHBOR_NEED_CASH = 500;
export const NEIGHBOR_LOAN_RETRY = 2;         // не смог вернуть — пробует снова через 2 недели
export const NEIGHBOR_LOAN_TRIES = 3;

// ───────────── Соседи строят сами ─────────────
/** Бот берётся за дело своего острова не раньше чем через столько недель после открытия… */
export const BOT_DELAY = 15;
/** …и когда наличных у него ≥ цена + этот запас. Перед стройкой предлагает человеку войти в долю пополам. */
export const BOT_BUFFER: Record<string, number> = { 'bot-mia': 3000, 'bot-boris': 2000 };
/** Какое дело какой бот строит сам. Тимур не строит — денег нет. */
export const BOT_BUILDS: Record<string, 'hotel' | 'cannery'> = { 'bot-mia': 'hotel', 'bot-boris': 'cannery' };
export const PARTNER_SHARE = 0.5;

// ───────────── Покупатель с материка ─────────────
export const BUYER_CHANCE = 0.02;             // в неделю на каждое дело, целиком принадлежащее человеку
export const BUYER_PREMIUM: [number, number] = [1.2, 1.45];
