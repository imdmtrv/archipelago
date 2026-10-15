// Сохранения для скриншотов README: партия бота-«разумного» игрока, из которой берутся три момента.
// npx tsx scripts/readme/saves.ts [выход.json]  →  { ru: { mid, choice, dream }, en: { … } }
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSET_DEFS, applyAction, createWorld, financeView, getPlayer, offerViews,
  type ProfessionId, type WeekNewsItem, type WorldState,
} from '@arch/engine';
import { runBotTurn } from '../../packages/engine/src/bots';
import { SECOND_ACT_POLICIES } from '../../packages/engine/scripts/policies';

type NewsItem = { week: number } & WeekNewsItem;
type History = Record<string, { week: number; ratio: number }[]>;
interface Save { world: WorldState; news: NewsItem[]; history: History; moments: []; challenge: null; boughtDefIds: string[] }

const output = process.argv[2] ?? join(tmpdir(), 'archipelago-readme-saves.json');
const PROFESSION: ProfessionId = 'captain';
const [, hero] = SECOND_ACT_POLICIES[0]; // «остался на работе»: копит и после свободы строит мечту

const placed = (world: WorldState) => getPlayer(world, 'p1').owned.filter((a) => ASSET_DEFS[a.defId].slot !== 'finance');
const ratio = (world: WorldState) => financeView(world, 'p1').freedomRatio;

function advance(save: Save): Save {
  const result = applyAction(save.world, { type: 'endWeek' });
  if (result.error || !result.world.lastReport) throw new Error(`endWeek failed at ${save.world.week}`);
  const report = result.world.lastReport;
  const history: History = { ...save.history };
  for (const p of result.world.players) {
    const value = Math.round(financeView(result.world, p.id).freedomRatio * 1000) / 1000;
    history[p.id] = [...(history[p.id] ?? []).filter((pt) => pt.week < report.week), { week: report.week, ratio: value }];
  }
  return {
    ...save,
    world: result.world,
    news: [...report.news.map((item) => ({ week: report.week, ...item })), ...save.news].slice(0, 80),
    history,
    boughtDefIds: [...new Set([...save.boughtDefIds, ...getPlayer(result.world, 'p1').owned.map((a) => a.defId)])],
  };
}

/** Состояния в начале недели — как их видит игрок после «Следующая неделя». */
function play(seed: number, playerName: string, islandName: string, weeks = 90): Save[] {
  let save: Save = {
    world: createWorld({ seed, playerName, islandName, profession: PROFESSION }),
    news: [], history: {}, moments: [], challenge: null, boughtDefIds: [],
  };
  const states: Save[] = [];
  for (let w = 1; w <= weeks; w++) {
    // Развилка появляется после конца недели: снимок с ней берётся до хода бота, который её решит.
    const turn = runBotTurn(save.world, 'p1', hero);
    if (turn.errors.length) throw new Error(`seed ${seed}, week ${w}: ${turn.errors.join('; ')}`);
    save = advance({ ...save, world: turn.world });
    states.push(structuredClone(save));
  }
  return states;
}

function pick(states: Save[]) {
  const mid = states.find((s) => {
    const items = placed(s.world), r = ratio(s.world);
    return r >= 0.55 && r <= 0.8 && items.length >= 7 && new Set(items.map((a) => a.defId)).size >= 4
      && items.some((a) => a.defId === 'boat') && !getPlayer(s.world, 'p1').choice && getPlayer(s.world, 'p1').freedomWeek === null
      // В колонке сделок сверху — актив: главный кадр показывает выбор, а не только «безделушки».
      && offerViews(s.world, 'p1')[0]?.def.kind === 'asset';
  });
  const choice = states.find((s) => getPlayer(s.world, 'p1').choice?.kind === 'neighborLoan' && placed(s.world).length >= 4);
  const dream = states.find((s) => {
    const d = getPlayer(s.world, 'p1').dream;
    return !!d && d.built >= 2 && d.doneWeek === null && !getPlayer(s.world, 'p1').choice && ratio(s.world) >= 1.05;
  });
  return mid && choice && dream ? { mid, choice, dream } : null;
}

let found: { seed: number; ru: ReturnType<typeof pick>; en: ReturnType<typeof pick> } | null = null;
for (let seed = 1; seed <= 2000 && !found; seed++) {
  const ru = pick(play(seed, 'Вы', 'Лагуна'));
  if (!ru) continue;
  // Тот же seed и те же решения: английская партия совпадает с русской до имён.
  found = { seed, ru, en: pick(play(seed, 'You', 'Lagoon')) };
}
if (!found?.ru || !found.en) throw new Error('Не нашёлся seed со всеми тремя моментами');
writeFileSync(output, JSON.stringify({ ru: found.ru, en: found.en }));
const info = (s: Save) => ({ week: s.world.week, ratio: +ratio(s.world).toFixed(2), items: placed(s.world).length });
console.log(JSON.stringify({ output, seed: found.seed,
  mid: info(found.ru.mid), choice: info(found.ru.choice), dream: { ...info(found.ru.dream), built: getPlayer(found.ru.dream.world, 'p1').dream?.built } }));
