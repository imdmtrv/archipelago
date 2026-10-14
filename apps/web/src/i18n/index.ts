import { create } from 'zustand';
import type { EngineError, GameEvent, PlayerState, Sector, SlotType, WeekNewsItem } from '@arch/engine';
import { ru, type Dict } from './ru';
import { en } from './en';

export type Lang = 'ru' | 'en';
const KEY = 'archipelago.lang.v1';

function pathForcesEnglish(): boolean {
  return /(?:^|\/)en\/?$/.test(location.pathname);
}

function storedLang(): Lang | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'ru' || value === 'en' ? value : null;
  } catch { return null; }
}

// Адрес решает язык: `/en/` — английский всегда, корень — русский, если игрок сам не выбрал другой язык.
// Язык браузера не учитывается: русскоязычные игроки с английским телефоном попадали на английскую версию.
function initialLang(): Lang { return pathForcesEnglish() ? 'en' : storedLang() ?? 'ru'; }

interface I18nState { lang: Lang; setLang(lang: Lang): void }
export const useLanguage = create<I18nState>((set, get) => ({
  lang: initialLang(),
  setLang(lang) {
    if (get().lang === lang) return;
    try { localStorage.setItem(KEY, lang); } catch { /* storage unavailable */ }
    set({ lang });
    applyDocument(lang);
    void import('../analytics').then(({ track }) => track('lang-switch', lang));
  },
}));

export const dictFor = (lang: Lang): Dict => (lang === 'ru' ? ru : en);
function applyDocument(lang: Lang) {
  document.documentElement.lang = lang;
  document.title = dictFor(lang).meta.title;
}
applyDocument(useLanguage.getState().lang);

function numberFormat(lang: Lang) {
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 });
}

export interface I18nApi {
  t: Dict;
  lang: Lang;
  fmt(n: number): string;
  signed(n: number): string;
  plural(n: number, forms: { one: string; few?: string; many?: string; other: string }): string;
  setLang(lang: Lang): void;
}

function api(lang: Lang): I18nApi {
  const fmt = (n: number) => numberFormat(lang).format(Math.round(n));
  const plural = (n: number, forms: { one: string; few?: string; many?: string; other: string }) => {
    const rule = new Intl.PluralRules(lang === 'ru' ? 'ru-RU' : 'en-US').select(Math.abs(n));
    return forms[rule as keyof typeof forms] ?? forms.other;
  };
  return {
    t: dictFor(lang), lang, fmt,
    signed: (n: number) => (Math.round(n) >= 0 ? '+' : '−') + fmt(Math.abs(n)),
    plural,
    setLang: useLanguage.getState().setLang,
  };
}

export function useI18n(): I18nApi {
  const lang = useLanguage((s) => s.lang);
  const setLang = useLanguage((s) => s.setLang);
  return { ...api(lang), setLang };
}

export function getI18n(): I18nApi { return api(useLanguage.getState().lang); }

export function assetCopy(defId: string, level = 1) {
  const t = getI18n().t.assets[defId as keyof typeof ru.assets];
  if (!t) return { title: defId, description: defId, accusative: defId };
  const up = level > 1 ? t.upgrades[level - 2] : undefined;
  return { title: up?.title ?? t.title, description: up?.description ?? t.description, accusative: up?.accusative ?? t.accusative };
}

export function dreamCopy(stage?: number) {
  const d = getI18n().t.dream;
  return stage === undefined ? d : d.stages[stage];
}

export function displayPlayer(player: Pick<PlayerState, 'id' | 'name' | 'islandName' | 'isBot'>) {
  const { t } = getI18n();
  const bot = t.bots[player.id as keyof typeof t.bots];
  if (player.isBot && bot) return { name: bot.name, islandName: bot.island };
  const name = player.name === 'Вы' || player.name === 'You' ? t.meta.defaultPlayer : player.name;
  return { name, islandName: player.islandName };
}

export function weeks(n: number): string {
  const { t, plural } = getI18n();
  const word = plural(n, t.units.week);
  return `${n} ${word}`;
}

export function weeksAcc(n: number): string {
  const { t, plural } = getI18n();
  const word = plural(n, t.units.weekAcc);
  return `${n} ${word}`;
}

export function days(n: number): string {
  const { t, plural } = getI18n();
  const word = plural(n, t.units.day);
  return `${n} ${word}`;
}

export function coins(n: number, genitive = false): string {
  const { t, plural } = getI18n();
  const word = plural(n, genitive ? t.units.coinGenitive : t.units.coin);
  return `${n} ${word}`;
}

export function levelTitle(level: number): string {
  const { t } = getI18n();
  return level >= 1 ? t.levels[level - 1] : t.belowFreedom;
}
export function levelGenitive(index: number): string { return getI18n().t.levelsGenitive[index]; }

export function marketLine(index: number, sector: 'fish' | 'tourism') {
  const { t } = getI18n();
  if (sector === 'fish') {
    if (index > 1.12) return { text: t.market.fishUp, tone: 'pos' as const };
    if (index < 0.88) return { text: t.market.fishDown, tone: 'neg' as const };
    return { text: t.market.fishSame, tone: 'neutral' as const };
  }
  if (index > 1.12) return { text: t.market.tourismUp, tone: 'pos' as const };
  if (index < 0.88) return { text: t.market.tourismDown, tone: 'neg' as const };
  return { text: t.market.tourismSame, tone: 'neutral' as const };
}
export function sectorName(sector: Sector): string { return getI18n().t.sectors[sector]; }

export function errorText(error: EngineError): string {
  const { t } = getI18n();
  if (error.code === 'notEnoughCash') return t.errors.notEnoughCash(error.missing, coins(error.missing, true));
  if (error.code === 'needKnowledge') return t.errors.needKnowledge(error.level);
  if (error.code === 'loanOverLimit') return t.errors.loanOverLimit(error.limit, coins(error.limit, true));
  if (error.code === 'slotFull') return t.errors.slotFull[error.slot as SlotType];
  return t.errors[error.code];
}

function eventAssetNames(refs: unknown): string {
  return Array.isArray(refs) ? refs.map((ref) => {
    const [id, level] = String(ref).split(':');
    return assetCopy(id, Number(level)).title;
  }).join(', ') : '';
}

export function eventCopy(event: GameEvent): { title: string; text: string } {
  if (event.legacyTitle !== undefined || event.legacyText !== undefined) return { title: event.legacyTitle ?? '', text: event.legacyText ?? '' };
  const { t } = getI18n();
  const p = event.params ?? {};
  switch (event.id) {
    case 'burnout': return t.events.burnout;
    case 'illness': return { title: t.events.illness.title, text: p.insured ? t.events.illness.insured : t.events.illness.uninsured(coins(Number(p.cost ?? 0))) };
    case 'breakdown': return { title: t.events.breakdown.title, text: t.events.breakdown.variants[event.variant ?? 0] };
    case 'gift': return { title: t.events.gift.title, text: t.events.gift.variants[event.variant ?? 0] };
    case 'raise': return { title: t.events.raise.title, text: t.events.raise.text(Number(p.salaryIncrease), Number(p.livingIncrease)) };
    case 'stormInsured': return { title: t.events.stormInsured.title, text: t.events.stormInsured.text(eventAssetNames(p.assetRefs)) };
    case 'stormDamage': return { title: t.events.stormDamage.title, text: t.events.stormDamage.text(eventAssetNames(p.assetRefs)) };
    case 'storm': return t.events.storm;
    case 'fishShoal': return t.events.fishShoal;
    case 'touristBoom': return t.events.touristBoom;
    case 'crisis': return t.events.crisis;
    case 'scamCollapse': return p.defId === 'oysterBeds' ? t.events.scamCollapseOysterBeds
      : p.defId === 'tideFund' ? t.events.scamCollapseTideFund : t.events.scamCollapse;
    case 'emergencyLoan': return { title: t.events.emergencyLoan.title, text: t.events.emergencyLoan.text(coins(Number(p.amount)), Number(p.rate)) };
    case 'freedom': return t.events.freedom;
    case 'dreamStage': {
      const done = dreamCopy(Number(p.finishedStage));
      const nextIndex = Number(p.nextStage);
      const next = nextIndex >= 0 ? dreamCopy(nextIndex).title : undefined;
      return { title: t.events.dreamStage.title(done.title), text: t.events.dreamStage.text(t.dream.title, next) };
    }
    case 'dreamDone': return { title: t.events.dreamDone.title, text: t.events.dreamDone.text(coins(Number(p.upkeep))) };
    case 'freedomLevel': {
      const level = Number(p.level);
      return { title: t.levels[level - 1], text: level >= 3 ? t.events.freedomLevel.text3 : t.events.freedomLevel.text2 };
    }
    case 'freedomThreat': return { title: t.events.freedomThreat.title, text: t.events.freedomThreat.text(weeks(Number(p.weeksLeft))) };
    case 'threatOver': return t.events.threatOver;
    case 'backToWork': return { title: t.events.backToWork.title, text: t.events.backToWork.text(coins(Number(p.salary))) };
    default: return { title: event.id, text: '' };
  }
}

const femaleBot = (id: string) => id === 'bot-mia';
function newsPlayer(id: string, players: readonly PlayerState[]) {
  const player = players.find((candidate) => candidate.id === id);
  if (player) return displayPlayer(player).name;
  const bot = getI18n().t.bots[id as keyof typeof ru.bots];
  return bot?.name ?? getI18n().t.meta.defaultPlayer;
}

export function newsText(item: WeekNewsItem, players: readonly PlayerState[]): string {
  if (item.kind === 'legacy') return item.legacyText;
  const { t } = getI18n();
  const name = newsPlayer(item.playerId, players);
  const female = femaleBot(item.playerId);
  switch (item.kind) {
    case 'bought': return t.news.bought(name, female, assetCopy(item.defId).accusative);
    case 'sold': return t.news.sold(name, female, assetCopy(item.defId, item.level).accusative);
    case 'upgraded': return t.news.upgraded(name, female, assetCopy(item.defId, item.fromLevel).accusative, assetCopy(item.defId, item.fromLevel + 1).title);
    case 'loan': return t.news.loan(name, female, coins(item.amount));
    case 'repaid': return t.news.repaid(name, female, coins(item.amount));
    case 'emergency': return t.news.emergency(name, female, coins(item.amount));
    case 'scam': return item.defId === 'oysterBeds' ? t.news.scamOysterBeds(name)
      : item.defId === 'tideFund' ? t.news.scamTideFund(name) : t.news.scam(name);
    case 'freedom': return item.playerId.startsWith('bot-') ? t.news.freedomBot(name, female, item.week) : t.news.freedomHuman(name, item.week);
    case 'dreamDone': return t.news.dreamDone(name);
  }
}

export function languageLabel(lang: Lang) { return lang.toUpperCase(); }

export function scamWarning(defId: string): string {
  const { t } = getI18n();
  return defId === 'oysterBeds' ? t.ui.deals.scamOysterBeds
    : defId === 'tideFund' ? t.ui.deals.scamTideFund : t.ui.deals.scam;
}
