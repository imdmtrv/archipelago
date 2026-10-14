import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const url = option('--url', 'http://127.0.0.1:5187/');
const baselineUrl = option('--baseline-url', 'http://127.0.0.1:5186/');
const output = resolve(option('--output', resolve(tmpdir(), 'archipelago-launch-3-i18n')));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const channel = option('--channel', process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
await mkdir(output, { recursive: true });
const screenshotDir = resolve(output, 'screenshots');
await mkdir(screenshotDir, { recursive: true });

const screenshots = [];
const errors = [];
const CYRILLIC = /[А-Яа-яЁё]/;

function normalizeRu(text) {
  return text.split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !['RU', 'EN', 'Язык'].includes(line.trim()))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function newPage(base, { lang = 'ru', locale = 'ru-RU', width = 1366, height = 768 } = {}) {
  const context = await browser.newContext({ locale, viewport: { width, height } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${base}: ${error.message}`));
  await page.addInitScript(({ forcedLang }) => {
    Math.random = () => 0.123456789;
    try {
      localStorage.clear();
      localStorage.setItem('archipelago.coach.v1', 'done');
      if (forcedLang) localStorage.setItem('archipelago.lang.v1', forcedLang);
    } catch {}
  }, { forcedLang: lang || null });
  await page.goto(base, { waitUntil: 'networkidle' });
  return { context, page };
}

async function startGame(page, lang = 'ru', values = {}) {
  const islandLabel = lang === 'ru' ? 'Название острова' : 'Island name';
  const nameLabel = lang === 'ru' ? 'Ваше имя' : 'Your name';
  const start = lang === 'ru' ? 'Начать игру' : 'Start game';
  await page.getByLabel(islandLabel).fill(values.island ?? (lang === 'ru' ? 'Чайка' : 'Lagoon'));
  await page.getByLabel(nameLabel).fill(values.name ?? (lang === 'ru' ? 'Аня' : 'Alex'));
  await page.getByRole('button', { name: start, exact: true }).click();
  await page.locator('.hud').waitFor();
  await page.waitForTimeout(80);
}

async function waitForSnapshot(page) {
  await page.waitForFunction(() => !document.querySelector('.isl-float') && !document.querySelector('.toast'));
}

async function waitForWeekOutcome(page) {
  const handle = await page.waitForFunction(async () => {
    const { useGame } = await import('/src/store.ts');
    const state = useGame.getState();
    if (state.busy) return false;
    if (state.modal) return 'modal';
    if (state.toast) return 'toast';
    return false;
  }, null, { timeout: 5000 });
  const outcome = await handle.jsonValue();
  if (outcome === 'modal') {
    await page.locator('.modal').waitFor({ state: 'visible', timeout: 2500 });
  } else {
    const toast = page.locator('.toast');
    await toast.waitFor({ state: 'visible', timeout: 2500 });
    await toast.waitFor({ state: 'detached', timeout: 5000 });
  }
}

async function text(page) {
  await waitForSnapshot(page);
  return page.evaluate(() => {
    const tickers = [...document.querySelectorAll('.ticker')];
    const displays = tickers.map((ticker) => ticker.style.display);
    tickers.forEach((ticker) => { ticker.style.display = 'none'; });
    try { return document.body.innerText.trim(); }
    finally { tickers.forEach((ticker, index) => { ticker.style.display = displays[index]; }); }
  });
}

async function newsTexts(page) {
  return page.evaluate(async () => {
    const { useGame } = await import('/src/store.ts');
    const state = useGame.getState();
    if (!state.world) return [];
    if (state.news.every((item) => 'text' in item)) return state.news.map((item) => item.text);
    const { newsText } = await import('/src/i18n/index.ts');
    return state.news.map((item) => 'text' in item ? item.text : newsText(item, state.world.players));
  });
}

async function visibleHumanNews(page, needle) {
  const selected = await page.evaluate(async ({ expected }) => {
    const { useGame } = await import('/src/store.ts');
    const state = useGame.getState();
    if (!state.world) return false;
    let rendered = [];
    if (state.news.every((item) => 'text' in item)) rendered = state.news.map((item) => item.text);
    else {
      const { newsText } = await import('/src/i18n/index.ts');
      rendered = state.news.map((item) => 'text' in item ? item.text : newsText(item, state.world.players));
    }
    const index = rendered.findIndex((value, i) => state.news[i]?.playerId === 'p1' && value.includes(expected));
    if (index < 0) return false;
    useGame.setState({ news: [state.news[index]] });
    return true;
  }, { expected: needle });
  assert(selected, `Missing human news containing: ${needle}`);
  const ticker = page.locator('.ticker');
  await ticker.waitFor({ timeout: 2500 });
  const rendered = (await ticker.innerText()).trim();
  assert(rendered.includes(needle), `Visible human news mismatch: ${rendered}`);
  return rendered;
}

async function assertEnglish(page, label) {
  const body = await text(page);
  assert(!CYRILLIC.test(body), `${label}: Cyrillic remains in EN UI:\n${body.match(/.{0,40}[А-Яа-яЁё].{0,80}/)?.[0] ?? body}`);
  const overflow = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('.hud, .modal, .sheet')];
    const bad = [];
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (!(el instanceof HTMLElement) || !el.getClientRects().length || !(el.textContent?.trim())) continue;
        const css = getComputedStyle(el);
        if (css.textOverflow === 'ellipsis') continue;
        if (el.scrollWidth > el.clientWidth + 1) bad.push({ tag: el.tagName, cls: el.className, text: el.textContent.trim().slice(0, 80), scroll: el.scrollWidth, client: el.clientWidth });
      }
    }
    return bad.slice(0, 20);
  });
  assert.deepEqual(overflow, [], `${label}: text overflow: ${JSON.stringify(overflow)}`);
}

async function shot(page, name) {
  const path = resolve(screenshotDir, `${name}.jpg`);
  await page.screenshot({ path, type: 'jpeg', quality: 82, fullPage: false });
  screenshots.push(path);
}

async function buildScenarioBank(base) {
  const { context, page } = await newPage(base, { lang: 'ru' });
  const scenarios = await page.evaluate(async () => {
    const {
      ASSET_DEFS, applyAction, assetViews, createWorld, dreamView, financeView, offerViews,
    } = await import('/@id/@arch/engine');
    const found = {};
    const clone = (value) => structuredClone(value);
    const remember = (name, world, action, events) => {
      if (found[name]) return;
      found[name] = {
        world: clone(world),
        ...(action ? { action: clone(action) } : {}),
        ...(events ? { events: [...events] } : {}),
      };
    };
    const actionOf = (type) => ({ type, playerId: 'p1' });

    function collectActions(world) {
      for (const offer of world.offers) {
        const kind = ASSET_DEFS[offer.defId].kind;
        const action = { type: 'buyOffer', playerId: 'p1', offerUid: offer.uid };
        const result = applyAction(world, action);
        if (!result.error && kind === 'scam' && !found.scamCollapse) {
          let branch = result.world;
          for (let i = 0; i < 5; i++) {
            const next = applyAction(branch, { type: 'endWeek' }).world;
            const ids = next.lastReport?.players.p1.events.map((event) => event.id) ?? [];
            if (ids.includes('scamCollapse')) {
              remember('scamCollapse', branch, undefined, ids);
              break;
            }
            branch = next;
          }
        }
      }
      for (const asset of world.players[0].owned) {
        const action = { type: 'upgradeAsset', playerId: 'p1', assetUid: asset.uid };
        if (!found.upgradeAsset && !applyAction(world, action).error) remember('upgradeAsset', world, action);
      }
      if (!found.takeLoan) {
        const action = { type: 'takeLoan', playerId: 'p1', amount: 100 };
        if (!applyAction(world, action).error) remember('takeLoan', world, action);
      }
    }

    function tryThreatFixture(world) {
      if (found.freedomThreat || world.players[0].freedomWeek === null) return;
      let branch = clone(world);
      if (branch.players[0].employed) {
        const quit = applyAction(branch, actionOf('quitJob'));
        if (quit.error) return;
        branch = quit.world;
      }
      for (const view of assetViews(branch, 'p1').filter((item) => item.def.kind === 'asset')) {
        if (financeView(branch, 'p1').freedomRatio < 1) break;
        const sold = applyAction(branch, { type: 'sellAsset', playerId: 'p1', assetUid: view.asset.uid });
        if (!sold.error) branch = sold.world;
      }
      if (branch.players[0].employed || financeView(branch, 'p1').freedomRatio >= 1) return;
      const next = applyAction(branch, { type: 'endWeek' }).world;
      const ids = next.lastReport?.players.p1.events.map((event) => event.id) ?? [];
      if (ids.includes('freedomThreat')) remember('freedomThreat', branch, undefined, ids);
    }

    const required = ['initial', 'upgradeAsset', 'takeLoan', 'storm', 'scamCollapse', 'raise', 'freedom', 'freedomThreat', 'dreamDone'];
    for (let seed = 1; seed <= 40 && !required.every((name) => found[name]); seed++) {
      let world = createWorld({ seed, playerName: 'Аня', islandName: 'Чайка' });
      remember('initial', world);
      for (let week = 0; week < 180 && !required.every((name) => found[name]); week++) {
        collectActions(world);
        const dispatch = (action) => {
          const result = applyAction(world, action);
          if (!result.error) world = result.world;
        };
        const me = world.players[0];
        if (me.freedomWeek !== null && me.employed) dispatch(actionOf('quitJob'));
        if (dreamView(world, 'p1')?.canStart) dispatch(actionOf('buildDream'));
        for (const asset of assetViews(world, 'p1')) if (asset.asset.damaged && world.players[0].cash >= asset.repairCost) {
          dispatch({ type: 'repairAsset', playerId: 'p1', assetUid: asset.asset.uid });
        }
        if (world.players[0].knowledge < 2 && world.players[0].cash > 1000) dispatch(actionOf('study'));
        const offer = offerViews(world, 'p1')
          .filter((view) => !view.locked && !view.slotFull && !view.warning && view.def.kind === 'asset')
          .filter((view) => world.players[0].cash - view.offer.price >= 100 && (view.paybackWeeks ?? Infinity) <= 45)
          .sort((a, b) => (a.paybackWeeks ?? Infinity) - (b.paybackWeeks ?? Infinity))[0];
        if (offer) dispatch({ type: 'buyOffer', playerId: 'p1', offerUid: offer.offer.uid });
        else if (world.players[0].cash > 1500) {
          const upgrade = assetViews(world, 'p1').find((view) => view.upgrade?.canUpgrade);
          if (upgrade) dispatch({ type: 'upgradeAsset', playerId: 'p1', assetUid: upgrade.asset.uid });
        }
        if (world.players[0].happiness < 55 && world.players[0].cash >= 100) dispatch(actionOf('rest'));
        const before = world;
        world = applyAction(world, { type: 'endWeek' }).world;
        const report = world.lastReport;
        const ids = report ? [...report.worldEvents, ...report.players.p1.events].map((event) => event.id) : [];
        for (const event of ['storm', 'raise', 'freedom', 'dreamDone']) if (ids.includes(event)) remember(event, before, undefined, ids);
        tryThreatFixture(world);
      }
    }
    const missing = required.filter((name) => !found[name]);
    if (missing.length) throw new Error(`Missing i18n acceptance fixtures: ${missing.join(', ')}`);
    return found;
  });
  await context.close();
  return scenarios;
}

function scenarioMeta(bank) {
  return Object.fromEntries(Object.entries(bank).map(([name, scenario]) => [name, {
    seed: scenario.world.seed,
    week: scenario.world.week,
    action: scenario.action ?? null,
    events: scenario.events ?? null,
  }]));
}

async function scenarioPage(base, scenario) {
  const context = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${base}: ${error.message}`));
  await page.addInitScript(({ save }) => {
    Math.random = () => 0.123456789;
    localStorage.clear();
    localStorage.setItem('archipelago.coach.v1', 'done');
    localStorage.setItem('archipelago.lang.v1', 'ru');
    localStorage.setItem('archipelago.save.v1', save);
  }, { save: JSON.stringify({ world: scenario.world, news: [], history: {} }) });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.hud').waitFor();
  return { context, page };
}

async function reportIds(page) {
  return page.evaluate(async () => {
    const { useGame } = await import('/src/store.ts');
    const report = useGame.getState().world?.lastReport;
    return report ? [...report.worldEvents, ...report.players.p1.events].map((event) => event.id) : [];
  });
}

async function captureScenarioRu(base, bank) {
  const captures = {};
  const news = {};

  {
    const { context, page } = await scenarioPage(base, bank.upgradeAsset);
    await page.getByRole('tab', { name: 'Остров' }).last().click();
    await page.locator(`[data-uid="${bank.upgradeAsset.action.assetUid}"] .upgrade .btn.primary.sm`).click();
    await page.waitForTimeout(650);
    captures.upgrade = normalizeRu(await text(page));
    news.upgrade = await newsTexts(page);
    await context.close();
  }
  {
    const { context, page } = await scenarioPage(base, bank.takeLoan);
    await page.getByRole('tab', { name: 'Действия' }).last().click();
    await page.getByRole('button', { name: '+100', exact: true }).click();
    await page.locator('.action-row.loan').waitFor();
    captures.loan = normalizeRu(await text(page));
    news.loan = await newsTexts(page);
    await context.close();
  }
  for (const [name, fixture, expected] of [
    ['week:storm', 'storm', 'storm'],
    ['week:scam', 'scamCollapse', 'scamCollapse'],
    ['week:raise', 'raise', 'raise'],
  ]) {
    const { context, page } = await scenarioPage(base, bank[fixture]);
    await page.locator('[data-coach="next-week"]:visible').click();
    await page.locator('.modal.week').waitFor({ timeout: 5000 });
    assert((await reportIds(page)).includes(expected), `${name}: expected ${expected} event`);
    captures[name] = normalizeRu(await text(page));
    news[name] = await newsTexts(page);
    await context.close();
  }
  {
    const { context, page } = await scenarioPage(base, bank.freedom);
    await page.locator('[data-coach="next-week"]:visible').click();
    await page.locator('.freedom-modal').waitFor({ timeout: 5000 });
    const reached = await page.evaluate(async () => {
      const { useGame } = await import('/src/store.ts');
      return useGame.getState().world?.lastReport?.players.p1.freedomReached;
    });
    assert.equal(reached, true, 'freedom: report did not reach freedom');
    captures.freedom = normalizeRu(await text(page));
    news.freedom = await newsTexts(page);
    captures['news:freedom'] = await visibleHumanNews(page, 'финансовая свобода');
    assert.match(captures['news:freedom'], /^Аня: финансовая свобода/);
    await context.close();
  }
  {
    const { context, page } = await scenarioPage(base, bank.freedomThreat);
    await page.locator('[data-coach="next-week"]:visible').click();
    await page.locator('.modal.week').waitFor({ timeout: 5000 });
    assert((await reportIds(page)).includes('freedomThreat'), 'freedom-threat: expected freedomThreat event');
    captures['freedom-threat'] = normalizeRu(await text(page));
    news['freedom-threat'] = await newsTexts(page);
    await context.close();
  }
  {
    const { context, page } = await scenarioPage(base, bank.dreamDone);
    await page.locator('[data-coach="next-week"]:visible').click();
    await page.locator('.modal.epilogue').waitFor({ timeout: 5000 });
    assert((await reportIds(page)).includes('dreamDone'), 'epilogue: expected dreamDone event');
    captures.epilogue = normalizeRu(await text(page));
    news.epilogue = await newsTexts(page);
    captures['news:dreamDone'] = await visibleHumanNews(page, 'шхуна готова');
    assert.match(captures['news:dreamDone'], /^Аня: шхуна готова/);
    await context.close();
  }
  {
    const { context, page } = await scenarioPage(base, bank.initial);
    await page.locator('.nb-chip:not(.me):visible').first().click();
    await page.locator('.neighbor-card').waitFor();
    captures['neighbor-card'] = normalizeRu(await text(page));
    news['neighbor-card'] = await newsTexts(page);
    await context.close();
  }

  return { captures, news };
}

async function captureTabsRu(base) {
  const { context, page } = await newPage(base, { lang: 'ru', width: 390, height: 844 });
  await startGame(page, 'ru');
  const captures = {};
  for (const tab of ['Отчёт', 'Сделки', 'Остров', 'Действия']) {
    const button = page.getByRole('tab', { name: tab }).last();
    assert(await button.count(), `RU tab missing: ${tab}`);
    await button.click();
    await page.waitForTimeout(20);
    captures[`tab:${tab}`] = normalizeRu(await text(page));
  }
  await context.close();
  return captures;
}

async function captureRu(base, bank) {
  const { context, page } = await newPage(base, { lang: 'ru' });
  const captures = {};
  const news = {};
  captures.welcome = normalizeRu(await text(page));
  await startGame(page, 'ru');
  captures.game = normalizeRu(await text(page));
  news.game = await newsTexts(page);
  Object.assign(captures, await captureTabsRu(base));
  const buy = page.locator('[data-offer-uid] .btn.primary:not([disabled])').first();
  if (await buy.count()) {
    await buy.click(); await page.waitForTimeout(80);
    captures.purchase = normalizeRu(await text(page));
    news.purchase = await newsTexts(page);
  }
  const sound = page.locator('.audio-button').first();
  if (await sound.count()) {
    await sound.click(); await page.locator('.audio-panel').waitFor();
    captures.sound = normalizeRu(await text(page));
    await page.keyboard.press('Escape');
  }
  const next = page.locator('[data-coach="next-week"]:visible');
  if (await next.count()) {
    await next.click();
    await waitForWeekOutcome(page);
    captures.week = normalizeRu(await text(page));
    news.week = await newsTexts(page);
  }
  const save = await page.evaluate(() => localStorage.getItem('archipelago.save.v1'));
  await context.close();
  const scenario = await captureScenarioRu(base, bank);
  Object.assign(captures, scenario.captures);
  Object.assign(news, scenario.news);
  return { captures, news, save };
}

try {
  // RU must remain byte-for-byte in visible text, except the new language controls.
  const baselineBank = await buildScenarioBank(baselineUrl);
  const currentBank = await buildScenarioBank(url);
  assert.deepEqual(scenarioMeta(currentBank), scenarioMeta(baselineBank), 'Deterministic RU scenario banks differ');
  const baseline = await captureRu(baselineUrl, baselineBank);
  const current = await captureRu(url, currentBank);
  assert.deepEqual(Object.keys(current.captures), Object.keys(baseline.captures), 'RU parity capture sets differ');
  const ruMismatches = Object.keys(baseline.captures).filter((key) => current.captures[key] !== baseline.captures[key]);
  assert.deepEqual(Object.keys(current.news), Object.keys(baseline.news), 'RU parity news sets differ');
  const newsMismatches = Object.keys(baseline.news)
    .filter((key) => JSON.stringify(current.news[key]) !== JSON.stringify(baseline.news[key]));

  // Root precedence: saved choice beats default; root defaults to RU (browser locale ignored).
  {
    const ruBrowser = await newPage(url, { lang: null, locale: 'ru-RU' });
    assert.equal(await ruBrowser.page.evaluate(() => document.documentElement.lang), 'ru');
    await ruBrowser.context.close();
    const deBrowser = await newPage(url, { lang: null, locale: 'de-DE' });
    assert.equal(await deBrowser.page.evaluate(() => document.documentElement.lang), 'ru');
    assert(CYRILLIC.test(await text(deBrowser.page)), 'de-DE root without saved choice should render RU');
    await deBrowser.context.close();
    const savedRu = await newPage(url, { lang: 'ru', locale: 'de-DE' });
    assert.equal(await savedRu.page.evaluate(() => document.documentElement.lang), 'ru');
    await savedRu.context.close();
    const savedEn = await newPage(url, { lang: 'en', locale: 'de-DE' });
    assert.equal(await savedEn.page.evaluate(() => document.documentElement.lang), 'en');
    await savedEn.context.close();
  }

  // /en/ is always EN even if storage asks for RU.
  {
    const enPath = new URL('en/', url).href;
    const forced = await newPage(enPath, { lang: 'ru', locale: 'ru-RU' });
    assert.equal(await forced.page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await forced.page.title(), 'Archipelago — a cozy game about money and freedom');
    assert(!CYRILLIC.test(await text(forced.page)), '/en/ contains Cyrillic before game start');
    await forced.context.close();
  }

  // Full EN smoke on both acceptance viewports, including tabs/week and six screenshots.
  for (const [width, height] of [[390, 844], [1366, 768]]) {
    const { context, page } = await newPage(url, { lang: 'en', locale: 'en-US', width, height });
    await assertEnglish(page, `welcome-${width}`); await shot(page, `en-welcome-${width}`);
    await startGame(page, 'en');
    if (width === 1366) {
      const namedNews = await page.evaluate(async () => {
        const [{ useGame }, { newsText }] = await Promise.all([import('/src/store.ts'), import('/src/i18n/index.ts')]);
        const players = useGame.getState().world.players;
        return {
          freedom: newsText({ kind: 'freedom', playerId: 'p1', week: 42 }, players),
          dreamDone: newsText({ kind: 'dreamDone', playerId: 'p1', week: 42 }, players),
        };
      });
      assert.equal(namedNews.freedom, 'Alex: financial freedom in week 42!');
      assert.equal(namedNews.dreamDone, 'Alex: the schooner is ready and setting off around the world!');
    }
    await assertEnglish(page, `game-${width}`); await shot(page, `en-game-${width}`);
    const tabs = width < 1024 ? ['Report', 'Deals', 'Island', 'Actions'] : ['Deals', 'Island', 'Actions'];
    for (const tab of tabs) {
      const button = page.getByRole('tab', { name: tab }).last();
      assert(await button.count(), `EN tab missing: ${tab}`);
      await button.click(); await page.waitForTimeout(20); await assertEnglish(page, `${tab}-${width}`);
    }
    const next = page.locator('[data-coach="next-week"]:visible');
    if (await next.count()) { await next.click(); await page.waitForTimeout(1250); await assertEnglish(page, `week-${width}`); }
    await shot(page, `en-after-week-${width}`);
    await context.close();
  }

  // Switch language in place: world identity/week stays unchanged and no navigation occurs.
  {
    const { context, page } = await newPage(url, { lang: 'ru' });
    await startGame(page, 'ru', { island: 'Lagoon', name: 'Alex' });
    const before = await page.evaluate(async () => { const { useGame } = await import('/src/store.ts'); const w = useGame.getState().world; return { seed: w.seed, week: w.week, href: location.href }; });
    await page.locator('.audio-button').click();
    await page.locator('.audio-panel .language-switch button', { hasText: 'EN' }).click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.keyboard.press('Escape');
    const after = await page.evaluate(async () => { const { useGame } = await import('/src/store.ts'); const w = useGame.getState().world; return { seed: w.seed, week: w.week, href: location.href }; });
    assert.deepEqual(after, before, 'Language switch changed game or navigated');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.title(), 'Archipelago — a cozy game about money and freedom');
    await page.getByRole('button', { name: 'Next week' }).waitFor();
    assert.match(await text(page), /Deals|Island|Actions|Report/, 'System UI did not switch to English');
    await context.close();
  }

  // A v3 save with old rendered text migrates to v4 and preserves legacy event/news text.
  if (baseline.save) {
    const legacy = JSON.parse(baseline.save);
    legacy.world.version = 3;
    if (!legacy.world.lastReport) {
      legacy.world.lastReport = { week: 1, worldEvents: [], players: { p1: { playerId:'p1',salary:0,assetIncome:[],upkeep:[],living:0,interest:0,insurance:0,eventsCash:0,net:0,cashAfter:600,happinessDelta:0,events:[],lostAssetUids:[],freedomReached:false } }, news: [] };
    }
    legacy.world.lastReport.worldEvents.push({ id: 'gift', tone: 'good', title: 'Старый заголовок', text: 'Старый текст', cashDelta: 5 });
    legacy.news = [{ week: legacy.world.lastReport.week, text: 'Старая новость', playerId: 'bot-mia' }];
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${url}: ${error.message}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate((data) => { localStorage.clear(); localStorage.setItem('archipelago.coach.v1', 'done'); localStorage.setItem('archipelago.save.v1', JSON.stringify(data)); localStorage.setItem('archipelago.lang.v1', 'en'); }, legacy);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.hud').waitFor();
    const migrated = await page.evaluate(async () => { const { useGame } = await import('/src/store.ts'); const s = useGame.getState(); return { version: s.world.version, oldEvent: s.world.lastReport?.worldEvents.at(-1), news: s.news[0] }; });
    assert.equal(migrated.version, 4);
    assert.equal(migrated.oldEvent.legacyTitle, 'Старый заголовок');
    assert.equal(migrated.oldEvent.legacyText, 'Старый текст');
    assert.equal(migrated.news.text, 'Старая новость');
    await context.close();
  }

  // Dictionary variant counts are locked to the engine constants.
  {
    const { context, page } = await newPage(url, { lang: 'en' });
    const counts = await page.evaluate(async () => {
      const [engine, { ru }, { en }] = await Promise.all([import('/@id/@arch/engine'), import('/src/i18n/ru.ts'), import('/src/i18n/en.ts')]);
      return { expected: engine.EVENT_VARIANTS, ru: { breakdown: ru.events.breakdown.variants.length, gift: ru.events.gift.variants.length }, en: { breakdown: en.events.breakdown.variants.length, gift: en.events.gift.variants.length } };
    });
    assert.deepEqual(counts.ru, counts.expected); assert.deepEqual(counts.en, counts.expected);
    await context.close();
  }

  assert.deepEqual(errors, [], `Browser runtime errors: ${errors.join('; ')}`);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({
    ruScreens: Object.keys(baseline.captures),
    ruMismatches,
    newsScreens: Object.keys(baseline.news),
    newsMismatches,
    screenshots,
    runtimeErrors: errors,
  }, null, 2));
  console.log(JSON.stringify({
    ruParityScreens: Object.keys(baseline.captures).length,
    ruParityMismatches: ruMismatches,
    newsParityScreens: Object.keys(baseline.news).length,
    newsParityMismatches: newsMismatches,
    enScreenshots: screenshots.length,
    runtimeErrors: 0,
    output,
  }, null, 2));
  assert.deepEqual(ruMismatches, [], `RU parity differs at: ${ruMismatches.join(', ')}`);
  assert.deepEqual(newsMismatches, [], `RU news parity differs at: ${newsMismatches.join(', ')}`);
} finally {
  await browser.close();
}
