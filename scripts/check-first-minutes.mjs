import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const url = option('--url', 'http://127.0.0.1:5184/');
const plainUrl = option('--plain-url', url);
const output = resolve(option('--output', resolve(tmpdir(), 'archipelago-launch-2')));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const channel = option('--channel', process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
await mkdir(output, { recursive: true });

async function start(page, name = 'Аня', island = 'Тихая Гавань') {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Начать игру', exact: true }).waitFor();
  assert.equal(await page.locator('.feedback-link').count(), 1, 'Feedback link missing with VITE_FEEDBACK_URL');
  await page.getByLabel('Название острова').fill(island);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Начать игру', exact: true }).click();
  await page.locator('.hud').waitFor();
}

async function expectedBest(page) {
  return page.evaluate(async () => {
    const [{ useGame, HUMAN }, engine] = await Promise.all([import('/src/store.ts'), import('/@id/@arch/engine')]);
    const world = useGame.getState().world;
    return engine.offerViews(world, HUMAN)
      .filter((v) => v.def.kind === 'asset' && !v.locked && v.canAfford && !v.slotFull && v.paybackWeeks !== null)
      .sort((a, b) => a.paybackWeeks - b.paybackWeeks)[0]?.offer.uid ?? null;
  });
}

async function assertCoachClear(page, label) {
  const boxes = await page.evaluate(async () => {
    let previous = null;
    let repeats = 0;
    for (let frame = 0; frame < 240; frame++) {
      const bubbleEl = document.querySelector('.coach-bubble');
      const ringEl = document.querySelector('.coach-ring');
      const bubble = bubbleEl?.getBoundingClientRect();
      const ring = ringEl?.getBoundingClientRect();
      if (bubble && ring && getComputedStyle(bubbleEl).visibility === 'visible') {
        const current = {
          bubble: { left: bubble.left, top: bubble.top, right: bubble.right, bottom: bubble.bottom },
          ring: { left: ring.left, top: ring.top, right: ring.right, bottom: ring.bottom },
          viewport: { width: innerWidth, height: innerHeight },
        };
        const signature = JSON.stringify(current);
        repeats = signature === previous ? repeats + 1 : 1;
        if (repeats >= 2) return current;
        previous = signature;
      } else {
        previous = null;
        repeats = 0;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return null;
  });
  assert(boxes, `${label}: coach geometry was not identical in two consecutive visible measurements`);
  const overlap = boxes.bubble.left < boxes.ring.right
    && boxes.bubble.right > boxes.ring.left
    && boxes.bubble.top < boxes.ring.bottom
    && boxes.bubble.bottom > boxes.ring.top;
  assert(!overlap, `${label}: coach bubble overlaps target ring: ${JSON.stringify(boxes)}`);
  assert(boxes.bubble.left >= 11.5, `${label}: coach bubble is too close to left edge`);
  assert(boxes.bubble.right <= boxes.viewport.width - 11.5, `${label}: coach bubble is too close to right edge`);
}

try {
  for (const [width, height] of [[390, 844], [1366, 768]]) {
    const page = await browser.newPage({ viewport: { width, height }, locale: 'ru-RU' });
    await start(page);
    const expected = await expectedBest(page);
    assert(expected, 'Initial world must contain an eligible asset');
    await page.waitForTimeout(900);
    await page.getByRole('dialog').filter({ hasText: 'Шаг 1 из 3' }).waitFor({ timeout: 2500 });
    await assertCoachClear(page, `step 1 ${width}x${height}`);
    const target = page.locator(`[data-offer-uid="${expected}"] .btn.primary`);
    assert(await target.isVisible(), `Best offer ${expected} is not visible`);
    await page.screenshot({ path: resolve(output, `coach-1-${width}.jpg`), type: 'jpeg', quality: 82 });
    await target.click();
    await page.getByRole('dialog').filter({ hasText: 'Шаг 2 из 3' }).waitFor();
    await assertCoachClear(page, `step 2 ${width}x${height}`);
    await page.screenshot({ path: resolve(output, `coach-2-${width}.jpg`), type: 'jpeg', quality: 82 });
    await page.locator('[data-coach="next-week"]:visible').click();
    await page.waitForTimeout(1400);
    const modal = page.locator('.modal-backdrop .week');
    if (await modal.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await page.waitForFunction(async () => {
      const { useGame } = await import('/src/store.ts');
      const state = useGame.getState();
      return !state.modal && !state.toast && !state.busy;
    }, null, { timeout: 5000 });
    await page.getByRole('dialog').filter({ hasText: 'Шаг 3 из 3' }).waitFor({ timeout: 5000 });
    await assertCoachClear(page, `step 3 ${width}x${height}`);
    await page.screenshot({ path: resolve(output, `coach-3-${width}.jpg`), type: 'jpeg', quality: 82 });
    await page.getByRole('button', { name: 'Понятно', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('archipelago.coach.v1')), 'done');
    assert.equal(await page.locator('.coach-bubble').count(), 0);
    await page.close();
  }

  const skip = await browser.newPage({ locale: 'ru-RU' });
  await start(skip);
  await skip.getByText('Пропустить обучение', { exact: true }).waitFor({ timeout: 2500 });
  await skip.getByText('Пропустить обучение', { exact: true }).click();
  assert.equal(await skip.evaluate(() => localStorage.getItem('archipelago.coach.v1')), 'done');
  await skip.evaluate(() => localStorage.clear());
  await skip.reload();
  await skip.getByRole('button', { name: 'Начать игру', exact: true }).click();
  await skip.getByText('Пропустить обучение', { exact: true }).waitFor({ timeout: 2500 });
  await skip.keyboard.press('Escape');
  assert.equal(await skip.evaluate(() => localStorage.getItem('archipelago.coach.v1')), 'done');
  await skip.close();

  const loaded = await browser.newPage({ locale: 'ru-RU' });
  await start(loaded);
  await loaded.evaluate(() => localStorage.removeItem('archipelago.coach.v1'));
  await loaded.reload();
  await loaded.locator('.hud').waitFor();
  await loaded.waitForTimeout(900);
  assert.equal(await loaded.locator('.coach-bubble').count(), 0, 'Loaded save shows coach');
  await loaded.close();

  const noAsset = await browser.newPage({ locale: 'ru-RU' });
  await noAsset.goto(url);
  await noAsset.evaluate(() => localStorage.clear());
  await noAsset.reload();
  await noAsset.getByRole('button', { name: 'Начать игру', exact: true }).waitFor();
  await noAsset.evaluate(async () => {
    const [{ useGame }, { createWorld }] = await Promise.all([import('/src/store.ts'), import('/@id/@arch/engine')]);
    const world = createWorld({ seed: 123456789, playerName: 'Аня', islandName: 'Тихая Гавань' });
    world.offers = world.offers.filter((offer) => ['fountain', 'statue', 'yacht', 'garden', 'pearlFarm'].includes(offer.defId));
    useGame.setState({
      world,
      news: [],
      history: {},
      neighborId: null,
      modal: null,
      floats: [],
      weather: 'clear',
      busy: false,
      toast: null,
    });
  });
  await noAsset.getByRole('dialog').filter({ hasText: 'Шаг 2 из 3' }).waitFor({ timeout: 2500 });
  await noAsset.close();

  const shared = await browser.newPage({ locale: 'ru-RU' });
  await shared.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: (data) => { window.__shared = data; return Promise.resolve(); } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === '(pointer: coarse)' ? { ...original(query), matches: true } : original(query);
  });
  // «Поделиться» сначала рисует картинку, поэтому ждём вызова navigator.share
  const sharedData = async () => {
    await shared.waitForFunction(() => window.__shared);
    return shared.evaluate(() => { const d = window.__shared; window.__shared = null; return { title: d.title, text: d.text, url: d.url, files: (d.files || []).map((f) => f.type) }; });
  };
  await shared.goto(url); await shared.evaluate(() => localStorage.setItem('archipelago.coach.v1', 'done')); await shared.reload();
  if (!await shared.locator('.hud').count()) await shared.getByRole('button', { name: 'Начать игру', exact: true }).click();
  await shared.evaluate(async () => {
    const { useGame } = await import('/src/store.ts');
    const world = structuredClone(useGame.getState().world); world.players[0].freedomWeek = 21;
    const mine = { playerId:'p1', salary:120, assetIncome:[], upkeep:[], living:80, interest:0, insurance:0, eventsCash:0, net:40, cashAfter:700, happinessDelta:0, events:[], lostAssetUids:[], freedomReached:true };
    // Вызов записывает путь по сыгранным неделям — мир должен выглядеть как после 21-й недели
    world.week = 22; world.lastReport = { week:21, worldEvents:[], players:{p1:mine}, news:[] };
    useGame.setState({ world, modal: { report:{ week:21, worldEvents:[], players:{p1:mine}, news:[] }, events:[], freedom:true, epilogue:false } });
  });
  await shared.getByRole('button', { name: 'Поделиться результатом', exact: true }).click();
  let data = await sharedData();
  assert.equal(data.title, 'Архипелаг'); assert.match(data.text, /^Финансовая свобода за 21 неделю в «Архипелаге»/); assert.match(data.text, /на моём острове «/); assert.match(data.url, /\?c=[\w-]+$/);
  assert.deepEqual(data.files, ['image/png']);
  await shared.evaluate(async () => {
    const { useGame } = await import('/src/store.ts'); const state = useGame.getState(); const world = structuredClone(state.world);
    world.players[0].dream.doneWeek = 37; world.players[0].dream.built = 3;
    useGame.setState({ world, modal: { ...state.modal, epilogue:true } });
  });
  await shared.getByRole('button', { name: 'Поделиться результатом', exact: true }).click();
  data = await sharedData(); assert.match(data.text, /^Финансовая свобода за 21 неделю в «Архипелаге»/);
  // Отмена на телефоне не открывает окно; другая ошибка открывает все способы отправки.
  await shared.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new DOMException('Cancelled', 'AbortError')) }));
  await shared.getByRole('button', { name: 'Поделиться результатом', exact: true }).click();
  await shared.getByRole('button', { name: 'Поделиться результатом', exact: true }).waitFor({ state: 'visible' });
  await shared.waitForFunction(async () => { const { useGame } = await import('/src/store.ts'); return useGame.getState().shareFallback === null && !document.querySelector('[aria-busy="true"]'); });
  assert.equal(await shared.locator('.share-dialog').count(), 0);
  await shared.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new Error('Unsupported')) }));
  await shared.getByRole('button', { name: 'Поделиться результатом', exact: true }).click();
  await shared.locator('.share-dialog').waitFor();
  await shared.keyboard.press('Escape');
  await shared.locator('.share-dialog').waitFor({ state: 'hidden' });
  assert.equal(await shared.locator('.epilogue').count(), 1, 'Escape closed the underlying epilogue');
  await shared.close();

  const clip = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], locale: 'ru-RU' });
  const clipPage = await clip.newPage();
  await clipPage.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => { window.__nativeShare = true; return Promise.resolve(); } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === '(pointer: coarse)' ? { ...original(query), matches: false } : original(query);
  });
  await clipPage.goto(url); await clipPage.evaluate(() => localStorage.setItem('archipelago.coach.v1', 'done')); await clipPage.reload();
  if (!await clipPage.locator('.hud').count()) await clipPage.getByRole('button', { name: 'Начать игру', exact: true }).click();
  await clipPage.evaluate(async () => {
    const { useGame } = await import('/src/store.ts'); const world = structuredClone(useGame.getState().world); world.players[0].freedomWeek = 23;
    const mine={playerId:'p1',salary:0,assetIncome:[],upkeep:[],living:80,interest:0,insurance:0,eventsCash:0,net:0,cashAfter:600,happinessDelta:0,events:[],lostAssetUids:[],freedomReached:true};
    world.week = 24; world.lastReport = { week:23, worldEvents:[], players:{p1:mine}, news:[] };
    const challenge = { v:1, seed:world.seed, profession:'teacher', name:'Дима', island:'Тихая Гавань', week:26, freedomWeek:26, progress:Array(26).fill(100), moments:[] };
    useGame.setState({world,challenge,modal:{report:{week:23,worldEvents:[],players:{p1:mine},news:[]},events:[],freedom:true,epilogue:false}});
  });
  await clipPage.getByRole('button', { name: 'Поделиться результатом', exact: true }).click();
  // На компьютере системное меню не вызывается даже при поддержке отправки файлов.
  const dialog = clipPage.getByRole('dialog', { name: 'Бросить вызов другу', exact: true });
  await dialog.waitFor();
  assert.equal(await clipPage.evaluate(() => !!window.__nativeShare), false);
  await dialog.locator('img').evaluate((img) => img.decode());
  assert.deepEqual(await dialog.locator('img').evaluate((img) => [img.naturalWidth, img.naturalHeight]), [1080, 1350]);
  const content = await dialog.getByRole('textbox').inputValue();
  assert.match(content, /^Финансовая свобода за 23 недели в «Архипелаге»/);
  assert.match(content, /На 3 недели быстрее, чем Дима\./);
  assert.match(content, /\?c=[\w-]+$/);
  assert.equal(await dialog.getByRole('textbox').getAttribute('readonly'), '');
  const challengeUrl = content.split('\n').at(-1);
  for (const [name, base, urlKey, textKey] of [
    ['Telegram', 'https://t.me/share/url', 'url', 'text'],
    ['ВКонтакте', 'https://vk.com/share.php', 'url', 'title'],
    ['WhatsApp', 'https://wa.me/', null, 'text'],
  ]) {
    const href = new URL(await dialog.getByRole('link', { name, exact:true }).getAttribute('href'));
    assert.equal(href.origin + href.pathname, base);
    if (urlKey) assert.equal(href.searchParams.get(urlKey), challengeUrl);
    assert.equal(href.searchParams.get(textKey), urlKey ? content.slice(0, -(challengeUrl.length + 1)) : content);
  }
  await dialog.getByRole('button', { name: 'Скопировать ссылку', exact:true }).click();
  await clipPage.getByRole('status').filter({ hasText:'Текст со ссылкой скопирован' }).waitFor();
  // Буфер Windows отдаёт переводы строк как \r\n
  assert.equal((await clipPage.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), content);
  await dialog.getByRole('button', { name: 'Скопировать картинку', exact:true }).click();
  await clipPage.getByRole('status').filter({ hasText:'Картинка скопирована — вставьте её в чат (Ctrl+V)' }).waitFor();
  assert(await clipPage.evaluate(async () => (await navigator.clipboard.read()).some((item) => item.types.includes('image/png'))));
  const downloading = clipPage.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать картинку', exact:true }).click();
  assert.equal((await downloading).suggestedFilename(), 'archipelago-challenge.png');
  await clipPage.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable:true, value:() => Promise.reject(new Error('Denied')) });
    Object.defineProperty(navigator.clipboard, 'write', { configurable:true, value:() => Promise.reject(new Error('Denied')) });
  });
  for (const name of ['Скопировать ссылку', 'Скопировать картинку']) {
    await dialog.getByRole('button', { name, exact:true }).click();
    await clipPage.getByRole('status').filter({ hasText:'Не получилось скопировать — выделите текст в поле и скопируйте вручную' }).waitFor();
    assert.equal(await dialog.getByRole('textbox').inputValue(), content);
  }
  await clipPage.keyboard.press('Escape');
  await dialog.waitFor({ state:'hidden' });
  assert.equal(await clipPage.locator('.freedom-modal').count(), 1, 'Escape closed the underlying result');
  await clipPage.getByRole('button', { name: 'Поделиться результатом', exact: true }).click();
  await dialog.getByRole('button', { name:'Закрыть', exact:true }).click();
  await dialog.waitFor({ state:'hidden' });
  await clip.close();

  const analytics = await browser.newPage({ locale: 'ru-RU' });
  const requests = [];
  analytics.on('request', (request) => { if (request.url().includes('gc.zgo.at')) requests.push(request.url()); });
  await analytics.route('**/gc.zgo.at/count.js', (route) => route.fulfill({ contentType:'text/javascript', body:'window.goatcounter={count:(x)=>(window.__gc||(window.__gc=[])).push(x)}' }));
  await analytics.goto(url); await analytics.evaluate(() => { localStorage.clear(); }); await analytics.reload();
  await analytics.getByLabel('Название острова').fill('Секретный Остров'); await analytics.getByLabel('Ваше имя').fill('Секретное Имя');
  await analytics.getByRole('button', { name: 'Начать игру', exact: true }).click();
  await analytics.evaluate(async () => { const { useGame } = await import('/src/store.ts'); const world=structuredClone(useGame.getState().world); world.week=5; useGame.setState({world}); });
  await analytics.waitForTimeout(100);
  const gc = await analytics.evaluate(() => window.__gc || []);
  assert(gc.some((x) => x.path === 'game-start')); assert(gc.some((x) => x.path === 'week-5'));
  assert(!JSON.stringify(gc).includes('Секретный Остров') && !JSON.stringify(gc).includes('Секретное Имя'));
  assert(requests.length > 0, 'Configured GoatCounter script was not requested');
  await analytics.close();

  const plain = await browser.newPage({ locale: 'ru-RU' }); const plainRequests=[]; plain.on('request',(r)=>{if(r.url().includes('gc.zgo.at'))plainRequests.push(r.url());});
  await plain.goto(plainUrl); await plain.waitForTimeout(300);
  assert.equal(plainRequests.length,0,'GoatCounter requested without env');
  assert.equal(await plain.locator('.feedback-link').count(), 0, 'Feedback link visible without VITE_FEEDBACK_URL');
  await plain.close();

  console.log(`First-minutes check passed; screenshots: ${output}`);
} finally { await browser.close(); }
