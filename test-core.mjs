/**
 * Headless checks for Ashen Vale v2 — syntax, touch math, skills, base helpers.
 * Run: node test-core.mjs
 */
import { readFileSync } from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gamePath = path.join(__dirname, "game.js");
const src = readFileSync(gamePath, "utf8");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("  OK ", msg); }
  else { failed++; console.error("  FAIL", msg); }
}

try {
  new vm.Script(src, { filename: "game.js" });
  assert(true, "game.js parses (vm.Script)");
} catch (e) {
  assert(false, "game.js parse: " + e.message);
}

const elements = new Map();
function makeEl(id) {
  if (elements.has(id)) return elements.get(id);
  const el = {
    id, style: {},
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} },
    disabled: false, textContent: "", innerHTML: "", width: 76, height: 76,
    clientWidth: 390, clientHeight: 500, children: [], dataset: {},
    getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); },
    getBoundingClientRect() { return { left: 0, top: 56, width: 390, height: 500 }; },
    setPointerCapture() {}, addEventListener() {},
    querySelector() { return makeEl("q"); }, querySelectorAll() { return []; },
  };
  elements.set(id, el);
  return el;
}
const localStore = new Map();
const mockWindow = {
  devicePixelRatio: 2, AshenVale: null, addEventListener() {},
  requestAnimationFrame() { return 0; }, confirm: () => true,
  localStorage: {
    getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => localStore.set(k, String(v)),
    removeItem: (k) => localStore.delete(k),
  },
  performance: { now: () => 0 },
};
const sandbox = {
  window: mockWindow, document: {
    getElementById: (id) => makeEl(id),
    querySelector: (sel) => makeEl(sel),
    querySelectorAll: () => [],
    addEventListener() {},
  },
  localStorage: mockWindow.localStorage,
  performance: mockWindow.performance,
  requestAnimationFrame: mockWindow.requestAnimationFrame,
  confirm: mockWindow.confirm,
  Math, Date, JSON, console, setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

try {
  vm.runInNewContext(src, sandbox, { filename: "game.js" });
  assert(!!sandbox.window.AshenVale, "AshenVale API exported");
} catch (e) {
  assert(false, "load game.js: " + e.message);
  console.error(e);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

const AV = sandbox.window.AshenVale;

assert(AV.xpToNext(1) === 50, "xpToNext(1) === 50");
assert(AV.xpToNext(2) > AV.xpToNext(1), "xpToNext grows");

const inv = [];
assert(AV.invAdd(inv, "wood", 5) === true, "invAdd wood");
assert(AV.invCount(inv, "wood") === 5, "invCount wood");
assert(AV.invRemove(inv, "wood", 2) === true, "invRemove");
assert(AV.invCount(inv, "wood") === 3, "count after remove");

const p = AV.createPlayer(100, 200);
assert(p.x === 100 && p.y === 200, "createPlayer pos");
assert(p.skills.combat.level === 1, "combat 1");
assert(p.skills.construction && p.skills.construction.level === 1, "construction skill exists");
assert(AV.weaponDmg(p) === 8, "fists 8");
p.weapon = "knife";
assert(AV.weaponDmg(p) === AV.ITEM_DEFS.knife.dmg, "knife dmg");
AV.gainXp(p, "construction", 9999);
assert(p.skills.construction.level > 1, "construction levels");

const world = AV.generateWorld(42);
assert(world.props.some((x) => x.kind === "campfire"), "campfire");
assert(world.props.some((x) => x.kind === "building" && x.base), "buildings have base");
assert(world.zombies.length > 10, "zombies");
const world2 = AV.generateWorld(42);
assert(world.props.length === world2.props.length, "seeded world");

assert(AV.RECIPES.some((r) => r.id === "plank"), "plank recipe");
assert(AV.FORTIFY && AV.FORTIFY.board, "fortify defs");
assert(AV.BUILDING_TYPES.safehouse, "building types");
assert(AV.SAVE_KEY === "ashenvale_save_v2", "save key v2");
assert(!!AV.SAVE_KEY_LEGACY, "legacy save key");

const migrated = AV.migrateSkills({ combat: { level: 3, xp: 10, next: 90 } });
assert(migrated.combat.level === 3, "migrate keeps combat");
assert(migrated.construction.level === 1, "migrate adds construction");

const b = { x: 10, y: 20, w: 100, h: 80 };
assert(AV.pointInBuilding(50, 50, b) === true, "point inside building");
assert(AV.pointInBuilding(5, 5, b) === false, "point outside building");
const base = AV.defaultBase();
assert(base.claimed === false && Array.isArray(base.stash), "defaultBase shape");

// —— Screen→world conversion (DPR / camera / HUD offset) ——
const cam = { x: 100, y: 200 };
const rect = { left: 0, top: 56, width: 390, height: 500 };
const viewW = 390, viewH = 500;
// Center of canvas CSS box → cam + half view
const mid = AV.clientToWorld(195, 56 + 250, rect, cam, viewW, viewH);
assert(Math.abs(mid.x - (cam.x + viewW / 2)) < 0.01, "center tap X (CSS space)");
assert(Math.abs(mid.y - (cam.y + viewH / 2)) < 0.01, "center tap Y (CSS space)");
// Top-left of canvas
const tl = AV.clientToWorld(0, 56, rect, cam, viewW, viewH);
assert(Math.abs(tl.x - cam.x) < 0.01 && Math.abs(tl.y - cam.y) < 0.01, "top-left → cam");
// DPR must NOT scale: same client coords / same CSS rect → same world regardless of backing store
const a = AV.clientToWorld(100, 156, rect, cam, viewW, viewH);
const b2 = AV.clientToWorld(100, 156, rect, cam, viewW, viewH);
assert(a.x === b2.x && a.y === b2.y, "deterministic mapping");
// Different camera
const cam2 = { x: 500, y: 800 };
const m2 = AV.clientToWorld(195, 56 + 250, rect, cam2, viewW, viewH);
assert(Math.abs(m2.x - (500 + 195)) < 0.01, "camera offset X");
assert(Math.abs(m2.y - (800 + 250)) < 0.01, "camera offset Y");
// Scaled CSS size (rect differs from view — letterboxing-style)
const rect2 = { left: 10, top: 20, width: 195, height: 250 };
const s = AV.clientToWorld(10 + 97.5, 20 + 125, rect2, { x: 0, y: 0 }, 390, 500);
assert(Math.abs(s.x - 195) < 0.5 && Math.abs(s.y - 250) < 0.5, "rect→view scale mapping");
// Wrong old formula (backing store) would be ~2x on DPR=2; ensure we are NOT that
const wrongWouldBe = ((100 - 0) * (390 * 2) / 390) + cam.x; // dpr*css
const correct = AV.clientToWorld(100, 156, rect, cam, viewW, viewH).x;
assert(Math.abs(correct - (100 + cam.x)) < 0.01, "not backing-store scaled");
assert(Math.abs(correct - wrongWouldBe) > 50, "differs from buggy DPR*width formula");

AV.state.seed = 99; AV.state.day = 2; AV.state.dayTimer = 10; AV.state.time = 5;
AV.state.player = p;
AV.state.zombies = world.zombies.slice(0, 3);
AV.state.props = world.props;
AV.state.lootPiles = [];
AV.state.tutorialShown = true;
const ser = AV.serialize();
assert(ser.v === 2 && ser.player && ser.player.skills.construction, "serialize v2 + construction");
assert(ser.props.some((pp) => pp.kind === "building" && pp.base), "serialize building base");

const html = readFileSync(path.join(__dirname, "index.html"), "utf8");
const css = readFileSync(path.join(__dirname, "style.css"), "utf8");
assert(html.includes('id="game"') && html.includes("btn-build"), "HTML has canvas + Build");
assert(html.includes("game.js?v=2") || html.includes("game.js"), "loads game.js");
assert(css.includes("--accent") && css.includes("Georgia"), "RSC-ish CSS tokens");
assert(!html.includes("https://cdn"), "no CDN in HTML");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
