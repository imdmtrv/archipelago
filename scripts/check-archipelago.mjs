// Приёмка экрана архипелага (docs/specs/archipelago-screen.md, «Приёмка»): 1366×768, 390×844, 360×640 и без WebGL.
// Запуск: node scripts/check-archipelago.mjs --url http://localhost:5173/ [--shots <папка>]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const url = option('--url', 'http://localhost:5173/');
const shots = resolve(option('--shots', resolve(tmpdir(), 'archipelago-arch')));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const channel = option('--channel', process.platform === 'win32' ? 'msedge' : undefined);
await mkdir(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

async function start(page) {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Начать игру', exact: true }).waitFor();
  await page.getByLabel('Название острова').fill('Тихая Гавань');
  await page.getByLabel('Ваше имя').fill('Аня');
  await page.getByRole('button', { name: 'Начать игру', exact: true }).click();
  await page.locator('.hud').waitFor();
}

/** Подставить в мир доход, чтобы свобода человека была ratio; cash — наличные. */
async function setFreedom(page, ratio, cash) {
  await page.evaluate(async ({ ratio, cash }) => {
    const [{ useGame, HUMAN }, E] = await Promise.all([import('/src/store.ts'), import('/@id/@arch/engine')]);
    const world = structuredClone(useGame.getState().world);
    const me = world.players.find((p) => p.id === HUMAN);
    me.owned = me.owned.filter((a) => a.uid !== 'test-income');
    me.owned.push({ uid: 'test-income', defId: 'deposit', boughtWeek: 1, price: 0, income: 0, upkeep: 0, level: 1, damaged: false, slotIndex: 99 });
    const fin = E.financeView(world, HUMAN);
    me.owned.at(-1).income = Math.ceil((ratio * fin.expenses.total - fin.passiveIncome) / (me.knowledge >= 2 ? 1.1 : 1)) + 5;
    if (me.freedomWeek === null) { me.freedomWeek = world.week; me.bestLevel = 1; }
    if (cash !== undefined) me.cash = cash;
    useGame.setState({ world });
  }, { ratio, cash });
}

const store = (page, fn, arg) => page.evaluate(async ({ fn, arg }) => {
  const [{ useGame, HUMAN }, E] = await Promise.all([import('/src/store.ts'), import('/@id/@arch/engine')]);
  return new Function('useGame', 'HUMAN', 'E', 'arg', `return (${fn})(useGame, HUMAN, E, arg)`)(useGame, HUMAN, E, arg);
}, { fn: fn.toString(), arg });

async function nextWeek(page) {
  await page.locator('.next-main').first().click();
  for (let i = 0; i < 60; i++) {
    const st = await store(page, (s) => ({ busy: s.getState().busy, modal: !!s.getState().modal }));
    if (!st.busy && !st.modal) break;
    if (!st.busy && st.modal) await page.locator('.modal').getByRole('button', { name: /Дальше|Продолжить|Понятно/ }).first().click().catch(() => {});
    await page.waitForTimeout(250);
  }
}

const card = (page, island) => page.locator('.arch-card').filter({ hasText: island });
async function expand(page, island) {
  const c = card(page, island);
  if (!(await c.getAttribute('class')).includes('expanded')) await c.locator('.arch-card-summary').click();
  return c;
}
const cameraFlag = (page) => page.evaluate(() => document.documentElement.dataset.archCamera ?? '');
async function waitCamera(page, value) {
  for (let i = 0; i < 40; i++) { if (await cameraFlag(page) === value) return true; await page.waitForTimeout(100); }
  return false;
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function moneyCellsOk(page) {
  return page.evaluate(() => [...document.querySelectorAll('.arch-card.expanded .arch-cells')].every((c) => c.children.length <= 3));
}

async function flow(size, label, { webgl = true, shot = null } = {}) {
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}),
    args: webgl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-webgl', '--disable-3d-apis'] });
  const page = await browser.newPage({ viewport: size, reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const tag = (s) => `[${label}] ${s}`;
  try {
    await start(page);
    // 1. После свободы — строка-обещание и замок.
    await setFreedom(page, 1.2);
    await page.waitForTimeout(200);
    const promise = await page.getByText(/Архипелаг откроется при 150%/).count();
    const locked = await page.locator('.arch-toggle').first().isDisabled().catch(() => false);
    check(tag('1. обещание и замок'), promise > 0 && locked, `строк ${promise}, замок ${locked}`);
    // 2. На 150% — окно, режим, камера, подсказка.
    await setFreedom(page, 1.7, 30000);
    await nextWeek(page);
    if (process.env.ARCH_DEBUG) console.log(label, await store(page, (s) => ({ week: s.getState().world.week, arch: !!s.getState().world.archipelago,
      modal: !!s.getState().modal, notice: s.getState().archNotice, busy: s.getState().busy, h2: [...document.querySelectorAll('.modal h2')].map((h) => h.textContent) })));
    const intro = page.locator('.arch-milestone');
    await intro.waitFor({ timeout: 8000 }).catch(() => {});
    const introOk = await intro.getByText('Архипелаг открыт').count();
    await page.getByRole('button', { name: 'Посмотреть архипелаг' }).click().catch(() => {});
    const mode = await store(page, (s) => s.getState().archMode);
    const cam = webgl ? await waitCamera(page, 'overview') : true;
    const hint = await page.locator('.arch-first-route:visible').count();
    check(tag('2. окно, режим, камера, подсказка'), introOk > 0 && mode && cam && hint > 0, `окно ${introOk}, режим ${mode}, камера ${await cameraFlag(page)}, подсказка ${hint}`);
    // 3. Паром → дело.
    await store(page, (s, H) => { const w = structuredClone(s.getState().world); w.players[0].cash = 30000; s.setState({ world: w }); });
    let c = await expand(page, 'Маяк');
    await c.getByRole('button', { name: /Провести паром/ }).click();
    c = await expand(page, 'Маяк');
    const cash0 = await store(page, (s) => s.getState().world.players[0].cash);
    await c.getByRole('button', { name: /Построить за/ }).click();
    const cash1 = await store(page, (s) => s.getState().world.players[0].cash);
    const head = await page.locator('.arch-head').first().innerText();
    const gold = webgl ? await page.locator('.isl-arch-label.isl-arch-mine').count() : 1;
    check(tag('3. паром → дело'), cash1 < cash0 && /1 из 3/.test(head) && gold > 0, `монеты ${cash0}→${cash1}, шапка «${head.replace(/\s+/g, ' ')}», золотых меток ${gold}`);
    // 6. Партнёрство: «Подумаю» закрывает окно, значок остаётся.
    await store(page, (s, H, E) => {
      const w = structuredClone(s.getState().world); const me = w.players[0];
      me.choice = { uid: 'test-partner', kind: 'partner', week: w.week, expiresWeek: w.week + 3, params: { botId: 'bot-mia', business: 'hotel' } };
      w.archipelago.routes = [...new Set([...w.archipelago.routes, 'shell'])];
      s.setState({ world: w, choiceOpen: true });
    });
    const later = page.getByRole('button', { name: /Подумаю/ });
    await later.waitFor({ timeout: 4000 }).catch(() => {});
    const hadLater = await later.count();
    if (hadLater) await later.click();
    const modalGone = (await page.getByRole('button', { name: /Подумаю/ }).count()) === 0;
    await store(page, (s) => s.getState().setArchMode(false));
    await nextWeek(page);
    await store(page, (s) => s.getState().setArchMode(true));
    const dot = await store(page, (s, H, E) => s.getState().world.players[0].choice?.kind === 'partner'
      && !!E.archipelagoView(s.getState().world, H)?.attention && !s.getState().choiceOpen);
    check(tag('6. «Подумаю» закрывает, через неделю предложение и значок на месте'), hadLater > 0 && modalGone && dot, `кнопка ${hadLater}, окно закрыто ${modalGone}, значок ${dot}`);
    await store(page, (s) => { const w = structuredClone(s.getState().world); w.players[0].choice = null; s.setState({ world: w, choiceOpen: false }); });
    // 5 и 4. Набор 3/3 (рыбная связка), четвёртое дело — лимит.
    for (const island of ['Кедровый', 'Пеликан']) {
      c = await expand(page, island);
      await c.getByRole('button', { name: /Провести паром/ }).click();
      c = await expand(page, island);
      await c.getByRole('button', { name: /Построить/ }).click();
    }
    const setActive = await page.locator('.arch-sets .active').count();
    const bonusOk = await store(page, (s, H, E) => {
      const v = E.archipelagoView(s.getState().world, H); return v.sets.find((x) => x.id === 'fishing').active;
    });
    check(tag('5. набор 3/3 — золотая плашка'), setActive > 0 && bonusOk, `плашек ${setActive}`);
    c = await expand(page, 'Ракушка');
    const fourth = c.getByRole('button', { name: /У вас уже 3 дела из 3/ });
    check(tag('4. четвёртое дело — лимит'), (await fourth.count()) > 0 && await fourth.isDisabled(), await c.locator('button.btn.primary').first().innerText().catch(() => ''));
    // 8. Не больше трёх денежных ячеек; на телефоне раскрыта одна карточка.
    const expanded = await page.locator('.arch-card.expanded').count();
    check(tag('8. ≤3 числа, одна раскрытая карточка'), await moneyCellsOk(page) && (size.width > 700 || expanded === 1), `раскрыто ${expanded}`);
    if (shot === 'card') await page.screenshot({ path: resolve(shots, `${label}-card.png`), scale: 'css' });
    // 9. Подлёт к острову и обратно.
    if (webgl) {
      const lbl = page.locator('.isl-arch-label').filter({ hasText: 'Пеликан' }).first();
      // На телефоне метки под шторкой — к острову подлетают нажатием на его карточку.
      if (size.width < 700) await card(page, 'Пеликан').locator('.arch-card-summary').click();
      else await lbl.click();
      const flew = await waitCamera(page, 'pelican');
      await page.waitForTimeout(300);
      if (shot === 'island') await page.screenshot({ path: resolve(shots, `${label}-island.png`), scale: 'css' });
      await page.getByRole('button', { name: '← Весь архипелаг' }).first().click();
      const back = await waitCamera(page, 'overview');
      check(tag('9. подлёт к острову и обратно'), flew && back, `флаг ${await cameraFlag(page)}`);
      if (shot === 'overview') await page.screenshot({ path: resolve(shots, `${label}-overview.png`), scale: 'css' });
    } else {
      const map = await page.locator('.arch-map').count();
      check(tag('7. без WebGL — схема и действия'), map > 0 && /3 из 3/.test(await page.locator('.arch-head').first().innerText()), `схема ${map}`);
      if (shot === 'nowebgl') await page.screenshot({ path: resolve(shots, `${label}-nowebgl.png`), scale: 'css' });
    }
    // Отчёт недели: строки архипелага.
    await store(page, (s) => s.getState().setArchMode(false));
    await nextWeek(page);
    const reportLine = await store(page, (s) => s.getState().world.lastReport.players.p1.arch);
    check(tag('отчёт недели: строка «Дела архипелага» с бонусом'), !!reportLine && reportLine.businesses > 0, JSON.stringify(reportLine ?? null).slice(0, 120));
    check(tag('без горизонтальной прокрутки'), await noHScroll(page));
    check(tag('без ошибок на странице'), errors.length === 0, errors[0] ?? '');
  } catch (e) {
    check(tag('сценарий дошёл до конца'), false, String(e).split('\n')[0]);
  } finally {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await browser.close();
  }
}

const only = option('--only', '');
const runs = [
  [{ width: 1366, height: 768 }, 'desktop', { shot: 'overview' }],
  [{ width: 390, height: 844 }, 'phone390', { shot: 'card' }],
  [{ width: 360, height: 640 }, 'phone360', { shot: 'island' }],
  [{ width: 1366, height: 768 }, 'nowebgl', { webgl: false, shot: 'nowebgl' }],
];
for (const [size, label, opts] of runs) if (!only || only === label) await flow(size, label, opts);
console.log(results.join('\n'));
console.log(`Снимки: ${shots}`);
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
