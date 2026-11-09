/**
 * Headless Chromium regression: load scripts, New Game / Continue, catch console errors.
 * Usage: node test-browser.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".mjs": "text/javascript", ".md": "text/markdown",
};

function makeV3FromTemplate(extra = {}) {
  // Minimal valid-shaped save; harness will prefer generating via page when possible
  return Object.assign({
    v: 3, seed: 1, day: 1, dayTimer: 0, time: 0, tutorialShown: true,
    player: {
      x: 1400, y: 1400, hp: 100, maxHp: 100, hunger: 100,
      inv: [{ id: "coins", qty: 15 }, { id: "wood", qty: 3 }],
      skills: { combat: { level: 2, xp: 0, next: 80 } },
      equip: { head: null, body: null, legs: null, feet: null, hands: null, weapon: "knife", offhand: null },
      kills: 0,
    },
    creatures: [], props: [
      { kind: "building", id: "b1", mapId: "overworld", x: 1300, y: 1300, w: 90, h: 90, solid: true,
        base: { claimed: false, type: "none", wallHp: 0, wallMax: 0, boarded: false, doorReinforced: false, braced: false, stash: [] } },
      { kind: "campfire", mapId: "overworld", x: 1400, y: 1450, r: 18, solid: false, cook: true },
    ],
    lootPiles: [],
  }, extra);
}

async function withLocalServer(fn) {
  const server = createServer((req, res) => {
    let u = decodeURIComponent((req.url || "/").split("?")[0]);
    if (u === "/") u = "/index.html";
    const file = join(__dirname, u.replace(/^\//, ""));
    if (!existsSync(file)) { res.writeHead(404); res.end("missing"); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "text/plain" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}/index.html?v=harness`); }
  finally { server.close(); }
}

async function runCase(browser, label, url, { storage, click } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console:" + msg.text());
  });
  if (storage) {
    await context.addInitScript((entries) => {
      for (const [k, v] of Object.entries(entries)) {
        localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      }
    }, storage);
  }
  page.on("dialog", async (d) => { await d.accept(); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(400);

  if (click === "continue") {
    await page.locator("#btn-continue").click();
  } else {
    await page.locator("#btn-new").click();
  }
  await page.waitForTimeout(1000);

  const info = await page.evaluate(() => {
    const av = window.AshenVale || window.__AV;
    const title = document.getElementById("title-screen");
    const canvas = document.getElementById("game");
    // sample a pixel roughly center of canvas
    let pixel = null;
    try {
      const ctx = canvas.getContext("2d");
      // can't read after game draws easily if tainted; just report sizes
      pixel = { w: canvas.width, h: canvas.height };
    } catch (e) {}
    return {
      titleHidden: !!(title && title.classList.contains("hidden")),
      running: !!(av && av.state && av.state.running),
      hasPlayer: !!(av && av.state && av.state.player),
      clamp: typeof (av && av.clamp),
      bootErrorShown: (() => {
        const el = document.getElementById("boot-error");
        return el && !el.hidden && !!(el.textContent || "").trim();
      })(),
      canvas: pixel,
    };
  });

  await context.close();
  const fatal = errors.filter((e) => /ReferenceError|TypeError|SyntaxError/i.test(e));
  return { label, info, errors, fatal, ok: fatal.length === 0 && info.running && info.hasPlayer && info.titleHidden };
}

const argUrl = process.argv[2];
const browser = await chromium.launch({ headless: true });
const results = [];

async function suite(base) {
  results.push(await runCase(browser, "fresh-new@" + base, base, { click: "new" }));
  results.push(await runCase(browser, "v3-continue@" + base, base, {
    click: "continue",
    storage: { ashenvale_save_v3: makeV3FromTemplate() },
  }));
  results.push(await runCase(browser, "v2-continue@" + base, base, {
    click: "continue",
    storage: { ashenvale_save_v2: makeV3FromTemplate({ v: 2 }) },
  }));
}

if (argUrl) await suite(argUrl);
else await withLocalServer(suite);

await browser.close();

let failed = 0;
for (const r of results) {
  const status = r.ok ? "OK" : "FAIL";
  if (!r.ok) failed++;
  console.log(status, r.label, JSON.stringify({ info: r.info, fatal: r.fatal, errors: r.errors.slice(0, 5) }));
}
console.log(failed ? `\n${failed} browser case(s) failed` : `\n${results.length} browser cases passed`);
process.exit(failed ? 1 : 0);
