/**
 * Ashen Vale Phase 1 headless tests
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

try { new vm.Script(dataSrc, { filename: "data.js" }); assert(true, "data.js parses"); }
catch (e) { assert(false, "data.js parse: " + e.message); }
try { new vm.Script(gameSrc, { filename: "game.js" }); assert(true, "game.js parses"); }
catch (e) { assert(false, "game.js parse: " + e.message); }

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
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

try {
  vm.runInNewContext(dataSrc, sandbox, { filename: "data.js" });
  assert(!!sandbox.window.AshenData, "AshenData exported");
  vm.runInNewContext(gameSrc, sandbox, { filename: "game.js" });
  assert(!!sandbox.window.AshenVale, "AshenVale exported");
} catch (e) {
  assert(false, "load: " + e.message);
  console.error(e);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

const AV = sandbox.window.AshenVale;
const D = sandbox.window.AshenData;

// Touch conversion
const cam = { x: 100, y: 200 };
const rect = { left: 0, top: 56, width: 390, height: 500 };
const mid = AV.clientToWorld(195, 56 + 250, rect, cam, 390, 500);
assert(Math.abs(mid.x - (cam.x + 195)) < 0.01, "touch center X CSS");
assert(Math.abs(mid.y - (cam.y + 250)) < 0.01, "touch center Y CSS");
const wrong = ((100 - 0) * (390 * 2) / 390) + cam.x;
const correct = AV.clientToWorld(100, 156, rect, cam, 390, 500).x;
assert(Math.abs(correct - (100 + cam.x)) < 0.01, "not DPR-scaled");
assert(Math.abs(correct - wrong) > 50, "differs from buggy formula");

// Skills migration foraging → woodcutting
const mig = AV.migrateSkills({ foraging: { level: 5, xp: 10, next: 100 }, combat: { level: 2, xp: 0, next: 50 } });
assert(mig.woodcutting.level === 5, "foraging folds into woodcutting");
assert(mig.mining.level >= 1, "mining present after migrate");
assert(mig.ranged && mig.smithing && mig.cooking, "new skills present");
assert(mig.combat.level === 2, "combat preserved");

// Crafting recipe execution
const p = AV.createPlayer(10, 10);
p.inv = [{ id: "wood", qty: 5 }, { id: "scrap", qty: 3 }];
AV.state.player = p;
AV.state.props = [];
const r1 = AV.doCraft("plank");
assert(r1.ok === true, "craft plank succeeds");
assert(AV.invCount(p.inv, "plank") >= 2, "planks added");
assert(AV.invCount(p.inv, "wood") === 4, "wood consumed");
const blocked = AV.doCraft("shortbow");
assert(blocked.ok === false, "shortbow blocked without mats/workshop");

// recipeBlocked feedback
const needMsg = AV.recipeBlocked(D.RECIPES.find((r) => r.id === "nails"), p);
// may be null if can afford nails
p.inv = [];
const needMsg2 = AV.recipeBlocked(D.RECIPES.find((r) => r.id === "nails"), p);
assert(needMsg2 && needMsg2.includes("Need"), "missing mats message");

// Equipment armor math
const eq = AV.emptyEquip();
eq.body = "bronze_body"; eq.head = "bronze_helm";
assert(AV.armorTotal(eq) === 9, "armor total 6+3=9");
assert(AV.reduceDamage(20, 9) < 20, "armor reduces damage");
assert(AV.reduceDamage(20, 0) === 20, "0 armor no reduction (or round)");
eq.weapon = "iron_sword";
assert(AV.meleeDamage(eq) === D.ITEM_DEFS.iron_sword.dmg, "melee sword dmg");
eq.weapon = "shortbow"; eq.ammo = "iron_arrows";
assert(AV.rangedDamage(eq) === D.ITEM_DEFS.shortbow.dmg + D.ITEM_DEFS.iron_arrows.dmgBonus, "ranged dmg + ammo");

// Arrow consumption
const archer = AV.createPlayer(0, 0);
archer.inv = [{ id: "bronze_arrows", qty: 3 }];
archer.equip.ammo = "bronze_arrows";
assert(AV.consumeAmmo(archer) === true, "consume arrow");
assert(AV.invCount(archer.inv, "bronze_arrows") === 2, "arrow qty 2");
AV.consumeAmmo(archer); AV.consumeAmmo(archer);
assert(AV.invCount(archer.inv, "bronze_arrows") === 0, "arrows empty");
assert(AV.consumeAmmo(archer) === false, "no ammo fails");

// Tool tiers
const miner = AV.createPlayer(0, 0);
miner.inv = [{ id: "bronze_pick", qty: 1 }];
assert(AV.bestToolTier(miner.inv, miner.equip, "pick") === 1, "bronze pick tier 1");
miner.inv.push({ id: "steel_pick", qty: 1 });
assert(AV.bestToolTier(miner.inv, miner.equip, "pick") === 3, "steel pick tier 3");

// Creature AI flags
assert(D.CREATURE_DEFS.zombie.aggressive === true, "zombie aggressive");
assert(D.CREATURE_DEFS.rat.aggressive === true, "rat aggressive");
assert(D.CREATURE_DEFS.squirrel.aggressive === false && D.CREATURE_DEFS.squirrel.flee === true, "squirrel passive flee");
assert(D.CREATURE_DEFS.chicken.flee === true, "chicken flees");
assert(D.CREATURE_DEFS.goblin.aggressive === true, "goblin aggressive");

// World gen
const world = AV.generateWorld(7);
assert(world.props.some((x) => x.kind === "forge"), "world forge");
assert(world.props.some((x) => x.kind === "oak"), "oak trees");
assert(world.props.some((x) => x.node === "copper_rock" || x.kind === "copper_rock"), "copper rocks");
assert(world.props.some((x) => x.kind === "fish_spot"), "fish spots");
assert(world.creatures.some((c) => c.type === "goblin"), "goblins");
assert(world.creatures.some((c) => c.type === "chicken"), "chickens");
assert(world.creatures.some((c) => !c.aggressive || c.type === "squirrel" || c.type === "chicken"), "passive creatures exist");

// Serialize v3
AV.state.seed = 1; AV.state.day = 1; AV.state.dayTimer = 0; AV.state.time = 1;
AV.state.player = p; AV.state.creatures = world.creatures.slice(0, 2);
AV.state.props = world.props; AV.state.lootPiles = [];
const ser = AV.serialize();
assert(ser.v === 3, "save v3");
assert(ser.player.equip, "equip in save");
assert(ser.creatures && ser.creatures.length >= 1, "creatures in save");

// Cook burn/cook returns
const outcomes = new Set();
for (let i = 0; i < 40; i++) outcomes.add(AV.cookOutcome(1));
assert(outcomes.has("cook") || outcomes.has("burn"), "cookOutcome returns values");

const html = readFileSync(path.join(__dirname, "index.html"), "utf8");
assert(html.includes("data.js") && html.includes("btn-skills"), "HTML loads data + Skills");
assert(html.includes("context-menu"), "context menu markup");
assert(html.includes("ws-tab"), "workshop tabs");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
