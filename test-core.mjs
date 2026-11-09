/**
 * Headless checks for Ashen Vale — syntax + core state helpers.
 * Does not drive a browser. Run: node test-core.mjs
 */
import { readFileSync } from "fs";
import { pathToFileURL } from "url";
import { createRequire } from "module";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gamePath = path.join(__dirname, "game.js");
const src = readFileSync(gamePath, "utf8");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  OK ", msg);
  } else {
    failed++;
    console.error("  FAIL", msg);
  }
}

// —— 1) Syntax via Function / vm compile ——
try {
  new vm.Script(src, { filename: "game.js" });
  assert(true, "game.js parses (vm.Script)");
} catch (e) {
  assert(false, "game.js parse: " + e.message);
}

// —— 2) Load with DOM mocks ——
const elements = new Map();
function makeEl(id) {
  if (elements.has(id)) return elements.get(id);
  const el = {
    id,
    style: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    disabled: false,
    textContent: "",
    innerHTML: "",
    value: "",
    width: 72,
    height: 72,
    clientWidth: 390,
    clientHeight: 500,
    children: [],
    dataset: {},
    getContext() {
      return new Proxy({}, { get: () => () => {}, set: () => true });
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 390, height: 500 };
    },
    setPointerCapture() {},
    addEventListener() {},
    querySelector() { return makeEl("q"); },
    querySelectorAll() { return []; },
  };
  elements.set(id, el);
  return el;
}

const localStore = new Map();
const mockWindow = {
  devicePixelRatio: 1,
  AshenVale: null,
  addEventListener() {},
  requestAnimationFrame(cb) { return 0; },
  confirm: () => true,
  localStorage: {
    getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => localStore.set(k, String(v)),
    removeItem: (k) => localStore.delete(k),
  },
  performance: { now: () => 0 },
};

const mockDocument = {
  getElementById: (id) => makeEl(id),
  querySelector: (sel) => makeEl(sel),
  querySelectorAll: () => [],
  addEventListener() {},
};

const sandbox = {
  window: mockWindow,
  document: mockDocument,
  localStorage: mockWindow.localStorage,
  performance: mockWindow.performance,
  requestAnimationFrame: mockWindow.requestAnimationFrame,
  confirm: mockWindow.confirm,
  Math,
  Date,
  JSON,
  console,
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

try {
  vm.runInNewContext(src, sandbox, { filename: "game.js" });
  assert(!!sandbox.window.AshenVale, "AshenVale API exported on window");
} catch (e) {
  assert(false, "load game.js in vm: " + e.message);
  console.error(e);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

const AV = sandbox.window.AshenVale;

// —— 3) Core helpers ——
assert(AV.xpToNext(1) === 50, "xpToNext(1) === 50");
assert(AV.xpToNext(2) > AV.xpToNext(1), "xpToNext grows with level");

const inv = [];
assert(AV.invAdd(inv, "wood", 5) === true, "invAdd wood×5");
assert(AV.invCount(inv, "wood") === 5, "invCount wood === 5");
assert(AV.invRemove(inv, "wood", 2) === true, "invRemove wood×2");
assert(AV.invCount(inv, "wood") === 3, "invCount wood === 3 after remove");

const p = AV.createPlayer(100, 200);
assert(p.x === 100 && p.y === 200, "createPlayer position");
assert(p.skills.combat.level === 1, "starter combat level 1");
assert(p.inv.length >= 1, "starter inventory not empty");
assert(AV.weaponDmg(p) === 8, "fists damage 8");
p.weapon = "knife";
assert(AV.weaponDmg(p) === AV.ITEM_DEFS.knife.dmg, "knife damage from def");

AV.gainXp(p, "combat", 9999);
assert(p.skills.combat.level > 1, "gainXp levels combat");

const world = AV.generateWorld(42);
assert(world.props.some((x) => x.kind === "campfire"), "world has campfire");
assert(world.props.some((x) => x.kind === "building"), "world has buildings");
assert(world.props.some((x) => x.kind === "tree"), "world has trees");
assert(world.zombies.length > 10, "world has zombies");
assert(world.spawn && world.spawn.x > 0, "world has spawn");

const world2 = AV.generateWorld(42);
assert(
  world.props.length === world2.props.length &&
    world.zombies.length === world2.zombies.length,
  "same seed → same world sizes"
);

assert(AV.RECIPES.length >= 3, "recipes defined");
assert(AV.WORLD_W === 2400 && AV.WORLD_H === 2400, "world size constants");

// Serialize shape with a minimal state poke
AV.state.seed = 99;
AV.state.day = 2;
AV.state.dayTimer = 10;
AV.state.time = 5;
AV.state.player = p;
AV.state.zombies = world.zombies.slice(0, 3);
AV.state.props = world.props;
AV.state.lootPiles = [];
AV.state.tutorialShown = true;
const ser = AV.serialize();
assert(ser.v === 1 && ser.player && ser.player.skills, "serialize produces v1 save");
assert(typeof ser.seed === "number", "serialize includes seed");

// HTML / CSS presence
const html = readFileSync(path.join(__dirname, "index.html"), "utf8");
const css = readFileSync(path.join(__dirname, "style.css"), "utf8");
assert(html.includes('id="game"'), "index.html has canvas#game");
assert(html.includes("game.js"), "index.html loads game.js");
assert(css.includes("--accent"), "style.css has design tokens");
assert(!html.includes("http://") && !html.includes("https://cdn"), "no CDN deps in HTML");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
