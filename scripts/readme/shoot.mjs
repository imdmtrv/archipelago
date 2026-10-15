// Скриншоты для README из production-сборки: компьютер (середина партии, мечта) и три экрана телефона.
// npm run readme:shots  (нужны: сборка в apps/web/dist, `vite preview` на --url, Playwright и Edge)
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = option('--url', 'http://localhost:4173/');
const out = resolve(option('--out', join(root, 'docs/media')));
const saves = JSON.parse(await readFile(option('--saves', join(tmpdir(), 'archipelago-readme-saves.json')), 'utf8'));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const desktop = { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1.25 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });

/** Страница игры с готовым сохранением; обучение и анкета уже пройдены. */
async function open(lang, ctxOptions, save) {
  const ctx = await browser.newContext({ locale: lang === 'en' ? 'en-US' : 'ru-RU', ...ctxOptions });
  await ctx.route('**/count.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await ctx.addInitScript(([lang, save]) => {
    localStorage.setItem('archipelago.lang.v1', lang);
    localStorage.setItem('archipelago.coach.v1', 'done');
    localStorage.setItem('archipelago.feedback.v1', 'done');
    if (save) localStorage.setItem('archipelago.save.v1', save);
  }, [lang, save ? JSON.stringify(save) : null]);
  const page = await ctx.newPage();
  await page.goto(base + (lang === 'en' ? 'en/' : ''));
  return page;
}

/** Камера долетает до острова, вода и облака в движении. */
const settle = (page) => page.waitForTimeout(5000);

const shots = [];
for (const lang of ['ru', 'en']) {
  const s = saves[lang];
  for (const [name, save] of [['hero', s.mid], ['dream', s.dream]]) {
    const page = await open(lang, desktop, save);
    await page.locator('.next-main').first().waitFor();
    await settle(page);
    const path = join(out, `${name}-${lang}.jpg`);
    await page.screenshot({ path, type: 'jpeg', quality: 84 });
    shots.push(path);
    await page.context().close();
  }

  const phones = [];
  {
    const page = await open(lang, phone, null);
    await page.locator('button.btn.primary.big').first().waitFor();
    await settle(page);
    phones.push(await page.screenshot({ type: 'png' }));
    await page.context().close();
  }
  {
    const page = await open(lang, phone, s.mid);
    await page.locator('.next-main').first().waitFor();
    await settle(page);
    phones.push(await page.screenshot({ type: 'png' }));
    await page.context().close();
  }
  {
    const page = await open(lang, phone, s.choice);
    await page.locator('.next-main').first().click();
    await page.waitForTimeout(3800); // тост «Сначала решите…» уходит
    await settle(page);
    phones.push(await page.screenshot({ type: 'png' }));
    await page.context().close();
  }

  // Три телефона рядом на светлом фоне.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const img = (buf) => `<img src="data:image/png;base64,${buf.toString('base64')}">`;
  await page.setContent(`<!doctype html><style>
    html, body { margin: 0; height: 100%; }
    body { display: flex; gap: 48px; align-items: center; justify-content: center;
      background: linear-gradient(160deg, #fdf6e9 0%, #e3f1ee 100%); }
    img { width: 340px; border-radius: 34px; box-shadow: 0 24px 60px rgba(31, 42, 68, .22), 0 0 0 8px #1f2a44; }
  </style>${phones.map(img).join('')}`);
  await page.waitForTimeout(300);
  const path = join(out, `phones-${lang}.jpg`);
  await page.screenshot({ path, type: 'jpeg', quality: 86 });
  shots.push(path);
  await ctx.close();
}

await browser.close();
console.log(shots.map((p) => p.replace(root, '.')).join('\n'));
