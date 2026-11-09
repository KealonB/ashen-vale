/**
 * Ashen Vale Phase 1+2 headless tests
 */
import { readFileSync } from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataSrc = readFileSync(path.join(__dirname, "data.js"), "utf8");
const gameSrc = readFileSync(path.join(__dirname, "game.js"), "utf8");

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("  OK ", msg); }
  else { failed++; console.error("  FAIL", msg); }
}

try { new vm.Script(dataSrc); assert(true, "data.js parses"); }
catch (e) { assert(false, "data parse " + e.message); }
try { new vm.Script(gameSrc); assert(true, "game.js parses"); }
catch (e) { assert(false, "game parse " + e.message); }

const elements = new Map();
function makeEl(id) {
  if (elements.has(id)) return elements.get(id);
  const el = {
    id, style: {}, classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} },
    disabled: false, textContent: "", innerHTML: "", width: 76, height: 76,
    clientWidth: 390, clientHeight: 500, offsetWidth: 200, offsetHeight: 160,
    children: [], dataset: {},
    getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); },
    getBoundingClientRect() { return { left: 0, top: 56, width: 390, height: 500 }; },
    setPointerCapture() {}, addEventListener() {}, querySelector() { return makeEl("q"); },
    querySelectorAll() { return []; },
  };
  elements.set(id, el);
  return el;
}
const localStore = new Map();
const mockWindow = {
  devicePixelRatio: 2, AshenVale: null, AshenData: null,
  addEventListener() {}, requestAnimationFrame() { return 0; }, confirm: () => true,
  localStorage: {
    getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => localStore.set(k, String(v)),
    removeItem: (k) => localStore.delete(k),
  },
  performance: { now: () => 0 }, innerWidth: 390, innerHeight: 700,
};
const sandbox = {
  window: mockWindow,
  document: {
    getElementById: (id) => makeEl(id),
    querySelector: () => makeEl("q"),
    querySelectorAll: () => [],
    addEventListener() {},
  },
  localStorage: mockWindow.localStorage,
  performance: mockWindow.performance,
  requestAnimationFrame: mockWindow.requestAnimationFrame,
  confirm: mockWindow.confirm,
  Math, Date, JSON, console, setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox; sandbox.self = sandbox;

try {
  vm.runInNewContext(dataSrc, sandbox, { filename: "data.js" });
  vm.runInNewContext(gameSrc, sandbox, { filename: "game.js" });
  assert(!!sandbox.window.AshenVale && !!sandbox.window.AshenData, "APIs exported");
} catch (e) {
  assert(false, "load: " + e.message);
  console.error(e);
  process.exit(1);
}

const AV = sandbox.window.AshenVale;
const D = sandbox.window.AshenData;

assert(AV.SAVE_KEY === "ashenvale_save_v4", "save key v4");
assert(D.FURNITURE_DEFS.bed && D.FURNITURE_DEFS.bank_chest, "furniture defs");

const world = AV.generateWorld(99);
AV.state.props = world.props;
AV.state.creatures = world.creatures;
AV.state.lootPiles = world.lootPiles;
AV.state.interiors = sandbox.window.AshenVale.state.interiors;
AV.state.bank = [];
AV.state.shop = world.shop;
AV.state.mapId = "overworld";
AV.state.player = AV.createPlayer(world.spawn.x, world.spawn.y);

assert(Object.keys(AV.state.interiors).length >= 5, "interiors generated");
assert(world.props.some((p) => p.kind === "door" && p.enter), "outdoor doors");
assert(world.props.some((p) => p.kind === "door" && p.exit), "interior exit doors");
assert(world.props.some((p) => p.kind === "cupboard"), "interior cupboards");
assert(world.props.some((p) => p.id === "bank"), "public bank building");
assert(world.props.some((p) => p.kind === "trader"), "trader NPC");

// Map transition positions
const before = { x: AV.state.player.x, y: AV.state.player.y, map: AV.state.mapId };
const okEnter = AV.enterBuilding("b0");
assert(okEnter === true, "enterBuilding b0");
assert(AV.state.mapId === "int_b0", "mapId switched to interior");
assert(AV.state.player.y > 150 && AV.state.interiors.b0.h >= 280, "player placed inside room");
const int = AV.state.interiors.b0;
AV.exitBuilding();
assert(AV.state.mapId === "overworld", "exited to overworld");
assert(Math.abs(AV.state.player.x - int.outdoorExit.x) < 1, "exit at outdoor door X");
assert(AV.state.player.y >= int.outdoorExit.y, "exit south of door");

// Furniture placement validity
const room = { w: 360, h: 280 };
assert(AV.furnitureFits(180, 140, D.FURNITURE_DEFS.table, 0, room) === true, "furniture fits center");
assert(AV.furnitureFits(10, 10, D.FURNITURE_DEFS.table, 0, room) === false, "furniture blocked at edge");
const r1 = AV.furnitureRect(100, 100, D.FURNITURE_DEFS.bed, 0);
const r2 = AV.furnitureRect(100, 100, D.FURNITURE_DEFS.bed, 0);
assert(AV.rectsOverlap(r1, r2, 0) === true, "same rect overlaps");
const r3 = AV.furnitureRect(200, 200, D.FURNITURE_DEFS.chair, 0);
assert(AV.rectsOverlap(r1, r3, 0) === false, "far furniture no overlap");

// Place furniture inside claimed building
AV.enterBuilding("b0");
const b0 = AV.state.props.find((p) => p.id === "b0");
b0.base.claimed = true; b0.base.type = "safehouse";
AV.state.player.inv = [{ id: "plank", qty: 20 }, { id: "cloth", qty: 10 }, { id: "nails", qty: 10 }];
AV.state.player.skills.construction.level = 5;
AV.state.placeMode = { type: "bed", rot: 0 };
// clear random containers that might block
for (let i = AV.state.props.length - 1; i >= 0; i--) {
  const p = AV.state.props[i];
  if (p.mapId === "int_b0" && (p.kind === "cupboard" || p.kind === "fridge")) AV.state.props.splice(i, 1);
}
const placed = AV.placeFurnitureAt(180, 140);
assert(placed === true, "placed bed");
assert(AV.state.props.some((p) => p.kind === "furniture" && p.furniture === "bed" && p.mapId === "int_b0"), "bed on interior map");

// Bank deposit/withdraw + death persistence
AV.state.bank = [];
const inv = [{ id: "wood", qty: 10 }, { id: "coins", qty: 50 }];
assert(AV.bankDeposit(AV.state.bank, inv, "wood", 4) === 4, "deposit 4 wood");
assert(AV.invCount(inv, "wood") === 6, "inv wood left 6");
assert(AV.invCount(AV.state.bank, "wood") === 4, "bank wood 4");
assert(AV.bankWithdraw(AV.state.bank, inv, "wood", 2, 24) === 2, "withdraw 2");
assert(AV.invCount(AV.state.bank, "wood") === 2, "bank remains 2");
// Death does not clear bank
const bankSnap = AV.state.bank.map((x) => ({ ...x }));
AV.state.player.inv = [{ id: "knife", qty: 1 }];
// simulate serialize includes bank
AV.state.player = AV.createPlayer(0, 0);
AV.state.bank = bankSnap;
const ser = AV.serialize();
assert(ser.v === 4 && ser.bank && ser.bank.length >= 1, "serialize v4 with bank");
assert(ser.mapId && ser.interiors, "serialize map + interiors");

// Shop coin math
const stock = D.SHOP_STOCK_DEFAULT.map((s) => Object.assign({}, s));
const bag = [{ id: "coins", qty: 100 }];
const buy = AV.shopBuy(stock[0], bag, 100);
assert(buy.ok && buy.coins === 100 - stock[0].buy, "shop buy deducts coins");
assert(AV.invCount(bag, stock[0].id) === 1, "bought item in bag");
const sellBag = [{ id: stock[0].id, qty: 1 }, { id: "coins", qty: buy.coins }];
const sell = AV.shopSell(stock[0], sellBag, stock[0].id, buy.coins);
assert(sell.ok && sell.coins === buy.coins + stock[0].sell, "shop sell below buy price");
assert(stock[0].sell < stock[0].buy, "sell < buy");

// Migration foraging still works
const mig = AV.migrateSkills({ foraging: { level: 4, xp: 0, next: 50 } });
assert(mig.woodcutting.level === 4, "foraging migrate");

// Touch still correct
const cam = { x: 50, y: 50 };
const rect = { left: 0, top: 0, width: 200, height: 200 };
const w = AV.clientToWorld(100, 100, rect, cam, 200, 200);
assert(Math.abs(w.x - 150) < 0.01 && Math.abs(w.y - 150) < 0.01, "touch mapping intact");

const html = readFileSync(path.join(__dirname, "index.html"), "utf8");
assert(html.includes("overlay-bank") && html.includes("overlay-shop"), "bank/shop markup");
assert(html.includes("data.js?v=4"), "cache bust v4");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
