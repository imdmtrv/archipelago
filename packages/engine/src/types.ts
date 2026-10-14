// Контракт движка «Архипелага». Этот файл — общий язык движка, UI и 3D-сцены.
// Менять поля можно только согласованно: на них опираются apps/web/src/ui и apps/web/src/scene.

// ───────────── Контент ─────────────

export type Sector = 'fish' | 'tourism' | 'stable';

/** Куда на острове ставится объект. Вместимость — в SLOT_CAPACITY (slots.ts). */
export type SlotType = 'pier' | 'plot' | 'beach' | 'plaza' | 'sea' | 'finance';

/** Какая 3D-модель рисует объект. */
export type ModelId =
  | 'boat' | 'smokehouse' | 'cottage' | 'bungalow' | 'cafe'
  | 'bank' | 'pearlFarm'
  | 'fountain' | 'statue' | 'yacht' | 'garden';

export type DealKind = 'asset' | 'status' | 'scam';

export interface AssetDef {
  id: string;
  kind: DealKind;
  /** Базовые значения; конкретное предложение отклоняется от них случайно. */
  price: number;
  income: number;            // в неделю, до умножения на индекс сектора; 0 у статусных вещей
  upkeep: number;            // содержание в неделю
  sector: Sector;
  joy: number;               // + к счастью каждую неделю, пока владеешь
  slot: SlotType;
  model: ModelId;
  minKnowledge: number;      // ниже — предложение видно, но купить нельзя
  stormRisk: number;         // 0..1 — шанс повреждения в шторм
  resaleRate: number;        // доля цены при продаже (до рыночной поправки)
  /** Только для афер: через сколько недель «ферма» исчезает. */
  collapseWeeks?: [number, number];
  /** Уровень знаний для распознавания аферы; по умолчанию SCAM_SIGHT_KNOWLEDGE. */
  scamSightKnowledge?: number;
  /** Улучшения на том же месте: upgrades[0] — переход на уровень 2, upgrades[1] — на уровень 3. */
  upgrades?: UpgradeDef[];
}

/** Ступень улучшения актива: лодка → баркас → траулер. Занимает то же место на острове. */
export interface UpgradeDef {
  cost: number;              // сколько стоит перейти на этот уровень
  income: number;            // + к базовому доходу экземпляра (до индекса сектора)
  upkeep: number;            // + к содержанию в неделю
  minKnowledge: number;
}

// ───────────── Мечта (второй акт) ─────────────

export interface DreamStageDef {
  cost: number;              // платится при начале этапа
  work: number;              // дней работы, чтобы закончить этап
}

export interface DreamDef {
  id: string;
  stages: DreamStageDef[];
  upkeep: number;            // содержание готовой мечты в неделю
  joy: number;               // + к счастью каждую неделю, когда мечта готова
}

export interface DreamState {
  id: string;
  built: number;             // сколько этапов уже готово (0..stages.length)
  building: boolean;         // этап номер `built` оплачен и строится
  progress: number;          // дней работы, вложенных в текущий этап
  doneWeek: number | null;   // неделя, когда мечта готова целиком
}

// ───────────── Слухи, развилки, цели ─────────────

/** Общие события недели. Они планируются заранее, и о них идут слухи. */
export type WorldEventKind = 'storm' | 'fishShoal' | 'touristBoom' | 'crisis';

/** Откуда слух: надёжный источник (старые рыбаки, банк) сбывается почти всегда, рыночная болтовня — редко. */
export type RumorSource = 'reliable' | 'gossip';

/** Запланированное общее событие или ложный слух. Скрытая правда: UI показывает игроку только слух (`rumorViews`). */
export interface UpcomingEvent {
  kind: WorldEventKind;
  real: boolean;             // false — слух не сбудется (скрытая правда, UI её не показывает)
  source: RumorSource;
  week: number;              // в конце какой недели событие случится
  windowStart: number;       // слух называет недели windowStart и windowStart + 1; `week` — одна из них
  announcedWeek: number;     // в конце какой недели пошёл слух
}

export type ChoiceKind = 'neighborLoan' | 'fireSale' | 'buyer';

/** Развилка: выпадает в конце недели, игрок решает её в течение следующей недели `week`. */
export interface PendingChoice {
  uid: string;
  kind: ChoiceKind;
  week: number;
  /** neighborLoan: neighborId, amount; fireSale: neighborId, assetUid, price; buyer: assetUid, offer. */
  params: Record<string, EventParam>;
}

/** Монеты, которые игрок одолжил соседу. */
export interface LentLoan {
  uid: string;
  neighborId: string;
  amount: number;            // сколько одолжил
  dueWeek: number;           // в конце какой недели сосед попробует вернуть
  tries: number;             // сколько раз уже пытался
}

export interface GoalReward { cash: number; joy: number }

/** Цель на несколько недель. Порядок в GOALS — порядок выдачи. Без сроков: цель ждёт, сколько нужно. */
export interface GoalDef {
  id: string;
  reward: GoalReward;
}

export interface GoalsState {
  active: string[];          // id целей из GOALS, не больше GOALS_ACTIVE
  done: { id: string; week: number }[];
  calmWeeks: number;         // недель подряд без займа у ростовщика (цель noLoanShark)
  hadLoan: boolean;          // брал ли обычный кредит (цель debtFree выдаётся только после этого)
  insuredStorm: boolean;     // пережил ли шторм под действующей страховкой (цель insuredStorm)
}

// ───────────── Профессии ─────────────

/** Карточка профессии на старте: смотритель маяка, учитель, капитан парома, врач. */
export type ProfessionId = 'keeper' | 'teacher' | 'captain' | 'doctor';

export interface ProfessionDef {
  id: ProfessionId;
  salary: number;            // зарплата в неделю
  living: number;            // расходы на жизнь в неделю
  cash: number;              // монеты на старте
  loan: number;              // стартовый обычный кредит (у врача — за учёбу); 0 — без долга
}

// ───────────── Состояние мира ─────────────

export type BotStyle = 'saver' | 'spender' | 'gambler';

export interface OwnedAsset {
  uid: string;
  defId: string;
  boughtWeek: number;
  price: number;             // фактически уплаченная цена (вместе со всеми улучшениями)
  income: number;            // базовый доход этого экземпляра (до индекса сектора), с улучшениями
  upkeep: number;            // с улучшениями
  level: number;             // 1 — как купили; 2, 3 — после улучшений (1 + индекс в def.upgrades)
  damaged: boolean;          // повреждён штормом: доход 0, пока не починят
  slotIndex: number;         // номер места в слоте своего типа (0..capacity-1)
  /** Скрытая правда об афере. UI не должен показывать это поле игроку. */
  collapseWeek?: number;
}

export interface Loan {
  uid: string;
  principal: number;
  weeklyRate: number;        // например 0.015 = 1.5% в неделю
  emergency: boolean;        // заём у ростовщика (взят автоматически)
}

export interface PlayerState {
  id: string;
  name: string;              // имя игрока
  islandName: string;
  isBot: boolean;
  botStyle?: BotStyle;
  cash: number;
  salary: number;
  living: number;            // базовые расходы на жизнь в неделю
  happiness: number;         // 0..100
  knowledge: number;         // 0..3
  // флаги текущей недели (сбрасываются в endWeek)
  studiedThisWeek: boolean;
  restedThisWeek: boolean;
  extraShift: boolean;
  insured: boolean;          // постоянная настройка, премия списывается каждую неделю
  /** С какой недели страховка действует: её оформляют заранее (INSURANCE_WAIT_WEEKS); null — не застрахован. */
  insuranceFrom: number | null;
  loans: Loan[];
  owned: OwnedAsset[];
  freedomWeek: number | null; // неделя, когда впервые достигнута свобода
  employed: boolean;         // работает ли; уйти с работы можно только после свободы
  threatWeeks: number;       // недель подряд без работы и без свободы («свобода под угрозой»)
  bestLevel: number;         // высший достигнутый уровень свободы (0 — ещё нет, 1..FREEDOM_LEVELS.length)
  dream: DreamState | null;  // у соседей-ботов мечты нет
  profession: ProfessionId;
  layoffWeeks: number;       // сколько недель ещё без зарплаты из-за сокращения (0 — работает как обычно)
  lastLayoffWeek: number;    // неделя последнего сокращения (0 — не было)
  choice: PendingChoice | null; // нерешённая развилка; у ботов всегда null
  lastChoiceWeek: number;    // неделя последней развилки (0 — ещё не было)
  lent: LentLoan[];          // одолжено соседям
  goals: GoalsState | null;  // у ботов null
}

export interface MarketState {
  fish: number;              // индекс ~0.6..1.5
  tourism: number;           // индекс ~0.5..1.6
  /** Временные эффекты событий (бум/кризис), затухают со временем. */
  tourismShock: number;
  fishShock: number;
}

export interface Offer {
  uid: string;
  defId: string;
  price: number;
  income: number;            // базовый доход экземпляра (до индекса сектора)
  upkeep: number;
  expiresWeek: number;       // последняя неделя, когда ещё можно купить
}

export type Tone = 'good' | 'bad' | 'neutral';

export type EventParam = number | string | string[];

export interface GameEvent {
  id: string;                // тип события: 'storm' | 'illness' | 'gift' | ...
  tone: Tone;
  params?: Record<string, EventParam>;
  variant?: number;
  /** Сохранённый до v4 пользовательский текст: показывается дословно. */
  legacyTitle?: string;
  legacyText?: string;
  cashDelta?: number;
  affectedAssetUids?: string[];
}

export type WeekNewsItem =
  | { playerId: string; kind: 'bought'; defId: string }
  | { playerId: string; kind: 'sold'; defId: string; level: number }
  | { playerId: string; kind: 'upgraded'; defId: string; fromLevel: number }
  | { playerId: string; kind: 'loan' | 'repaid' | 'emergency'; amount: number }
  | { playerId: string; kind: 'scam'; defId?: string }
  | { playerId: string; kind: 'freedom'; week: number }
  | { playerId: string; kind: 'dreamDone' }
  | { playerId: string; kind: 'layoff' }
  | { playerId: string; kind: 'legacy'; legacyText: string };

export interface PlayerWeekReport {
  playerId: string;
  salary: number;
  assetIncome: { assetUid: string; amount: number }[];
  upkeep: { assetUid: string; amount: number }[];
  living: number;
  interest: number;
  insurance: number;
  eventsCash: number;
  net: number;
  cashAfter: number;
  happinessDelta: number;
  events: GameEvent[];
  /** Активы, исчезнувшие на этой неделе (аферы). */
  lostAssetUids: string[];
  freedomReached: boolean;   // true только в ту неделю, когда свобода достигнута впервые
}

export interface WeekReport {
  week: number;              // какая неделя закончилась
  worldEvents: GameEvent[];
  players: Record<string, PlayerWeekReport>;
  news: WeekNewsItem[];
}

export interface WorldState {
  version: 7;
  seed: number;
  rng: number;               // текущее состояние ГПСЧ — вся случайность только через него
  nextUid: number;
  week: number;              // текущая неделя (начинается с 1)
  market: MarketState;
  players: PlayerState[];    // players[0] — человек
  offers: Offer[];
  /** Запланированные общие события (не больше одного на неделю). */
  upcoming: UpcomingEvent[];
  lastReport: WeekReport | null;
}

// ───────────── Действия ─────────────

export type Action =
  | { type: 'buyOffer'; playerId: string; offerUid: string }
  | { type: 'sellAsset'; playerId: string; assetUid: string }
  | { type: 'repairAsset'; playerId: string; assetUid: string }
  | { type: 'upgradeAsset'; playerId: string; assetUid: string }
  | { type: 'takeLoan'; playerId: string; amount: number }
  | { type: 'repayLoan'; playerId: string; loanUid: string; amount: number }
  | { type: 'setInsurance'; playerId: string; on: boolean }
  | { type: 'setExtraShift'; playerId: string; on: boolean }
  | { type: 'study'; playerId: string }
  | { type: 'rest'; playerId: string }
  | { type: 'quitJob'; playerId: string }
  | { type: 'returnToWork'; playerId: string }
  | { type: 'buildDream'; playerId: string }
  | { type: 'resolveChoice'; playerId: string; accept: boolean }
  | { type: 'endWeek' };

export interface ActionResult {
  world: WorldState;
  error?: EngineError;
}

export const ERROR_CODES = {
  unknownPlayer: 'unknownPlayer', unknownAction: 'unknownAction', offerGone: 'offerGone', noSuchAsset: 'noSuchAsset',
  notDamaged: 'notDamaged', noUpgrade: 'noUpgrade', repairFirst: 'repairFirst', badAmount: 'badAmount',
  noCredit: 'noCredit', noSuchLoan: 'noSuchLoan', studiedThisWeek: 'studiedThisWeek', maxKnowledge: 'maxKnowledge',
  restedThisWeek: 'restedThisWeek', restDuringShift: 'restDuringShift', shiftAfterRest: 'shiftAfterRest',
  quitBeforeFreedom: 'quitBeforeFreedom', alreadyQuit: 'alreadyQuit', alreadyEmployed: 'alreadyEmployed',
  shiftUnemployed: 'shiftUnemployed', noDream: 'noDream', dreamBeforeFreedom: 'dreamBeforeFreedom',
  dreamBusy: 'dreamBusy', dreamDone: 'dreamDone', noChoice: 'noChoice',
} as const;

export type EngineError =
  | { code: keyof typeof ERROR_CODES }
  | { code: 'notEnoughCash'; missing: number }
  | { code: 'needKnowledge'; level: number }
  | { code: 'loanOverLimit'; limit: number }
  | { code: 'slotFull'; slot: SlotType };

// ───────────── Производные данные для UI ─────────────

export interface FinanceView {
  salary: number;            // с учётом подработки на этой неделе
  passiveIncome: number;     // ожидаемый доход активов по текущим индексам
  expenses: {
    living: number;
    upkeep: number;
    interest: number;
    insurance: number;
    total: number;
  };
  net: number;               // salary + passiveIncome − expenses.total
  freedomRatio: number;      // passiveIncome / expenses.total
  netWorth: number;          // cash + стоимость активов − долги
  debt: number;
  employed: boolean;
  /** Уровень свободы по freedomRatio: 0 — ещё нет, дальше индекс в FREEDOM_LEVELS + 1. */
  level: number;
}

export interface OfferView {
  offer: Offer;
  def: AssetDef;
  expectedIncome: number;    // доход в неделю по текущему рынку (0 у статуса)
  upkeep: number;
  net: number;               // expectedIncome − upkeep
  /** Недель до окупаемости; null — никогда (net ≤ 0). */
  paybackWeeks: number | null;
  weeksLeft: number;         // сколько недель ещё висит на доске (0 = последняя)
  /** Предупреждение, видимое благодаря знаниям. */
  warning?: 'scam';
  locked: boolean;           // не хватает знаний
  canAfford: boolean;
  slotFull: boolean;
  /** Доля свободы (как FinanceView.freedomRatio) сразу после покупки. */
  freedomAfter: number;
}

export interface AssetView {
  asset: OwnedAsset;
  def: AssetDef;
  level: number;
  maxLevel: number;          // 1 — у сделки нет улучшений
  currentIncome: number;     // 0, если повреждён
  upkeep: number;
  saleValue: number;
  repairCost: number;        // 0, если не повреждён
  /** Следующее улучшение; null — улучшать нечего (максимальный уровень или у сделки нет улучшений). */
  upgrade: UpgradeView | null;
}

export interface UpgradeView {
  def: UpgradeDef;
  toLevel: number;
  cost: number;
  incomeGain: number;        // + к доходу в неделю по текущему рынку
  upkeepGain: number;
  netGain: number;           // incomeGain − upkeepGain
  paybackWeeks: number | null;
  /** Доля свободы (как FinanceView.freedomRatio) сразу после улучшения. */
  freedomAfter: number;
  canUpgrade: boolean;
  reason?: EngineError;
}

export interface DreamView {
  def: DreamDef;
  state: DreamState;
  /** Этап, который строится или будет следующим; null — мечта готова. */
  stage: DreamStageDef | null;
  stageIndex: number;
  /** Дней работы над мечтой в неделю сейчас: работая — меньше, без работы — больше. */
  workPerWeek: number;
  /** Недель до конца текущего этапа (если строится) или сколько займёт следующий; 0 — мечта готова. */
  weeksLeft: number;
  /** Можно ли начать следующий этап прямо сейчас; иначе — причина для игрока. */
  canStart: boolean;
  reason?: 'beforeFreedom' | 'done' | 'building';
  missingCash?: number;
  /** Доля свободы, когда мечта будет готова (с её содержанием и радостью). */
  freedomAfterDone: number;
}

export interface LeaderboardRow {
  playerId: string;
  name: string;
  islandName: string;
  isBot: boolean;
  botStyle?: BotStyle;
  freedomRatio: number;
  netWorth: number;
  freedomWeek: number | null;
}

// ───────────── Развилки, цели, слухи для UI ─────────────

export type ChoiceView =
  | {
    kind: 'neighborLoan'; uid: string; neighborId: string;
    amount: number;          // сколько просит
    returnAmount: number;    // сколько обещает вернуть (с благодарностью)
    canAccept: boolean;
    reason?: EngineError;    // почему нельзя одолжить (не хватает монет)
  }
  | {
    kind: 'fireSale'; uid: string; neighborId: string; assetUid: string; defId: string; level: number;
    price: number;           // за сколько сосед отдаёт
    usualPrice: number;      // сколько это стоило соседу (уплаченная цена с улучшениями)
    weeklyIncome: number;    // сколько актив будет приносить игроку сейчас
    paybackWeeks: number | null;
    freedomBefore: number; freedomAfter: number; // как FinanceView.freedomRatio
    canAccept: boolean;
    reason?: EngineError;    // не хватает монет или места
  }
  | {
    kind: 'buyer'; uid: string; assetUid: string; defId: string; level: number;
    offer: number;           // сколько предлагает покупатель
    saleValue: number;       // сколько дали бы при обычной продаже
    weeklyIncome: number;    // сколько актив приносит сейчас
    freedomBefore: number; freedomAfter: number;
  };

export interface RumorView {
  kind: WorldEventKind;
  source: RumorSource;
  fromWeek: number;          // слух называет недели fromWeek..toWeek
  toWeek: number;
  /** Точная неделя — тем, у кого хватает знаний (RUMOR_EXACT_KNOWLEDGE); иначе null. */
  exactWeek: number | null;
}

export interface GoalView {
  id: string;
  value: number;             // текущий прогресс в единицах цели
  target: number;
  reward: GoalReward;
}

export interface GoalsView {
  active: GoalView[];
  done: { id: string; week: number }[];
  total: number;             // сколько целей всего в GOALS
}
