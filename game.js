/**
 * Ashen Vale Phase 1+2 — STATE / UPDATE / RENDER
 * Depends on data.js (window.AshenData)
 */
(function () {
  "use strict";
  const D = window.AshenData;
  const {
    SAVE_KEY, SAVE_KEY_LEGACY, SKILL_NAMES, SKILL_LABELS, EQUIP_SLOTS,
    BUILDING_TYPES, FORTIFY, ITEM_DEFS, RECIPES, NODE_DEFS, CREATURE_DEFS,
    FURNITURE_DEFS, SHOP_STOCK_DEFAULT,
    xpToNext, emptySkills, migrateSkills, emptyEquip,
    invCount, invAdd, invRemove, canAfford, payNeed,
    bestToolTier, armorTotal, reduceDamage, meleeDamage, rangedDamage,
    consumeAmmo, cookOutcome, clientToWorld, defaultBase,
    furnitureFits, furnitureRect, rectsOverlap, bankDeposit, bankWithdraw,
    shopBuy, shopSell,
  } = D;

  const WORLD_W = 2800, WORLD_H = 2800, TILE = 32;
  const PLAYER_R = 12, ATTACK_RANGE = 56, GATHER_RANGE = 52;
  const DAY_LEN = 180, HUNGER_RATE = 0.32, MOVE_BASE = 95, AGRO_BASE = 160, MAX_INV = 24;

  const state = {
    running: false, paused: false, time: 0, day: 1, dayTimer: 0,
    cam: { x: 0, y: 0 }, viewW: 390, viewH: 500,
    player: null, creatures: [], props: [], lootPiles: [],
    particles: [], floatTexts: [], tapMarkers: [], projectiles: [],
    msgLog: [], selectedInv: -1, deathTimer: 0, tutorialShown: false, seed: 1,
    contextMenu: null, longPress: null, workshopTab: "craft",
    mapId: "overworld",
    interiors: {}, // id -> { w, h, outdoorExit:{x,y}, buildingRefId }
    bank: [],
    shop: { stock: [], restockTimer: 0 },
    placeMode: null, // { type, rot }
    selectedBank: -1,
    toastTimer: 0, toastMsg: "",
  };

  function onMap(obj) { return (obj.mapId || "overworld") === state.mapId; }
  function activeProps() { return state.props.filter(onMap); }
  function activeCreatures() { return state.creatures.filter((c) => c.alive && onMap(c)); }
  function activeLoot() { return state.lootPiles.filter(onMap); }
  function currentInterior() {
    if (!state.mapId.startsWith("int_")) return null;
    return state.interiors[state.mapId.slice(4)] || null;
  }
  function mapWorldSize() {
    const i = currentInterior();
    if (i) return { w: i.w, h: i.h };
    return { w: WORLD_W, h: WORLD_H };
  }

  function toast(msg, kind) {
    state.toastMsg = msg; state.toastTimer = 2.2;
    const el = document.getElementById("toast");
    if (el) { el.textContent = msg; el.classList.add("show"); }
    logMsg(msg, kind || "sys");
  }
  function logMsg(text, kind) {
    state.msgLog.push({ text, kind: kind || "", t: state.time });
    if (state.msgLog.length > 8) state.msgLog.shift();
    const el = document.getElementById("msg-log");
    if (el) el.innerHTML = state.msgLog.map((m) => `<div class="${m.kind}">${m.text}</div>`).join("");
  }
  function floatText(x, y, text, color) { state.floatTexts.push({ x, y, text, color, life: 0.9 }); }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60;
      state.particles.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 0.35 + Math.random()*0.35, color, r: 2+Math.random()*2 });
    }
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gainXp(p, skill, amount) {
    const s = p.skills[skill]; if (!s) return;
    s.xp += amount;
    while (s.xp >= s.next) {
      s.xp -= s.next; s.level += 1; s.next = xpToNext(s.level);
      toast(SKILL_LABELS[skill] + " → Level " + s.level + "!", "good");
    }
    if (skill === "fitness") p.maxHp = 100 + (s.level - 1) * 5;
  }

  function createPlayer(x, y, keepSkills, keepEquip) {
    const skills = keepSkills ? migrateSkills(keepSkills) : emptySkills();
    const equip = keepEquip ? Object.assign(emptyEquip(), keepEquip) : emptyEquip();
    return {
      x, y, r: PLAYER_R, target: null, facing: 0,
      hp: 100, maxHp: 100 + (skills.fitness.level - 1) * 5,
      hunger: 100, maxHunger: 100,
      attackCd: 0, gatherCd: 0, weapon: null,
      inv: [
        { id: "knife", qty: 1 }, { id: "bronze_axe", qty: 1 }, { id: "bronze_pick", qty: 1 },
        { id: "berries", qty: 3 }, { id: "bandage", qty: 1 }, { id: "plank", qty: 2 }, { id: "nails", qty: 4 },
        { id: "bronze_arrows", qty: 15 },
      ],
      skills, equip, kills: 0, alive: true,
    };
  }

  function syncWeaponAlias(p) {
    // legacy weapon field mirrors equip.weapon
    p.weapon = p.equip.weapon;
  }

  function pointInBuilding(x, y, b) {
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }
  function buildingCenter(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  function buildingsList() { return state.props.filter((p) => p.kind === "building" && (p.mapId || "overworld") === "overworld"); }
  function buildingAt(x, y) {
    for (const b of buildingsList()) if (pointInBuilding(x, y, b)) return b;
    return null;
  }
  function playerBuilding() {
    if (!state.player) return null;
    if (state.mapId.startsWith("int_")) return getBuildingById(state.mapId.slice(4));
    return buildingAt(state.player.x, state.player.y);
  }
  function hasWorkshop() {
    return buildingsList().some((b) => b.base && b.base.claimed && b.base.type === "workshop") || hasFurnitureFn("craft");
  }
  function hasKitchen() {
    return buildingsList().some((b) => b.base && b.base.claimed && b.base.type === "kitchen") || hasFurnitureFn("cook");
  }
  function hasForgeAccess() {
    if (state.props.some((p) => p.kind === "forge")) return true;
    if (hasFurnitureFn("forge")) return true;
    return buildingsList().some((b) => b.base && b.base.claimed && b.base.type === "workshop");
  }
  function hasAnvilAccess() {
    if (hasFurnitureFn("anvil")) return true;
    return buildingsList().some((b) => b.base && b.base.claimed && b.base.type === "workshop");
  }
  function getSafehouse() {
    const typed = buildingsList().find((b) => b.base && b.base.claimed && b.base.type === "safehouse");
    if (typed) return typed;
    // Bed furniture implies safehouse function
    const bed = state.props.find((p) => p.kind === "furniture" && p.fn === "respawn");
    if (bed) {
      const bid = (bed.mapId || "").replace("int_", "");
      return getBuildingById(bid) || null;
    }
    return null;
  }
  function getStorageBuilding() { return buildingsList().find((b) => b.base && b.base.claimed && b.base.type === "storage"); }

  function propCenter(prop) {
    if (prop.kind === "building") return buildingCenter(prop);
    return { x: prop.x, y: prop.y };
  }

  function makeCreature(type, x, y, rnd) {
    const r = rnd || Math.random;
    const def = CREATURE_DEFS[type];
    const hp = def.hp[0] + Math.floor(r() * (def.hp[1] - def.hp[0] + 1));
    return {
      id: Math.floor(r() * 1e9), type, x, y, r: def.r,
      hp, maxHp: hp, speed: def.speed * (0.9 + r() * 0.2),
      attackCd: 0, wanderT: r() * 3, wx: x, wy: y,
      alive: true, hitFlash: 0, aggressive: !!def.aggressive, flee: !!def.flee,
      agro: def.agro || AGRO_BASE,
    };
  }

  function buildInterior(id, outdoorExit, opts, rnd) {
    opts = opts || {};
    // Do NOT use outdoor building w/h — those are footprint size, not room size
    const w = opts.interiorW || 360, h = opts.interiorH || 280;
    const mapId = "int_" + id;
    const room = { w, h };
    state.interiors[id] = { w, h, outdoorExit: { x: outdoorExit.x, y: outdoorExit.y }, mapId };
    const props = [];
    // Floor marker (visual only)
    props.push({ kind: "floor", mapId, x: 0, y: 0, w, h, solid: false });
    // Walls as solid strips
    const t = 14;
    props.push({ kind: "wall", mapId, x: 0, y: 0, w, h: t, solid: true });
    props.push({ kind: "wall", mapId, x: 0, y: h - t, w, h: t, solid: true });
    props.push({ kind: "wall", mapId, x: 0, y: 0, w: t, h, solid: true });
    props.push({ kind: "wall", mapId, x: w - t, y: 0, w: t, h, solid: true });
    // Door exit at bottom center
    props.push({ kind: "door", mapId, x: w / 2, y: h - t / 2, r: 18, solid: false, exit: true, buildingId: id });
    // Clear door gap in bottom wall visually handled in render
    // Containers
    const containers = opts.publicBank ? 1 : 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < containers; i++) {
      props.push({
        kind: "cupboard", mapId,
        x: 50 + rnd() * (w - 100), y: 50 + rnd() * (h - 120),
        r: 14, solid: true, hp: 1, loot: pickLoot(rnd),
      });
    }
    if (opts.fridge) {
      props.push({
        kind: "fridge", mapId, x: w - 60, y: 70, r: 16, solid: true, hp: 1,
        loot: [{ id: "canned", qty: 1 }, { id: "water", qty: 1 }, { id: "raw_meat", qty: 1 }],
      });
    }
    if (opts.publicBank) {
      props.push({
        kind: "furniture", furniture: "bank_chest", mapId,
        x: w / 2, y: h / 2 - 20, rot: 0, solid: true, fn: "bank", placed: true,
      });
    }
    if (opts.trader) {
      props.push({ kind: "trader", mapId, x: w / 2 + 40, y: h / 2 + 10, r: 14, solid: true, name: "Mira the Trader" });
      // starter furniture for shop look
      props.push({ kind: "furniture", furniture: "table", mapId, x: w / 2 + 40, y: h / 2 + 40, rot: 0, solid: true, fn: null, placed: true });
    }
    // Zombies inside some unclaimed homes
    const creatures = [];
    if (opts.spawnZombies) {
      const n = 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const c = makeCreature("zombie", 80 + rnd() * (w - 160), 80 + rnd() * (h - 160), rnd);
        c.mapId = mapId;
        creatures.push(c);
      }
    }
    return { props, creatures };
  }

  function generateWorld(seed) {
    const rnd = mulberry32(seed);
    const props = [], creatures = [], lootPiles = [];
    state.interiors = {};
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    props.push({ kind: "campfire", mapId: "overworld", x: cx, y: cy, r: 18, solid: false, cook: true });
    props.push({ kind: "forge", mapId: "overworld", x: cx - 60, y: cy + 80, r: 16, solid: true });

    const buildings = [
      { id: "b0", x: cx - 300, y: cy - 80, w: 130, h: 110, fridge: true, spawnZombies: true },
      { id: "b1", x: cx + 180, y: cy - 220, w: 140, h: 110, fridge: true, spawnZombies: true },
      { id: "b2", x: cx - 120, y: cy + 240, w: 160, h: 100, spawnZombies: false },
      { id: "b3", x: cx + 320, y: cy + 140, w: 110, h: 120, spawnZombies: true },
      { id: "bank", x: cx - 80, y: cy - 280, w: 140, h: 100, publicBank: true, safe: true },
      { id: "shop", x: cx + 40, y: cy - 280, w: 150, h: 110, trader: true, safe: true },
    ];
    for (const b of buildings) {
      const outdoorExit = { x: b.x + b.w / 2, y: b.y + b.h + 18 };
      props.push({
        kind: "building", mapId: "overworld", id: b.id,
        x: b.x, y: b.y, w: b.w, h: b.h, solid: true, base: defaultBase(),
        doorX: outdoorExit.x, doorY: outdoorExit.y,
        publicBank: !!b.publicBank, trader: !!b.trader, safe: !!b.safe,
      });
      // outdoor door marker
      props.push({
        kind: "door", mapId: "overworld", x: outdoorExit.x, y: outdoorExit.y,
        r: 16, solid: false, enter: true, buildingId: b.id,
      });
      props.push({
        kind: "crate", mapId: "overworld",
        x: b.x + 20 + rnd() * (b.w - 40), y: b.y + b.h + 28 + rnd() * 20,
        r: 12, solid: true, hp: 1, loot: pickLoot(rnd),
      });
      const interior = buildInterior(b.id, outdoorExit, b, rnd);
      props.push.apply(props, interior.props);
      creatures.push.apply(creatures, interior.creatures);
    }

    // Goblin camp
    const gx = cx + 520, gy = cy - 380;
    props.push({
      kind: "building", mapId: "overworld", id: "gob",
      x: gx, y: gy, w: 90, h: 70, solid: true, base: defaultBase(), goblinHut: true,
      doorX: gx + 45, doorY: gy + 88,
    });
    props.push({ kind: "door", mapId: "overworld", x: gx + 45, y: gy + 88, r: 16, solid: false, enter: true, buildingId: "gob" });
    const gobInt = buildInterior("gob", { x: gx + 45, y: gy + 88 }, { interiorW: 300, interiorH: 240, spawnZombies: false }, rnd);
    props.push.apply(props, gobInt.props);
    for (let i = 0; i < 5; i++) {
      const g = makeCreature("goblin", gx + 40 + (rnd() - 0.5) * 120, gy + 80 + rnd() * 80, rnd);
      g.mapId = "overworld";
      creatures.push(g);
    }

    const bRects = buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    for (let i = 0; i < 55; i++) {
      const x = 80 + rnd() * (WORLD_W - 160), y = 80 + rnd() * (WORLD_H - 160);
      if (Math.hypot(x - cx, y - cy) < 110) continue;
      if (nearBuilding(x, y, bRects, 40)) continue;
      const kind = rnd() < 0.72 ? "tree" : "oak";
      props.push({ kind, mapId: "overworld", x, y, r: kind === "oak" ? 18 : 15, solid: true, hp: kind === "oak" ? 4 : 3, node: kind });
    }
    for (let i = 0; i < 28; i++) {
      const x = 80 + rnd() * (WORLD_W - 160), y = 80 + rnd() * (WORLD_H - 160);
      if (Math.hypot(x - cx, y - cy) < 100) continue;
      props.push({ kind: "bush", mapId: "overworld", x, y, r: 12, solid: false, hp: 1, node: "bush" });
    }
    const rockKinds = ["copper_rock", "tin_rock", "iron_rock", "scrapheap"];
    for (let i = 0; i < 36; i++) {
      const x = 80 + rnd() * (WORLD_W - 160), y = 80 + rnd() * (WORLD_H - 160);
      if (Math.hypot(x - cx, y - cy) < 120) continue;
      const kind = rockKinds[Math.floor(rnd() * rockKinds.length)];
      props.push({ kind, mapId: "overworld", x, y, r: 14, solid: true, hp: kind === "iron_rock" ? 4 : 3, node: kind });
    }
    for (let i = 0; i < 6; i++) {
      props.push({
        kind: "fish_spot", mapId: "overworld", x: cx - 200 + rnd() * 80, y: cy + 400 + rnd() * 60,
        r: 16, solid: false, hp: 99, node: "fish_spot", infinite: true,
      });
    }
    props.push({ kind: "pond", mapId: "overworld", x: cx - 160, y: cy + 430, w: 120, h: 70, solid: false });

    lootPiles.push({
      mapId: "overworld", x: cx + 45, y: cy - 35,
      items: [{ id: "cloth", qty: 2 }, { id: "water", qty: 1 }, { id: "feather", qty: 3 }, { id: "string", qty: 1 }, { id: "coins", qty: 25 }, { id: "stone", qty: 6 }],
      life: 99999,
    });

    for (let i = 0; i < 22; i++) {
      let x, y, t = 0;
      do { x = 100 + rnd() * (WORLD_W - 200); y = 100 + rnd() * (WORLD_H - 200); t++; }
      while ((Math.hypot(x - cx, y - cy) < 240 || nearBuilding(x, y, bRects, 20)) && t < 40);
      const z = makeCreature("zombie", x, y, rnd); z.mapId = "overworld"; creatures.push(z);
    }
    for (let i = 0; i < 10; i++) {
      const c = makeCreature("rat", cx - 350 + rnd() * 80, cy - 40 + rnd() * 80, rnd); c.mapId = "overworld"; creatures.push(c);
    }
    for (let i = 0; i < 8; i++) {
      const c = makeCreature("squirrel", 200 + rnd() * (WORLD_W - 400), 200 + rnd() * (WORLD_H - 400), rnd); c.mapId = "overworld"; creatures.push(c);
    }
    for (let i = 0; i < 8; i++) {
      const c = makeCreature("chicken", 200 + rnd() * (WORLD_W - 400), 200 + rnd() * (WORLD_H - 400), rnd); c.mapId = "overworld"; creatures.push(c);
    }

    return {
      props, creatures, lootPiles, spawn: { x: cx, y: cy + 45 },
      shop: { stock: SHOP_STOCK_DEFAULT.map((s) => Object.assign({}, s)), restockTimer: 120 },
      bank: [],
    };
  }

  function nearBuilding(x, y, buildings, pad) {
    for (const b of buildings) {
      if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return true;
    }
    return false;
  }
  function pickLoot(rnd) {
    const pool = [
      [{ id: "canned", qty: 1 }], [{ id: "cloth", qty: 2 }], [{ id: "scrap", qty: 2 }],
      [{ id: "copper_ore", qty: 1 }], [{ id: "hoodie", qty: 1 }], [{ id: "jeans", qty: 1 }],
      [{ id: "hiking_boots", qty: 1 }], [{ id: "feather", qty: 2 }], [{ id: "water", qty: 1 }],
    ];
    return pool[Math.floor(rnd() * pool.length)].map((x) => Object.assign({}, x));
  }

  function getBuildingById(id) {
    return state.props.find((p) => p.kind === "building" && p.id === id);
  }

  function enterBuilding(buildingId) {
    const b = getBuildingById(buildingId);
    const interior = state.interiors[buildingId];
    if (!b || !interior) { toast("Can't enter", "bad"); return false; }
    // Fortified claimed buildings: player may enter; zombies blocked separately
    state.mapId = interior.mapId;
    state.player.x = interior.w / 2;
    state.player.y = interior.h - 40;
    state.player.target = null;
    state.placeMode = null;
    toast("Entered building", "sys");
    return true;
  }

  function exitBuilding() {
    const int = currentInterior();
    if (!int) return false;
    const bid = state.mapId.slice(4);
    state.mapId = "overworld";
    state.player.x = int.outdoorExit.x;
    state.player.y = int.outdoorExit.y + 10;
    state.player.target = null;
    state.placeMode = null;
    toast("Back outside", "sys");
    return true;
  }

  function tryDoor(prop) {
    if (prop.exit) return exitBuilding();
    if (prop.enter && prop.buildingId) return enterBuilding(prop.buildingId);
    return false;
  }

  function interiorFurniture() {
    return activeProps().filter((p) => p.kind === "furniture");
  }

  function hasFurnitureFn(fn) {
    // on current map or any claimed workshop furniture globally
    if (activeProps().some((p) => p.kind === "furniture" && p.fn === fn)) return true;
    if (fn === "forge" && state.props.some((p) => p.kind === "forge" && (p.mapId || "overworld") === "overworld")) return true;
    return state.props.some((p) => p.kind === "furniture" && p.fn === fn);
  }

  function placeFurnitureAt(wx, wy) {
    if (!state.placeMode) return false;
    const int = currentInterior();
    if (!int) { toast("Place furniture inside a building", "bad"); return false; }
    const bid = state.mapId.slice(4);
    const b = getBuildingById(bid);
    if (!b || !b.base || !b.base.claimed) { toast("Claim the building first", "bad"); return false; }
    const type = state.placeMode.type;
    const def = FURNITURE_DEFS[type];
    if (!def) return false;
    const p = state.player;
    if (p.skills.construction.level < def.skill) { toast("Need Construction " + def.skill, "bad"); return false; }
    if (!canAfford(p.inv, def.cost)) {
      toast("Need " + Object.entries(def.cost).map(([id,q]) => ITEM_DEFS[id].name + " " + invCount(p.inv,id) + "/" + q).join(", "), "bad");
      return false;
    }
    const rot = state.placeMode.rot || 0;
    if (!furnitureFits(wx, wy, def, rot, int)) { toast("Can't place there", "bad"); return false; }
    const rect = furnitureRect(wx, wy, def, rot);
    for (const f of interiorFurniture()) {
      const fd = FURNITURE_DEFS[f.furniture];
      if (!fd) continue;
      if (rectsOverlap(rect, furnitureRect(f.x, f.y, fd, f.rot || 0), 2)) {
        toast("Blocked by other furniture", "bad"); return false;
      }
    }
    // avoid door
    if (Math.hypot(wx - int.w/2, wy - (int.h - 20)) < 36) { toast("Don't block the door", "bad"); return false; }
    payNeed(p.inv, def.cost);
    state.props.push({
      kind: "furniture", furniture: type, mapId: state.mapId,
      x: wx, y: wy, rot, solid: !def.floor, fn: def.fn, placed: true,
    });
    gainXp(p, "construction", def.xp);
    toast("Placed " + def.name, "good");
    saveGame(true);
    return true;
  }

  function pickupFurniture(prop) {
    if (!prop || prop.kind !== "furniture" || !prop.placed) return false;
    const def = FURNITURE_DEFS[prop.furniture];
    // refund half mats roughly as plank
    if (def && def.cost.plank) invAdd(state.player.inv, "plank", Math.max(1, Math.floor(def.cost.plank / 2)), MAX_INV);
    const idx = state.props.indexOf(prop);
    if (idx >= 0) state.props.splice(idx, 1);
    toast("Picked up " + (def ? def.name : "furniture"), "sys");
    saveGame(true);
    return true;
  }

  function rotateFurniture(prop) {
    if (!prop || prop.kind !== "furniture") return;
    prop.rot = ((prop.rot || 0) + 1) % 4;
    toast("Rotated", "sys");
    saveGame(true);
  }

  function getCoins(p) { return invCount(p.inv, "coins"); }
  function setCoins(p, n) {
    invRemove(p.inv, "coins", invCount(p.inv, "coins"));
    if (n > 0) invAdd(p.inv, "coins", n, MAX_INV);
  }



  // ── Persistence ──
  function serialize() {
    return {
      v: 4, seed: state.seed, day: state.day, dayTimer: state.dayTimer, time: state.time,
      mapId: state.mapId,
      interiors: state.interiors,
      bank: state.bank,
      shop: state.shop,
      player: {
        x: state.player.x, y: state.player.y, hp: state.player.hp, maxHp: state.player.maxHp,
        hunger: state.player.hunger, inv: state.player.inv, skills: state.player.skills,
        equip: state.player.equip, kills: state.player.kills,
      },
      creatures: state.creatures.filter((c) => c.alive).map((c) => ({
        id: c.id, type: c.type, x: c.x, y: c.y, hp: c.hp, speed: c.speed, mapId: c.mapId || "overworld",
      })),
      props: state.props.map((p) => ({
        kind: p.kind, id: p.id, mapId: p.mapId || "overworld",
        x: p.x, y: p.y, w: p.w, h: p.h, r: p.r, solid: p.solid,
        hp: p.hp, node: p.node, loot: p.loot, base: p.base || null, cook: p.cook,
        infinite: p.infinite, goblinHut: p.goblinHut, furniture: p.furniture, rot: p.rot,
        fn: p.fn, placed: p.placed, enter: p.enter, exit: p.exit, buildingId: p.buildingId,
        doorX: p.doorX, doorY: p.doorY, publicBank: p.publicBank, trader: p.trader, safe: p.safe,
        name: p.name,
      })),
      lootPiles: state.lootPiles, tutorialShown: state.tutorialShown,
    };
  }
  function normalizeProps(props) {
    return (props || []).map((p) => {
      const out = Object.assign({}, p);
      if (out.kind === "building") {
        out.base = Object.assign(defaultBase(), out.base || {});
        if (!Array.isArray(out.base.stash)) out.base.stash = [];
      }
      if (!out.node && NODE_DEFS[out.kind]) out.node = out.kind;
      return out;
    });
  }
  function saveGame(silent) {
    if (!state.player) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
      for (const k of SAVE_KEY_LEGACY) try { localStorage.removeItem(k); } catch (e) {}
      if (!silent) toast("Game saved", "sys");
    } catch (e) { toast("Save failed", "bad"); }
  }
  function loadRaw() {
    try {
      let raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        for (const k of SAVE_KEY_LEGACY) {
          raw = localStorage.getItem(k);
          if (raw) break;
        }
      }
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.player) data.player.skills = migrateSkills(data.player.skills);
      if (data.player && !data.player.equip) {
        data.player.equip = emptyEquip();
        if (data.player.weapon) data.player.equip.weapon = data.player.weapon;
      }
      // v1/v2 zombies → creatures
      if (!data.creatures && data.zombies) {
        data.creatures = data.zombies.map((z) => ({ id: z.id, type: "zombie", x: z.x, y: z.y, hp: z.hp, speed: z.speed }));
      }
      data.props = normalizeProps(data.props);
      data.v = 4;
      return data;
    } catch (e) { return null; }
  }
  function loadGame() {
    const data = loadRaw();
    if (!data || !data.player) return false;
    state.seed = data.seed; state.day = data.day || 1; state.dayTimer = data.dayTimer || 0;
    state.time = data.time || 0; state.tutorialShown = !!data.tutorialShown;
    state.props = normalizeProps(data.props);
    state.lootPiles = data.lootPiles || [];
    state.mapId = data.mapId || "overworld";
    state.interiors = data.interiors || {};
    state.bank = data.bank || [];
    state.shop = data.shop || { stock: SHOP_STOCK_DEFAULT.map((s) => Object.assign({}, s)), restockTimer: 120 };
    // Migrate old worlds without interiors: keep overworld, interiors empty until new game
    state.creatures = (data.creatures || []).map((c) => {
      const cc = makeCreature(c.type || "zombie", c.x, c.y);
      cc.id = c.id; cc.hp = c.hp; if (c.speed) cc.speed = c.speed;
      cc.mapId = c.mapId || "overworld";
      return cc;
    });
    const p = createPlayer(data.player.x, data.player.y, data.player.skills, data.player.equip);
    Object.assign(p, {
      hp: data.player.hp, maxHp: data.player.maxHp || p.maxHp,
      hunger: data.player.hunger, inv: data.player.inv || [], kills: data.player.kills || 0,
    });
    syncWeaponAlias(p);
    state.player = p;
    state.particles = []; state.floatTexts = []; state.tapMarkers = []; state.projectiles = [];
    return true;
  }
  function hasSave() {
    try {
      if (localStorage.getItem(SAVE_KEY)) return true;
      return SAVE_KEY_LEGACY.some((k) => !!localStorage.getItem(k));
    } catch (e) { return false; }
  }
  function resetSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      for (const k of SAVE_KEY_LEGACY) localStorage.removeItem(k);
    } catch (e) {}
  }
  function startNewGame() {
    state.seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const world = generateWorld(state.seed);
    state.props = world.props; state.creatures = world.creatures; state.lootPiles = world.lootPiles;
    state.bank = world.bank || [];
    state.shop = world.shop || { stock: SHOP_STOCK_DEFAULT.map((s) => Object.assign({}, s)), restockTimer: 120 };
    state.mapId = "overworld"; state.placeMode = null;
    state.player = createPlayer(world.spawn.x, world.spawn.y);
    state.player.equip.weapon = "knife";
    syncWeaponAlias(state.player);
    state.day = 1; state.dayTimer = 0; state.time = 0;
    state.particles = []; state.floatTexts = []; state.tapMarkers = []; state.projectiles = [];
    state.msgLog = []; state.deathTimer = 0; state.tutorialShown = false;
    state.running = true; state.paused = false; state.contextMenu = null;
    logMsg("Welcome to Ashen Vale. Long-press for actions.", "sys");
    saveGame(true);
  }

  // ── Base actions ──
  function claimBuilding(b) {
    if (!b || b.kind !== "building") return false;
    const insideMap = state.mapId === "int_" + b.id;
    if (!insideMap && !pointInBuilding(state.player.x, state.player.y, b)) {
      toast("Enter the building to claim it", "bad"); return false;
    }
    if (b.base.claimed) { toast("Already claimed", "sys"); return false; }
    b.base.claimed = true; b.base.type = "none"; b.base.wallHp = 20; b.base.wallMax = 20;
    if (b.goblinHut) toast("Claimed a goblin hut!", "good");
    gainXp(state.player, "construction", 15);
    toast("Building claimed — set a type in Build tab", "good");
    saveGame(true); return true;
  }
  function setBuildingType(b, type) {
    const def = BUILDING_TYPES[type];
    if (!b || !b.base || !b.base.claimed || !def || type === "none") return false;
    if (state.player.skills.construction.level < (def.skill || 1)) { toast("Need Construction " + def.skill, "bad"); return false; }
    for (const o of buildingsList()) if (o !== b && o.base && o.base.type === type) { toast("Already have a " + def.name, "bad"); return false; }
    b.base.type = type;
    if (type === "workshop") { b.base.hasForge = true; b.base.hasAnvil = true; }
    gainXp(state.player, "construction", 20);
    toast("Designated as " + def.name, "good");
    saveGame(true); return true;
  }
  function doFortify(b, key) {
    const f = FORTIFY[key];
    if (!f || !b || !b.base || !b.base.claimed) return false;
    const p = state.player;
    if (p.skills.construction.level < f.skill) { toast("Need Construction " + f.skill, "bad"); return false; }
    if (!canAfford(p.inv, f.need)) { toast("Need: " + Object.entries(f.need).map(([id,q]) => ITEM_DEFS[id].name + "×" + q).join(", "), "bad"); return false; }
    if (key === "board" && b.base.boarded) { toast("Already boarded", "sys"); return false; }
    if (key === "door" && b.base.doorReinforced) { toast("Door already reinforced", "sys"); return false; }
    if (key === "walls" && b.base.braced) { toast("Walls already braced", "sys"); return false; }
    if (key === "repair" && b.base.wallHp >= b.base.wallMax) { toast("Already full fort HP", "sys"); return false; }
    payNeed(p.inv, f.need);
    if (f.repair) b.base.wallHp = Math.min(b.base.wallMax, b.base.wallHp + f.repair);
    else {
      if (key === "board") b.base.boarded = true;
      if (key === "door") b.base.doorReinforced = true;
      if (key === "walls") b.base.braced = true;
      b.base.wallMax += f.addWall;
      b.base.wallHp = Math.min(b.base.wallMax, b.base.wallHp + f.addWall);
    }
    gainXp(p, "construction", f.xp);
    toast(f.label + " — done!", "good");
    saveGame(true); return true;
  }

  function recipeBlocked(r, p) {
    if ((p.skills[r.skill] || { level: 1 }).level < r.level) return "Need " + SKILL_LABELS[r.skill] + " " + r.level;
    if (r.workshop && !hasWorkshop()) return "Need a Workshop";
    if (r.kitchen && !hasKitchen()) return "Need a Kitchen";
    if (r.forge && !hasForgeAccess()) return "Need a forge (Workshop or world forge)";
    if (r.anvil && !hasAnvilAccess()) return "Need an anvil (Workshop)";
    if (!canAfford(p.inv, r.need)) {
      return "Need " + Object.entries(r.need).map(([id, q]) => ITEM_DEFS[id].name + " " + invCount(p.inv, id) + "/" + q).join(", ");
    }
    return null;
  }

  function doCraft(recipeId) {
    const r = RECIPES.find((x) => x.id === recipeId);
    if (!r || !state.player) return { ok: false, msg: "Unknown recipe" };
    const block = recipeBlocked(r, state.player);
    if (block) { toast(block, "bad"); return { ok: false, msg: block }; }
    payNeed(state.player.inv, r.need, r.keep);
    invAdd(state.player.inv, r.out.id, r.out.qty, MAX_INV);
    gainXp(state.player, r.skill, r.xp);
    const msg = "Made " + ITEM_DEFS[r.out.id].name + (r.out.qty > 1 ? " ×" + r.out.qty : "");
    toast(msg, "good");
    saveGame(true);
    return { ok: true, msg };
  }


  // ── Actions: gather / attack / loot ──
  function tryGather(p, prop) {
    if (p.gatherCd > 0) return;
    if (prop.kind === "door") { tryDoor(prop); p.target = null; return; }
    if (prop.kind === "trader") { openShop(); p.target = null; return; }
    if (prop.kind === "furniture" && prop.fn === "bank") { openBank(); p.target = null; return; }
    if (prop.kind === "furniture" && prop.fn === "cook") { tryCookAtFire(p); p.target = null; return; }
    if (prop.kind === "furniture" && prop.fn === "craft") { openWorkshop("craft"); p.target = null; return; }
    if (prop.kind === "furniture" && (prop.fn === "forge" || prop.fn === "anvil")) { openWorkshop("smith"); p.target = null; return; }
    if (prop.kind === "campfire" || prop.kind === "forge") {
      openWorkshop(prop.kind === "forge" ? "smith" : "craft");
      p.target = null;
      return;
    }
    if (prop.kind === "building" || prop.kind === "pond" || prop.kind === "wall" || prop.kind === "floor") { p.target = null; return; }
    if (prop.kind === "crate" || prop.kind === "cupboard" || prop.kind === "fridge") {
      p.gatherCd = 0.5;
      prop.hp = 0; prop.solid = false;
      if (prop.loot) for (const it of prop.loot) invAdd(p.inv, it.id, it.qty, MAX_INV);
      floatText(prop.x, prop.y - 16, "Loot!", "#e8c860");
      gainXp(p, "fitness", 2);
      toast((prop.kind === "fridge" ? "Fridge" : prop.kind === "cupboard" ? "Cupboard" : "Crate") + " looted", "good");
      p.target = null;
      return;
    }
    const nodeKey = prop.node || prop.kind;
    const nd = NODE_DEFS[nodeKey];
    if (!nd) { p.target = null; return; }
    if (nd.tool) {
      const tier = bestToolTier(p.inv, p.equip, nd.tool);
      if (tier < nd.tier) {
        toast("Need " + nd.tool + " tier " + nd.tier + "+ (bronze/iron/steel)", "bad");
        p.target = null;
        return;
      }
    }
    p.gatherCd = Math.max(0.35, 0.85 - bestToolTier(p.inv, p.equip, nd.tool || "axe") * 0.12);
    if (!prop.infinite) prop.hp = (prop.hp || 1) - 1;
    for (const d of nd.drops) {
      const lo = d.qty[0], hi = d.qty[1];
      const qty = lo + Math.floor(Math.random() * (hi - lo + 1));
      if (qty > 0) {
        invAdd(p.inv, d.id, qty, MAX_INV);
        floatText(prop.x, prop.y - 14, "+" + ITEM_DEFS[d.id].name, "#a8d4a0");
      }
    }
    gainXp(p, nd.skill, nd.xp);
    gainXp(p, "fitness", 1);
    if (!prop.infinite && prop.hp <= 0) {
      prop.solid = false; prop.gathered = 1;
      toast(nd.label + " depleted", "sys");
      p.target = null;
    }
  }

  function tryCookAtFire(p) {
    // cook one raw fish or meat from inventory
    const raw = invCount(p.inv, "raw_fish") > 0 ? "raw_fish" : (invCount(p.inv, "raw_meat") > 0 ? "raw_meat" : null);
    if (!raw) { toast("No raw fish/meat to cook", "bad"); return false; }
    invRemove(p.inv, raw, 1);
    const outcome = cookOutcome(p.skills.cooking.level);
    if (outcome === "burn") {
      invAdd(p.inv, "burned_food", 1, MAX_INV);
      gainXp(p, "cooking", 4);
      toast("Burnt the food…", "bad");
    } else {
      const out = raw === "raw_fish" ? "fish" : "meat";
      invAdd(p.inv, out, 1, MAX_INV);
      gainXp(p, "cooking", 18);
      toast("Cooked " + ITEM_DEFS[out].name, "good");
    }
    saveGame(true);
    return true;
  }

  function tryAttack(p, c) {
    if (p.attackCd > 0) return;
    const bow = p.equip.weapon && ITEM_DEFS[p.equip.weapon] && ITEM_DEFS[p.equip.weapon].style === "ranged";
    const d = dist(p, c);
    if (bow) {
      const range = ITEM_DEFS[p.equip.weapon].range || 200;
      if (d > range) return;
      if (!p.equip.ammo || invCount(p.inv, p.equip.ammo) <= 0) { toast("No arrows equipped!", "bad"); return; }
      if (!consumeAmmo(p)) { toast("Out of arrows", "bad"); return; }
      p.attackCd = 0.7;
      const base = rangedDamage(p.equip);
      const bonus = 1 + (p.skills.ranged.level - 1) * 0.07;
      const dmg = Math.round(base * bonus * (0.85 + Math.random() * 0.3));
      state.projectiles.push({
        x: p.x, y: p.y, tx: c.x, ty: c.y, targetId: c.id, dmg, life: 0.35, color: "#e8c860",
      });
      gainXp(p, "ranged", 5);
      gainXp(p, "fitness", 1);
      return;
    }
    if (d > ATTACK_RANGE) return;
    p.attackCd = 0.55;
    const base = meleeDamage(p.equip);
    const bonus = 1 + (p.skills.combat.level - 1) * 0.08;
    const dmg = Math.round(base * bonus * (0.85 + Math.random() * 0.3));
    applyDamageToCreature(c, dmg, p);
    gainXp(p, "combat", 4 + Math.floor(dmg / 5));
    gainXp(p, "fitness", 1);
  }

  function applyDamageToCreature(c, dmg, p) {
    c.hp -= dmg; c.hitFlash = 0.15;
    floatText(c.x, c.y - 16, "-" + dmg, "#ffe08a");
    burst(c.x, c.y, "#7ecf8a", 4);
    if (c.hp <= 0) {
      c.alive = false;
      p.kills += 1;
      const def = CREATURE_DEFS[c.type];
      toast(def.name + " down", "good");
      gainXp(p, c.type === "zombie" || c.type === "goblin" || c.type === "rat" ? "combat" : "fitness", def.xp);
      const drops = [];
      for (const d of def.drops || []) {
        if (Math.random() < d.c) {
          const q = d.qty ? d.qty[0] + Math.floor(Math.random() * (d.qty[1] - d.qty[0] + 1)) : 1;
          if (q > 0) drops.push({ id: d.id, qty: q });
        }
      }
      if (drops.length) state.lootPiles.push({ x: c.x, y: c.y, items: drops, life: 180 });
    }
  }

  function pickupLoot(p, idx) {
    const pile = state.lootPiles[idx];
    if (!pile) return;
    const left = [];
    for (const it of pile.items) {
      const before = invCount(p.inv, it.id);
      invAdd(p.inv, it.id, it.qty, MAX_INV);
      const took = invCount(p.inv, it.id) - before;
      if (took < it.qty) left.push({ id: it.id, qty: it.qty - took });
    }
    if (left.length) { pile.items = left; toast("Bag full — some left", "bad"); }
    else { state.lootPiles.splice(idx, 1); toast("Picked up loot", "good"); }
  }

  function playerDie() {
    const p = state.player;
    p.alive = false; p.hp = 0;
    // Drop bag but keep equipped? Spec: death drops carried items — drop inv, keep equip visually unequipped into drop too for fairness like before
    const drop = p.inv.map((it) => ({ id: it.id, qty: it.qty }));
    for (const slot of EQUIP_SLOTS) {
      if (p.equip[slot] && !drop.some((d) => d.id === p.equip[slot])) drop.push({ id: p.equip[slot], qty: 1 });
      p.equip[slot] = null;
    }
    if (drop.length) state.lootPiles.push({ x: p.x, y: p.y, items: drop, life: 99999, deathDrop: true });
    p.inv = []; p.target = null; syncWeaponAlias(p);
    state.deathTimer = 2.8;
    document.getElementById("death-banner").classList.add("show");
    toast("You died — skills kept, gear dropped", "bad");
    saveGame(true);
  }

  function respawnPlayer() {
    const bed = state.props.find((p) => p.kind === "furniture" && p.fn === "respawn");
    const safe = getSafehouse();
    const camp = state.props.find((pr) => pr.kind === "campfire" && (pr.mapId || "overworld") === "overworld");
    let sx, sy;
    if (bed) {
      state.mapId = bed.mapId;
      sx = bed.x; sy = bed.y + 20;
    } else if (safe) {
      state.mapId = "overworld";
      sx = safe.x + safe.w / 2; sy = safe.y + safe.h / 2;
    } else if (camp) {
      state.mapId = "overworld";
      sx = camp.x; sy = camp.y + 40;
    } else {
      state.mapId = "overworld";
      sx = WORLD_W / 2; sy = WORLD_H / 2;
    }
    const skills = state.player.skills, kills = state.player.kills, maxHp = state.player.maxHp;
    state.player = createPlayer(sx, sy, skills);
    state.player.kills = kills; state.player.maxHp = maxHp;
    state.player.hp = Math.min(60, maxHp); state.player.hunger = 55;
    state.player.inv = [{ id: "berries", qty: 2 }];
    toast(safe ? "Respawned at Safehouse" : "Back at the campfire", "sys");
    saveGame(true);
  }

  function moveToward(ent, tx, ty, speed, dt) {
    const dx = tx - ent.x, dy = ty - ent.y;
    const d = Math.hypot(dx, dy) || 1;
    ent.facing = Math.atan2(dy, dx);
    const step = Math.min(speed * dt, d);
    const sz = mapWorldSize();
    ent.x = clamp(ent.x + (dx / d) * step, 18, sz.w - 18);
    ent.y = clamp(ent.y + (dy / d) * step, 18, sz.h - 18);
  }

  function resolveSolid(ent) {
    for (const prop of activeProps()) {
      if (!prop.solid || prop.kind === "building" || prop.kind === "floor") continue;
      if (prop.kind === "wall") {
        // AABB push
        const nearestX = clamp(ent.x, prop.x, prop.x + prop.w);
        const nearestY = clamp(ent.y, prop.y, prop.y + prop.h);
        const dx = ent.x - nearestX, dy = ent.y - nearestY;
        const d2 = dx*dx + dy*dy;
        if (d2 < ent.r * ent.r) {
          if (d2 === 0) {
            ent.y = prop.y < mapWorldSize().h / 2 ? prop.y + prop.h + ent.r : prop.y - ent.r;
          } else {
            const d = Math.sqrt(d2);
            ent.x = nearestX + (dx / d) * ent.r;
            ent.y = nearestY + (dy / d) * ent.r;
          }
        }
        continue;
      }
      if (prop.kind === "furniture") {
        const def = FURNITURE_DEFS[prop.furniture];
        if (!def || def.floor) continue;
        const rect = furnitureRect(prop.x, prop.y, def, prop.rot || 0);
        const nearestX = clamp(ent.x, rect.x, rect.x + rect.w);
        const nearestY = clamp(ent.y, rect.y, rect.y + rect.h);
        const dx = ent.x - nearestX, dy = ent.y - nearestY;
        const d2 = dx*dx + dy*dy;
        if (d2 < ent.r * ent.r && d2 > 0) {
          const d = Math.sqrt(d2);
          ent.x = nearestX + (dx / d) * ent.r;
          ent.y = nearestY + (dy / d) * ent.r;
        }
        continue;
      }
      if (!prop.r) continue;
      const d = dist(ent, prop);
      const minD = ent.r + prop.r * 0.65;
      if (d < minD && d > 0) {
        const push = (minD - d) / d;
        ent.x += (ent.x - prop.x) * push;
        ent.y += (ent.y - prop.y) * push;
      }
    }
  }

  function moveSpeed(p) {
    return MOVE_BASE * (1 + (p.skills.fitness.level - 1) * 0.04);
  }


  function update(dt) {
    if (!state.running || state.paused || !state.player) return;
    if (state.deathTimer > 0) {
      state.deathTimer -= dt;
      if (state.deathTimer <= 0) {
        respawnPlayer();
        document.getElementById("death-banner").classList.remove("show");
      }
      return;
    }
    state.time += dt;
    state.dayTimer += dt;
    if (state.dayTimer >= DAY_LEN) {
      state.dayTimer -= DAY_LEN; state.day += 1;
      toast("Day " + state.day + " begins…", "sys");
      spawnNightZombies();
    }
    if (state.shop) {
      state.shop.restockTimer = (state.shop.restockTimer || 0) - dt;
      if (state.shop.restockTimer <= 0) {
        state.shop.restockTimer = 90;
        for (const row of state.shop.stock || []) {
          if (row.stock < row.max) row.stock = Math.min(row.max, row.stock + 1);
        }
      }
    }
    // Rest bonus near chair/bed
    if (activeProps().some((pr) => pr.kind === "furniture" && (pr.fn === "rest" || pr.fn === "respawn"))) {
      if (p.hunger > 40) p.hp = Math.min(p.maxHp, p.hp + 1.5 * dt);
    }
    const p = state.player;
    if (!p.alive) return;

    p.hunger = Math.max(0, p.hunger - HUNGER_RATE * dt);
    if (p.hunger <= 0) p.hp -= 2.2 * dt;
    else if (p.hunger > 60 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 1.1 * dt);
    const insideB = playerBuilding();
    if (insideB && insideB.base && insideB.base.type === "safehouse" && insideB.base.wallHp > 0) {
      p.hp = Math.min(p.maxHp, p.hp + 3.2 * dt);
    }
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.gatherCd = Math.max(0, p.gatherCd - dt);

    // Projectiles
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const pr = state.projectiles[i];
      pr.life -= dt;
      const t = 1 - Math.max(0, pr.life) / 0.35;
      pr.x = pr.x + (pr.tx - pr.x) * Math.min(1, dt * 8);
      pr.y = pr.y + (pr.ty - pr.y) * Math.min(1, dt * 8);
      if (pr.life <= 0 || t >= 0.95) {
        const c = state.creatures.find((cc) => cc.id === pr.targetId && cc.alive);
        if (c) applyDamageToCreature(c, pr.dmg, p);
        state.projectiles.splice(i, 1);
      }
    }

    if (p.target) {
      if (p.target.creatureId != null) {
        const c = state.creatures.find((cc) => cc.id === p.target.creatureId && cc.alive);
        if (!c) p.target = null;
        else {
          const bow = p.equip.weapon && ITEM_DEFS[p.equip.weapon] && ITEM_DEFS[p.equip.weapon].style === "ranged";
          const range = bow ? (ITEM_DEFS[p.equip.weapon].range || 200) : ATTACK_RANGE;
          if (dist(p, c) <= range) { /* stop */ tryAttack(p, c); }
          else moveToward(p, c.x, c.y, moveSpeed(p), dt);
        }
      } else if (p.target.propId != null) {
        const prop = state.props[p.target.propId];
        if (!prop || (prop.hp != null && prop.hp <= 0 && !prop.infinite)) p.target = null;
        else {
          const px = propCenter(prop);
          if (dist(p, px) <= GATHER_RANGE) tryGather(p, prop);
          else moveToward(p, px.x, px.y, moveSpeed(p), dt);
        }
      } else if (p.target.lootId != null) {
        const pile = state.lootPiles[p.target.lootId];
        if (!pile) p.target = null;
        else if (dist(p, pile) <= GATHER_RANGE) { pickupLoot(p, p.target.lootId); p.target = null; }
        else moveToward(p, pile.x, pile.y, moveSpeed(p), dt);
      } else if (p.target.cook) {
        const fire = state.props.find((pr) => pr.kind === "campfire");
        if (!fire) p.target = null;
        else if (dist(p, fire) <= GATHER_RANGE) { tryCookAtFire(p); p.target = null; }
        else moveToward(p, fire.x, fire.y, moveSpeed(p), dt);
      } else {
        const d = Math.hypot(p.target.x - p.x, p.target.y - p.y);
        if (d < 4) { p.x = p.target.x; p.y = p.target.y; p.target = null; }
        else moveToward(p, p.target.x, p.target.y, moveSpeed(p), dt);
      }
    }
    resolveSolid(p);
    updateCreatures(dt, p);

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i]; pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 40 * dt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.floatTexts.length - 1; i >= 0; i--) {
      const ft = state.floatTexts[i]; ft.life -= dt; ft.y -= 20 * dt;
      if (ft.life <= 0) state.floatTexts.splice(i, 1);
    }
    for (let i = state.tapMarkers.length - 1; i >= 0; i--) {
      state.tapMarkers[i].life -= dt;
      if (state.tapMarkers[i].life <= 0) state.tapMarkers.splice(i, 1);
    }
    if (state.toastTimer > 0) {
      state.toastTimer -= dt;
      if (state.toastTimer <= 0) {
        const el = document.getElementById("toast");
        if (el) el.classList.remove("show");
      }
    }
    if (Math.floor(state.time / 20) !== Math.floor((state.time - dt) / 20)) saveGame(true);
    updateHud();
  }

  function updateCreatures(dt, p) {
    for (const c of state.creatures) {
      if (!c.alive || !onMap(c)) continue;
      c.hitFlash = Math.max(0, c.hitFlash - dt);
      c.attackCd = Math.max(0, c.attackCd - dt);
      const d = dist(c, p);
      const def = CREATURE_DEFS[c.type];

      if (!c.aggressive && c.flee) {
        if (d < (c.agro || 80)) {
          const ang = Math.atan2(c.y - p.y, c.x - p.x);
          moveToward(c, c.x + Math.cos(ang) * 40, c.y + Math.sin(ang) * 40, c.speed, dt);
        } else wander(c, dt);
        resolveSolid(c);
        continue;
      }

      // Fort attack for zombies/goblins near player base
      let fort = null, fortDist = 9999;
      if (c.aggressive) {
        for (const b of buildingsList()) {
          if (!b.base || !b.base.claimed || b.base.wallHp <= 0) continue;
          const center = buildingCenter(b);
          if (dist(p, center) > 220) continue;
          const fd = dist(c, center);
          if (fd < fortDist) { fortDist = fd; fort = b; }
        }
      }
      if (fort && fortDist < AGRO_BASE + 40 && d > 70) {
        const door = { x: fort.x + fort.w / 2, y: fort.y + fort.h + 4 };
        if (dist(c, door) > 18) moveToward(c, door.x, door.y, c.speed, dt);
        else if (c.attackCd <= 0) {
          c.attackCd = 1.0;
          const dmg = 3 + Math.floor(Math.random() * 4);
          fort.base.wallHp = Math.max(0, fort.base.wallHp - dmg);
          floatText(door.x, door.y - 10, "-" + dmg, "#e0b45a");
          if (fort.base.wallHp <= 0) toast("Barricade broken!", "bad");
        }
      } else if (c.aggressive && d < (c.agro || AGRO_BASE)) {
        moveToward(c, p.x, p.y, c.speed, dt);
        if (d < c.r + p.r + 4 && c.attackCd <= 0) {
          const ib = playerBuilding();
          if (ib && ib.base && ib.base.claimed && ib.base.wallHp > 0) {
            c.attackCd = 1.1;
            const dmg = 2 + Math.floor(Math.random() * 3);
            ib.base.wallHp = Math.max(0, ib.base.wallHp - dmg);
            floatText(ib.x + ib.w / 2, ib.y, "wall -" + dmg, "#e0b45a");
          } else {
            c.attackCd = 1.05;
            const raw = def.dmg[0] + Math.floor(Math.random() * (def.dmg[1] - def.dmg[0] + 1));
            const dmg = reduceDamage(raw, armorTotal(p.equip));
            p.hp -= dmg;
            floatText(p.x, p.y - 20, "-" + dmg, "#e05a5a");
            burst(p.x, p.y, "#e05a5a", 5);
            if (p.hp <= 0) { playerDie(); break; }
          }
        }
      } else wander(c, dt);

      // Follow player through open doors (unclaimed or breached)
      if (c.aggressive && state.mapId === "overworld") {
        for (const door of state.props) {
          if (door.kind !== "door" || !door.enter || !onMap(door)) continue;
          if (dist(c, door) > 28) continue;
          const b = getBuildingById(door.buildingId);
          if (!b) continue;
          const open = !b.base.claimed || b.base.wallHp <= 0;
          if (!open) continue;
          if (Math.random() < 0.02) {
            const interior = state.interiors[door.buildingId];
            if (!interior) continue;
            c.mapId = interior.mapId;
            c.x = interior.w / 2; c.y = interior.h - 50;
          }
        }
      }
      resolveSolid(c);
    }
  }

  function wander(c, dt) {
    c.wanderT -= dt;
    if (c.wanderT <= 0) {
      c.wanderT = 2 + Math.random() * 3;
      c.wx = clamp(c.x + (Math.random() - 0.5) * 120, 40, WORLD_W - 40);
      c.wy = clamp(c.y + (Math.random() - 0.5) * 120, 40, WORLD_H - 40);
    }
    moveToward(c, c.wx, c.wy, c.speed * 0.35, dt);
  }

  function spawnNightZombies() {
    const camp = state.props.find((pr) => pr.kind === "campfire");
    const cx = camp ? camp.x : WORLD_W / 2, cy = camp ? camp.y : WORLD_H / 2;
    const alive = state.creatures.filter((c) => c.alive && c.type === "zombie").length;
    const add = Math.min(5, Math.max(0, 28 - alive));
    for (let i = 0; i < add; i++) {
      const ang = Math.random() * Math.PI * 2, rad = 380 + Math.random() * 480;
      state.creatures.push(makeCreature("zombie",
        clamp(cx + Math.cos(ang) * rad, 60, WORLD_W - 60),
        clamp(cy + Math.sin(ang) * rad, 60, WORLD_H - 60)));
    }
    if (add) toast(add + " more dead stir…", "bad");
  }


  // ── Input ──
  const canvas = document.getElementById("game");
  const minimap = document.getElementById("minimap");
  const ctx = canvas.getContext("2d");
  const mctx = minimap.getContext("2d");

  function canvasToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return clientToWorld(clientX, clientY, rect, state.cam, state.viewW, state.viewH);
  }

  function hitTestWorld(w) {
    let bestC = null, bestCd = 40;
    for (const c of activeCreatures()) {
      const d = Math.hypot(c.x - w.x, c.y - w.y);
      if (d < c.r + 28 && d < bestCd) { bestC = c; bestCd = d; }
    }
    let lootIdx = -1;
    for (let i = 0; i < state.lootPiles.length; i++) {
      const pile = state.lootPiles[i];
      if (!onMap(pile)) continue;
      if (Math.hypot(pile.x - w.x, pile.y - w.y) < 28) { lootIdx = i; break; }
    }
    let bestP = -1, bestPd = 46;
    for (let i = 0; i < state.props.length; i++) {
      const prop = state.props[i];
      if (!onMap(prop)) continue;
      if (prop.kind === "building" || prop.kind === "pond" || prop.kind === "floor" || prop.kind === "wall") continue;
      if (prop.gathered) continue;
      if (prop.hp != null && prop.hp <= 0 && !prop.infinite) continue;
      const pc = propCenter(prop);
      const d = Math.hypot(pc.x - w.x, pc.y - w.y);
      let hitR = (prop.r || 14) + 22;
      if (prop.kind === "furniture") {
        const def = FURNITURE_DEFS[prop.furniture];
        if (def) hitR = Math.max(def.w, def.h) / 2 + 12;
      }
      if (d < hitR && d < bestPd) { bestP = i; bestPd = d; }
    }
    return { creature: bestC, lootIdx, propId: bestP, world: w };
  }

  function defaultTap(hit) {
    const p = state.player;
    state.tapMarkers.push({ x: hit.world.x, y: hit.world.y, life: 0.55 });
    if (state.placeMode) {
      placeFurnitureAt(hit.world.x, hit.world.y);
      return;
    }
    if (hit.creature) { p.target = { creatureId: hit.creature.id }; return; }
    if (hit.lootIdx >= 0) { p.target = { lootId: hit.lootIdx }; return; }
    if (hit.propId >= 0) {
      const prop = state.props[hit.propId];
      if (prop && prop.kind === "door") { tryDoor(prop); return; }
      if (prop && prop.kind === "trader") { openShop(); return; }
      if (prop && prop.kind === "furniture" && prop.fn === "bank") { openBank(); return; }
      if (prop && (prop.kind === "cupboard" || prop.kind === "fridge")) {
        p.target = { propId: hit.propId }; return;
      }
      if (prop && prop.kind === "furniture" && prop.fn === "cook") {
        p.target = { cook: true }; return;
      }
      p.target = { propId: hit.propId }; return;
    }
    const sz = mapWorldSize();
    p.target = {
      x: clamp(hit.world.x, 20, sz.w - 20),
      y: clamp(hit.world.y, 20, sz.h - 20),
    };
  }

  function buildContextActions(hit) {
    const actions = [];
    if (hit.propId >= 0) {
      const prop = state.props[hit.propId];
      if (prop && prop.kind === "door") {
        actions.push({ id: "door", label: prop.exit ? "Exit building" : "Enter building" });
      }
      if (prop && prop.kind === "trader") actions.push({ id: "shop", label: "Trade with " + (prop.name || "trader") });
      if (prop && prop.kind === "furniture" && prop.fn === "bank") actions.push({ id: "bank", label: "Open bank" });
      if (prop && prop.kind === "furniture" && prop.placed) {
        actions.push({ id: "furn_rotate", label: "Rotate furniture" });
        actions.push({ id: "furn_pickup", label: "Pick up furniture" });
      }
    }
    if (hit.creature) {
      const def = CREATURE_DEFS[hit.creature.type];
      actions.push({ id: "attack", label: "Attack " + def.name });
      actions.push({ id: "examine", label: "Examine " + def.name });
    }
    if (hit.lootIdx >= 0) {
      actions.push({ id: "pickup", label: "Pick up loot" });
      actions.push({ id: "examine_loot", label: "Examine loot" });
    }
    if (hit.propId >= 0) {
      const prop = state.props[hit.propId];
      const nd = NODE_DEFS[prop.node || prop.kind];
      if (prop.kind === "crate") actions.push({ id: "loot_crate", label: "Loot crate" });
      else if (prop.kind === "campfire") {
        actions.push({ id: "cook", label: "Cook food" });
        actions.push({ id: "examine_fire", label: "Examine campfire" });
      } else if (prop.kind === "forge") {
        actions.push({ id: "smith", label: "Use forge (Smith)" });
        actions.push({ id: "examine_forge", label: "Examine forge" });
      } else if (nd) {
        actions.push({ id: "gather", label: (nd.verb || "Gather") + " " + nd.label });
        actions.push({ id: "examine_node", label: "Examine " + nd.label });
      }
    }
    // building under cursor?
    const b = buildingAt(hit.world.x, hit.world.y);
    if (b) {
      actions.push({ id: "examine_building", label: "Examine building" });
      if (pointInBuilding(state.player.x, state.player.y, b) && b.base && !b.base.claimed) {
        actions.push({ id: "claim", label: "Claim building" });
      }
    }
    actions.push({ id: "walk", label: "Walk here" });
    return actions;
  }

  function runContextAction(actionId, hit) {
    const p = state.player;
    hideContextMenu();
    if (actionId === "attack" && hit.creature) p.target = { creatureId: hit.creature.id };
    else if (actionId === "pickup" && hit.lootIdx >= 0) p.target = { lootId: hit.lootIdx };
    else if ((actionId === "gather" || actionId === "loot_crate") && hit.propId >= 0) p.target = { propId: hit.propId };
    else if (actionId === "cook") p.target = { cook: true };
    else if (actionId === "smith") openWorkshop("smith");
    else if (actionId === "door" && hit.propId >= 0) tryDoor(state.props[hit.propId]);
    else if (actionId === "shop") openShop();
    else if (actionId === "bank") openBank();
    else if (actionId === "furn_rotate" && hit.propId >= 0) rotateFurniture(state.props[hit.propId]);
    else if (actionId === "furn_pickup" && hit.propId >= 0) pickupFurniture(state.props[hit.propId]);
    else if (actionId === "claim") {
      const b = buildingAt(hit.world.x, hit.world.y);
      if (b) { claimBuilding(b); renderWorkshop(); }
    } else if (actionId === "walk") {
      const sz = mapWorldSize();
      p.target = { x: clamp(hit.world.x, 20, sz.w - 20), y: clamp(hit.world.y, 20, sz.h - 20) };
    } else if (actionId.startsWith("examine")) {
      examineHit(hit, actionId);
    }
  }

  function examineHit(hit, actionId) {
    if (hit.creature) {
      const d = CREATURE_DEFS[hit.creature.type];
      toast(d.name + " — " + (d.aggressive ? "aggressive" : "skittish") + ", HP " + hit.creature.hp, "sys");
    } else if (hit.lootIdx >= 0) {
      const pile = state.lootPiles[hit.lootIdx];
      toast("Loot: " + pile.items.map((i) => ITEM_DEFS[i.id].name + "×" + i.qty).join(", "), "sys");
    } else if (hit.propId >= 0) {
      const prop = state.props[hit.propId];
      const nd = NODE_DEFS[prop.node || prop.kind];
      if (nd) toast(nd.label + (nd.tool ? " (needs " + nd.tool + " t" + nd.tier + "+)" : ""), "sys");
      else toast(prop.kind, "sys");
    } else {
      const b = buildingAt(hit.world.x, hit.world.y);
      if (b && b.base) {
        const t = BUILDING_TYPES[b.base.type] || BUILDING_TYPES.none;
        toast((b.base.claimed ? t.name : "Unclaimed building") + " — fort " + b.base.wallHp + "/" + b.base.wallMax, "sys");
      } else toast("Nothing interesting.", "sys");
    }
  }

  function showContextMenu(clientX, clientY, hit) {
    const actions = buildContextActions(hit);
    state.contextMenu = { hit, actions };
    const menu = document.getElementById("context-menu");
    const list = document.getElementById("context-list");
    list.innerHTML = actions.map((a, i) =>
      `<button type="button" class="ctx-item" data-act="${a.id}">${a.label}</button>`).join("");
    menu.classList.add("open");
    // position within viewport
    const pad = 8;
    let left = clientX, top = clientY;
    menu.style.left = "0px"; menu.style.top = "0px";
    menu.style.visibility = "hidden"; menu.style.display = "block";
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    left = Math.min(window.innerWidth - mw - pad, Math.max(pad, left));
    top = Math.min(window.innerHeight - mh - pad, Math.max(pad, top));
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.visibility = "visible";
    state.paused = true;
    list.querySelectorAll(".ctx-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        runContextAction(btn.dataset.act, hit);
      });
    });
  }
  function hideContextMenu() {
    state.contextMenu = null;
    const menu = document.getElementById("context-menu");
    if (menu) { menu.classList.remove("open"); menu.style.display = "none"; }
    if (!document.querySelector(".overlay.open")) state.paused = false;
  }

  let pressTimer = null, pressOrigin = null, pressHit = null, moved = false;

  function clearPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressOrigin = null; pressHit = null; moved = false;
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (e.pointerType === "mouse" && e.button === 2) {
      // right-click context
      if (!state.running || state.deathTimer > 0) return;
      const w = canvasToWorld(e.clientX, e.clientY);
      const hit = hitTestWorld(w);
      showContextMenu(e.clientX, e.clientY, hit);
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!state.running || state.paused || state.deathTimer > 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    const w = canvasToWorld(e.clientX, e.clientY);
    pressOrigin = { x: e.clientX, y: e.clientY };
    pressHit = hitTestWorld(w);
    moved = false;
    pressTimer = setTimeout(() => {
      if (!moved && pressHit) showContextMenu(e.clientX, e.clientY, pressHit);
      clearPress();
    }, 450);
  }, { passive: false });

  canvas.addEventListener("pointermove", (e) => {
    if (!pressOrigin) return;
    if (Math.hypot(e.clientX - pressOrigin.x, e.clientY - pressOrigin.y) > 14) {
      moved = true;
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse" && e.button === 2) return;
    if (!pressOrigin) return;
    const wasLong = !pressTimer; // timer already fired
    const hit = pressHit;
    const didMove = moved;
    clearPress();
    if (wasLong || didMove) return;
    if (!state.running || state.paused || state.deathTimer > 0) return;
    if (state.contextMenu) { hideContextMenu(); return; }
    defaultTap(hit);
  });

  canvas.addEventListener("pointercancel", () => clearPress());
  canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchstart", (e) => { e.preventDefault(); }, { passive: false });
  canvas.addEventListener("gesturestart", (e) => { e.preventDefault(); }, { passive: false });


  // ── Render ──
  function resize() {
    const wrap = document.getElementById("canvas-wrap");
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
    state.viewW = w; state.viewH = h;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function dayFactor() {
    const t = state.dayTimer / DAY_LEN;
    if (t < 0.15) return 0.45 + (t / 0.15) * 0.55;
    if (t < 0.55) return 1;
    if (t < 0.7) return 1 - ((t - 0.55) / 0.15) * 0.55;
    return 0.4;
  }
  function timeLabel() {
    const t = state.dayTimer / DAY_LEN;
    if (t < 0.15) return "Dawn"; if (t < 0.55) return "Day"; if (t < 0.7) return "Dusk"; return "Night";
  }

  function render() {
    const vw = state.viewW, vh = state.viewH;
    if (!state.player) { ctx.fillStyle = "#3a5a28"; ctx.fillRect(0, 0, vw, vh); return; }
    const p = state.player;
    const sz = mapWorldSize();
    state.cam.x = clamp(p.x - vw / 2, 0, Math.max(0, sz.w - vw));
    state.cam.y = clamp(p.y - vh / 2, 0, Math.max(0, sz.h - vh));
    const cam = state.cam, light = dayFactor();

    const t0x = Math.floor(cam.x / TILE) - 1, t0y = Math.floor(cam.y / TILE) - 1;
    const t1x = Math.ceil((cam.x + vw) / TILE) + 1, t1y = Math.ceil((cam.y + vh) / TILE) + 1;
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const hsh = ((tx * 73856093) ^ (ty * 19349663) ^ state.seed) >>> 0;
        const kind = hsh % 7;
        let r, g, b;
        if (kind < 4) { r = 40 + (hsh % 20); g = (90 + light * 40 + (hsh % 25)) | 0; b = 35; }
        else if (kind < 6) { r = 90 + (hsh % 20); g = 70 + (hsh % 15); b = 40; }
        else { r = 110; g = 105; b = 85; }
        ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
        ctx.fillRect(tx * TILE - cam.x, ty * TILE - cam.y, TILE, TILE);
      }
    }

    for (const prop of activeProps()) drawProp(prop, cam, light, vw, vh);
    for (const pile of activeLoot()) {
      const sx = pile.x - cam.x, sy = pile.y - cam.y;
      if (sx < -20 || sy < -20 || sx > vw + 20 || sy > vh + 20) continue;
      ctx.fillStyle = pile.deathDrop ? "#e8c860" : "#c9a05a";
      ctx.fillRect(sx - 9, sy - 7, 18, 14);
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.strokeRect(sx - 9, sy - 7, 18, 14);
    }
    for (const c of activeCreatures()) {
      const sx = c.x - cam.x, sy = c.y - cam.y;
      if (sx < -30 || sy < -30 || sx > vw + 30 || sy > vh + 30) continue;
      drawCreature(sx, sy, c);
    }
    for (const pr of state.projectiles) {
      ctx.fillStyle = pr.color;
      ctx.beginPath(); ctx.arc(pr.x - cam.x, pr.y - cam.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    if (p.alive || state.deathTimer > 0) drawPlayer(p.x - cam.x, p.y - cam.y, p);

    for (const tm of state.tapMarkers) {
      const a = Math.max(0, tm.life / 0.55);
      ctx.beginPath(); ctx.arc(tm.x - cam.x, tm.y - cam.y, 10 + (1 - a) * 8, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(232,200,96,${a})`; ctx.lineWidth = 2; ctx.stroke();
    }
    if (p.target && p.target.x != null && !p.target.creatureId && p.target.propId == null && p.target.lootId == null && !p.target.cook) {
      ctx.beginPath(); ctx.arc(p.target.x - cam.x, p.target.y - cam.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(232,200,96,0.75)"; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life * 2);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - cam.x - pt.r, pt.y - cam.y - pt.r, pt.r * 2, pt.r * 2);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "center"; ctx.font = "bold 12px Georgia";
    for (const ft of state.floatTexts) {
      ctx.globalAlpha = Math.min(1, ft.life * 2);
      ctx.fillStyle = ft.color; ctx.fillText(ft.text, ft.x - cam.x, ft.y - cam.y);
      ctx.globalAlpha = 1;
    }
    if (light < 0.85) {
      const g = ctx.createRadialGradient(vw/2, vh/2, vw*0.2, vw/2, vh/2, vw*0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(10,6,2,${(1-light)*0.55})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
    }
    if (state.mapId !== "overworld") {
      ctx.fillStyle = "rgba(20,14,6,0.75)";
      ctx.fillRect(8, 8, 160, 28);
      ctx.strokeStyle = "#8a6a38"; ctx.strokeRect(8, 8, 160, 28);
      ctx.fillStyle = "#e8c860"; ctx.font = "bold 12px Georgia"; ctx.textAlign = "left";
      ctx.fillText("Interior — tap EXIT door", 16, 27);
    }
    if (state.placeMode) {
      ctx.fillStyle = "rgba(20,14,6,0.8)";
      ctx.fillRect(8, vh - 40, 220, 32);
      ctx.fillStyle = "#e8c860"; ctx.font = "bold 12px Georgia"; ctx.textAlign = "left";
      const nm = (FURNITURE_DEFS[state.placeMode.type] || {}).name || state.placeMode.type;
      ctx.fillText("Placing: " + nm + " (tap floor)", 16, vh - 20);
    }
    drawMinimap();
  }

  function drawProp(prop, cam, light, vw, vh) {
    if (prop.kind === "building") {
      const sx = prop.x - cam.x, sy = prop.y - cam.y;
      if (sx + prop.w < -40 || sy + prop.h < -40 || sx > vw + 40 || sy > vh + 40) return;
      ctx.fillStyle = prop.goblinHut ? "#4a5a38" : "#6a6050";
      ctx.fillRect(sx, sy, prop.w, prop.h);
      ctx.fillStyle = "#5a4030";
      ctx.fillRect(sx, sy, prop.w, 10); ctx.fillRect(sx, sy + prop.h - 10, prop.w, 10);
      ctx.fillRect(sx, sy, 10, prop.h); ctx.fillRect(sx + prop.w - 10, sy, 10, prop.h);
      ctx.fillStyle = prop.goblinHut ? "#3a6a30" : "#7a3030";
      ctx.beginPath(); ctx.moveTo(sx - 4, sy + 4); ctx.lineTo(sx + prop.w/2, sy - 20); ctx.lineTo(sx + prop.w + 4, sy + 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 3; ctx.strokeRect(sx, sy, prop.w, prop.h);
      const win = (prop.base && prop.base.boarded) ? "#5a4028" : "#80a0c0";
      ctx.fillStyle = win; ctx.fillRect(sx + 16, sy + 26, 14, 12); ctx.fillRect(sx + prop.w - 30, sy + 26, 14, 12);
      if (prop.base && prop.base.claimed) {
        const label = (BUILDING_TYPES[prop.base.type] && BUILDING_TYPES[prop.base.type].name) || "Claimed";
        ctx.fillStyle = "#e8c860"; ctx.font = "bold 11px Georgia"; ctx.textAlign = "center";
        ctx.fillText(label, sx + prop.w/2, sy - 26);
        if (prop.base.wallMax > 0) {
          ctx.fillStyle = "#1a1208"; ctx.fillRect(sx + 10, sy + prop.h + 4, prop.w - 20, 5);
          ctx.fillStyle = "#6aaa40"; ctx.fillRect(sx + 10, sy + prop.h + 4, (prop.w - 20) * (prop.base.wallHp / prop.base.wallMax), 5);
        }
      }
      return;
    }
    const sx = prop.x - cam.x, sy = prop.y - cam.y;
    if (sx < -50 || sy < -50 || sx > vw + 50 || sy > vh + 50) return;
    if (prop.kind === "pond") {
      ctx.fillStyle = "#2a5a7a"; ctx.fillRect(sx, sy, prop.w, prop.h);
      ctx.strokeStyle = "#1a1208"; ctx.strokeRect(sx, sy, prop.w, prop.h);
      return;
    }
    if (prop.kind === "floor") {
      // tiled interior floor
      for (let yy = 0; yy < prop.h; yy += TILE) {
        for (let xx = 0; xx < prop.w; xx += TILE) {
          const odd = ((xx + yy) / TILE) % 2 === 0;
          ctx.fillStyle = odd ? "#5a4a38" : "#4a3a2a";
          ctx.fillRect(sx + xx, sy + yy, TILE, TILE);
        }
      }
      return;
    }
    if (prop.kind === "wall") {
      ctx.fillStyle = "#3a3228";
      ctx.fillRect(sx, sy, prop.w, prop.h);
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 1; ctx.strokeRect(sx, sy, prop.w, prop.h);
      return;
    }
    if (prop.kind === "door") {
      ctx.fillStyle = "#8a6a30";
      ctx.fillRect(sx - 14, sy - 10, 28, 20);
      ctx.strokeStyle = "#e8c860"; ctx.lineWidth = 2; ctx.strokeRect(sx - 14, sy - 10, 28, 20);
      ctx.fillStyle = "#e8c860"; ctx.font = "bold 9px Georgia"; ctx.textAlign = "center";
      ctx.fillText(prop.exit ? "EXIT" : "ENTER", sx, sy + 4);
      return;
    }
    if (prop.kind === "cupboard" || prop.kind === "fridge") {
      ctx.fillStyle = prop.kind === "fridge" ? "#8090a0" : "#6a4a28";
      ctx.fillRect(sx - 12, sy - 16, 24, 32);
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.strokeRect(sx - 12, sy - 16, 24, 32);
      return;
    }
    if (prop.kind === "trader") {
      ctx.fillStyle = "#4a6a8a";
      ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#d2b48c"; ctx.beginPath(); ctx.arc(sx, sy - 10, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8c860"; ctx.font = "bold 9px Georgia"; ctx.textAlign = "center";
      ctx.fillText("SHOP", sx, sy + 24);
      return;
    }
    if (prop.kind === "furniture") {
      const def = FURNITURE_DEFS[prop.furniture] || { w: 20, h: 20, color: "#888", name: "?" };
      const rect = furnitureRect(prop.x, prop.y, def, prop.rot || 0);
      const fx = rect.x - cam.x, fy = rect.y - cam.y;
      ctx.fillStyle = def.color || "#888";
      ctx.fillRect(fx, fy, rect.w, rect.h);
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.strokeRect(fx, fy, rect.w, rect.h);
      if (prop.fn === "light") {
        const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, 50);
        g.addColorStop(0, "rgba(255,200,80,0.25)"); g.addColorStop(1, "rgba(255,200,80,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 50, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    if (prop.kind === "campfire") {
      ctx.fillStyle = "#3a2a18"; ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI*2); ctx.fill();
      const flick = 9 + Math.sin(state.time * 9) * 2;
      ctx.fillStyle = "#e8a020"; ctx.beginPath(); ctx.arc(sx, sy - 4, flick, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#e8c860"; ctx.font = "bold 9px Georgia"; ctx.textAlign = "center"; ctx.fillText("CAMP", sx, sy + 26);
      return;
    }
    if (prop.kind === "forge") {
      ctx.fillStyle = "#4a3a30"; ctx.fillRect(sx - 14, sy - 10, 28, 22);
      ctx.fillStyle = "#c04020"; ctx.fillRect(sx - 8, sy - 4, 16, 10);
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.strokeRect(sx - 14, sy - 10, 28, 22);
      ctx.fillStyle = "#e8c860"; ctx.font = "bold 9px Georgia"; ctx.textAlign = "center"; ctx.fillText("FORGE", sx, sy + 24);
      return;
    }
    if (prop.gathered || (prop.hp != null && prop.hp <= 0 && !prop.infinite)) {
      if (prop.kind === "tree" || prop.kind === "oak") {
        ctx.fillStyle = "#5a4030"; ctx.fillRect(sx - 5, sy - 2, 10, 12);
      }
      return;
    }
    if (prop.kind === "tree" || prop.kind === "oak") {
      ctx.fillStyle = "#5a3820"; ctx.fillRect(sx - 5, sy - 2, 10, 18);
      ctx.fillStyle = prop.kind === "oak" ? "#2a6a30" : `rgb(30,${(100+light*30)|0},40)`;
      ctx.beginPath(); ctx.arc(sx, sy - 16, prop.kind === "oak" ? 17 : 14, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.stroke();
      return;
    }
    if (prop.kind === "bush") {
      ctx.fillStyle = `rgb(35,${(110+light*25)|0},45)`;
      ctx.beginPath(); ctx.ellipse(sx, sy, 14, 10, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#c04080"; ctx.fillRect(sx - 4, sy - 2, 4, 4);
      return;
    }
    if (prop.kind === "crate") {
      ctx.fillStyle = "#8a6a30"; ctx.fillRect(sx - 12, sy - 10, 24, 20);
      ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.strokeRect(sx - 12, sy - 10, 24, 20);
      return;
    }
    if (prop.kind === "fish_spot") {
      ctx.fillStyle = "rgba(60,120,180,0.55)";
      ctx.beginPath(); ctx.ellipse(sx, sy, 18, 10, 0, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "#e8c860"; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    // rocks
    const rockColor = prop.kind === "copper_rock" ? "#b08d57" : prop.kind === "tin_rock" ? "#a0a8b0" : prop.kind === "iron_rock" ? "#6a7078" : "#7a8088";
    ctx.fillStyle = rockColor;
    ctx.beginPath(); ctx.moveTo(sx - 12, sy + 6); ctx.lineTo(sx - 4, sy - 10); ctx.lineTo(sx + 12, sy - 4); ctx.lineTo(sx + 10, sy + 8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.stroke();
  }

  function drawPlayer(sx, sy, p) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(sx, sy + 11, 11, 4, 0, 0, Math.PI*2); ctx.fill();
    // cape
    if (p.equip.cape && ITEM_DEFS[p.equip.cape]) {
      ctx.fillStyle = ITEM_DEFS[p.equip.cape].tint || "#8a3030";
      ctx.fillRect(sx - 10, sy - 4, 6, 16);
    }
    const bodyTint = (p.equip.body && ITEM_DEFS[p.equip.body] && ITEM_DEFS[p.equip.body].tint) || "#3a6a4a";
    ctx.fillStyle = bodyTint;
    ctx.beginPath(); ctx.arc(sx, sy, p.r, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 3; ctx.stroke();
    // legs
    if (p.equip.legs && ITEM_DEFS[p.equip.legs]) {
      ctx.fillStyle = ITEM_DEFS[p.equip.legs].tint;
      ctx.fillRect(sx - 8, sy + 6, 7, 8); ctx.fillRect(sx + 1, sy + 6, 7, 8);
    }
    // head / helm
    const headTint = (p.equip.head && ITEM_DEFS[p.equip.head] && ITEM_DEFS[p.equip.head].tint) || "#d2b48c";
    ctx.fillStyle = headTint;
    ctx.beginPath(); ctx.arc(sx, sy - 8, 7, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.stroke();
    // boots
    if (p.equip.feet && ITEM_DEFS[p.equip.feet]) {
      ctx.fillStyle = ITEM_DEFS[p.equip.feet].tint;
      ctx.fillRect(sx - 9, sy + 12, 7, 4); ctx.fillRect(sx + 2, sy + 12, 7, 4);
    }
    const fx = Math.cos(p.facing || 0) * 7, fy = Math.sin(p.facing || 0) * 7;
    if (p.equip.weapon) {
      const wdef = ITEM_DEFS[p.equip.weapon];
      ctx.strokeStyle = wdef && wdef.style === "ranged" ? "#8a5a30" : "#c9c0a0";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx + fx * 0.4, sy + fy * 0.4); ctx.lineTo(sx + fx * 2.4, sy + fy * 2.4); ctx.stroke();
    }
  }

  function drawCreature(sx, sy, c) {
    const def = CREATURE_DEFS[c.type];
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(sx, sy + c.r * 0.8, c.r * 0.9, 3, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = c.hitFlash > 0 ? "#c8e0a0" : def.color;
    if (c.type === "chicken") {
      ctx.beginPath(); ctx.ellipse(sx, sy, c.r + 2, c.r, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#e05030"; ctx.beginPath(); ctx.moveTo(sx + c.r, sy); ctx.lineTo(sx + c.r + 5, sy + 2); ctx.lineTo(sx + c.r, sy + 4); ctx.fill();
    } else if (c.type === "squirrel") {
      ctx.beginPath(); ctx.arc(sx, sy, c.r, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx - c.r, sy - 2, 5, 3, -0.5, 0, Math.PI*2); ctx.fill();
    } else if (c.type === "rat") {
      ctx.beginPath(); ctx.ellipse(sx, sy, c.r + 2, c.r - 1, 0, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "#4a3a30"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx - c.r, sy); ctx.lineTo(sx - c.r - 8, sy + 2); ctx.stroke();
    } else if (c.type === "goblin") {
      ctx.beginPath(); ctx.arc(sx, sy, c.r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#d2b48c"; ctx.beginPath(); ctx.arc(sx, sy - 8, 6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#3a5a28"; ctx.beginPath(); ctx.moveTo(sx - 6, sy - 10); ctx.lineTo(sx - 10, sy - 16); ctx.lineTo(sx - 2, sy - 12); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx + 6, sy - 10); ctx.lineTo(sx + 10, sy - 16); ctx.lineTo(sx + 2, sy - 12); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(sx, sy, c.r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#c04040"; ctx.fillRect(sx - 5, sy - 5, 3, 3); ctx.fillRect(sx + 2, sy - 5, 3, 3);
    }
    ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, c.r, 0, Math.PI*2); ctx.stroke();
    if (c.hp < c.maxHp) {
      ctx.fillStyle = "#1a1208"; ctx.fillRect(sx - 12, sy - c.r - 10, 24, 4);
      ctx.fillStyle = "#c04040"; ctx.fillRect(sx - 12, sy - c.r - 10, 24 * clamp(c.hp / c.maxHp, 0, 1), 4);
    }
  }

  function drawMinimap() {
    mctx.clearRect(0, 0, 76, 76);
    mctx.fillStyle = "rgba(30,45,25,0.95)"; mctx.fillRect(0, 0, 76, 76);
    const sz = mapWorldSize();
    const s = 76 / Math.max(sz.w, sz.h);
    for (const prop of activeProps()) {
      if (prop.kind === "building") {
        mctx.fillStyle = (prop.base && prop.base.claimed) ? "#e8c860" : "#6a5438";
        mctx.fillRect(prop.x * s, prop.y * s, Math.max(2, prop.w * s), Math.max(2, prop.h * s));
      } else if (prop.kind === "campfire" || prop.kind === "door") {
        mctx.fillStyle = "#e08020"; mctx.fillRect(prop.x * s - 1, prop.y * s - 1, 3, 3);
      } else if (prop.kind === "wall") {
        mctx.fillStyle = "#3a3228";
        mctx.fillRect(prop.x * s, prop.y * s, Math.max(1, prop.w * s), Math.max(1, prop.h * s));
      }
    }
    for (const c of activeCreatures()) {
      mctx.fillStyle = c.type === "goblin" ? "#80c040" : c.aggressive ? "#c04040" : "#e0c080";
      mctx.fillRect(c.x * s - 0.5, c.y * s - 0.5, 2, 2);
    }
    if (state.player) {
      mctx.fillStyle = "#80c060";
      mctx.fillRect(state.player.x * s - 1.5, state.player.y * s - 1.5, 3, 3);
    }
  }


  // ── UI ──
  function updateHud() {
    const p = state.player; if (!p) return;
    document.querySelector("#bar-health i").style.width = clamp(p.hp / p.maxHp, 0, 1) * 100 + "%";
    document.querySelector("#bar-hunger i").style.width = clamp(p.hunger / p.maxHunger, 0, 1) * 100 + "%";
    document.getElementById("val-health").textContent = Math.ceil(Math.max(0, p.hp));
    document.getElementById("val-hunger").textContent = Math.ceil(p.hunger);
    document.getElementById("val-day").textContent = String(state.day);
    document.getElementById("val-time").textContent = timeLabel();
    const c = p.skills.combat;
    document.querySelector("#bar-xp i").style.width = (c.xp / c.next) * 100 + "%";
    const sk = document.getElementById("hud-skills");
    const show = ["combat", "ranged", "woodcutting", "mining", "fishing", "cooking", "crafting", "smithing", "construction"];
    sk.innerHTML = show.map((n) =>
      `<span class="skill-chip">${SKILL_LABELS[n]} <strong>${p.skills[n].level}</strong></span>`
    ).join("") + `<span class="skill-chip">Armor <strong>${armorTotal(p.equip)}</strong></span>`
      + `<span class="skill-chip">Kills <strong>${p.kills}</strong></span>`;
  }

  function openOverlay(id) {
    hideContextMenu();
    state.paused = true;
    document.querySelectorAll(".overlay").forEach((el) => el.classList.remove("open"));
    document.getElementById(id).classList.add("open");
  }
  function closeOverlays() {
    document.querySelectorAll(".overlay").forEach((el) => el.classList.remove("open"));
    state.paused = false;
    state.selectedInv = -1;
  }

  function openWorkshop(tab) {
    state.workshopTab = tab || "craft";
    renderWorkshop();
    openOverlay("overlay-workshop");
  }

  function renderWorkshop() {
    const p = state.player;
    document.querySelectorAll(".ws-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === state.workshopTab);
    });
    const body = document.getElementById("workshop-body");
    const status = document.getElementById("workshop-status");
    if (state.workshopTab === "craft" || state.workshopTab === "smith") {
      const tab = state.workshopTab;
      status.textContent = tab === "smith"
        ? (hasForgeAccess() ? "Forge ready. Smelt ores or smith on anvil (Workshop)." : "Find the world forge or claim a Workshop.")
        : "Tap a recipe to craft. Grey = missing mats/level/station.";
      const list = RECIPES.filter((r) => r.tab === tab);
      body.innerHTML = '<div class="craft-list" id="recipe-list"></div>';
      const rl = document.getElementById("recipe-list");
      rl.innerHTML = list.map((r) => {
        const block = recipeBlocked(r, p);
        const mats = Object.entries(r.need).map(([id, q]) => {
          const have = invCount(p.inv, id);
          const ok = have >= q;
          return `<span class="${ok ? "mat-ok" : "mat-bad"}">${ITEM_DEFS[id].name} ${have}/${q}</span>`;
        }).join(" · ");
        const cls = block ? "craft-row disabled" : "craft-row";
        return `<button type="button" class="${cls}" data-recipe="${r.id}">
          <div class="craft-main">
            <strong>${ITEM_DEFS[r.out.id].name}</strong> <span class="lvl">${SKILL_LABELS[r.skill]} ${r.level}+</span>
            <div class="mats">${mats}</div>
            ${block ? `<div class="block-reason">${block}</div>` : ""}
          </div>
          <span class="craft-go">${block ? "Locked" : "Make"}</span>
        </button>`;
      }).join("");
      rl.querySelectorAll("[data-recipe]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          const res = doCraft(btn.dataset.recipe);
          renderWorkshop(); updateHud();
          if (res && res.ok) status.textContent = res.msg;
        });
      });
    } else if (state.workshopTab === "build") {
      renderBuildTab(body, status);
    } else if (state.workshopTab === "equip") {
      renderEquipTab(body, status);
    }
  }

  function renderBuildTab(body, status) {
    const b = playerBuilding();
    const p = state.player;
    if (!b) {
      status.textContent = "Stand inside a stone building to claim or fortify it.";
      body.innerHTML = '<p class="hint">Walk into any building footprint, then open this Build tab.</p>';
      return;
    }
    const base = b.base;
    if (!base.claimed) {
      status.textContent = "Inside an unclaimed building.";
      body.innerHTML = '<button type="button" class="btn primary btn-block" id="btn-claim">Claim this building</button>';
      document.getElementById("btn-claim").onclick = (e) => {
        e.stopPropagation(); claimBuilding(b); renderWorkshop(); updateHud();
      };
      return;
    }
    const tdef = BUILDING_TYPES[base.type] || BUILDING_TYPES.none;
    status.innerHTML = `<strong>${tdef.name}</strong> — fort ${base.wallHp}/${base.wallMax}` +
      (base.boarded ? " · boarded" : "") + (base.doorReinforced ? " · door" : "") + (base.braced ? " · braced" : "");
    let html = "";
    if (base.type === "none") {
      html += '<p class="hint">Choose building type:</p><div class="build-type-grid">';
      for (const [k, def] of Object.entries(BUILDING_TYPES)) {
        if (k === "none") continue;
        html += `<button type="button" class="btn" data-type="${k}">${def.name}<br/><span class="sub">Con ${def.skill}+</span></button>`;
      }
      html += "</div>";
    }
    html += '<p class="hint">Fortify (planks & nails):</p><div class="craft-list">';
    for (const [key, f] of Object.entries(FORTIFY)) {
      const mats = Object.entries(f.need).map(([id, q]) => {
        const have = invCount(p.inv, id);
        return `<span class="${have>=q?"mat-ok":"mat-bad"}">${ITEM_DEFS[id].name} ${have}/${q}</span>`;
      }).join(" · ");
      const can = p.skills.construction.level >= f.skill && canAfford(p.inv, f.need);
      html += `<button type="button" class="craft-row ${can?"":"disabled"}" data-fort="${key}">
        <div class="craft-main"><strong>${f.label}</strong> <span class="lvl">Con ${f.skill}+</span><div class="mats">${mats}</div></div>
        <span class="craft-go">${can?"Build":"Locked"}</span></button>`;
    }
    html += "</div>";
    if (base.type === "workshop") {
      html += '<p class="hint">Workshop includes forge + anvil for the Smith tab.</p>';
    }
    // Furniture when inside this building's interior
    const bid = b.id;
    const insideHere = state.mapId === "int_" + bid;
    if (insideHere) {
      html += '<p class="hint">Furniture (tap item, then tap a floor tile):</p><div class="craft-list">';
      for (const [key, def] of Object.entries(FURNITURE_DEFS)) {
        const mats = Object.entries(def.cost).map(([id, q]) => {
          const have = invCount(p.inv, id);
          return '<span class="' + (have>=q?"mat-ok":"mat-bad") + '">' + ITEM_DEFS[id].name + " " + have + "/" + q + "</span>";
        }).join(" · ");
        const can = p.skills.construction.level >= def.skill && canAfford(p.inv, def.cost);
        const active = state.placeMode && state.placeMode.type === key;
        html += '<button type="button" class="craft-row ' + (can?"":"disabled") + (active?" selected-place":"") + '" data-furn="' + key + '">' +
          '<div class="craft-main"><strong>' + def.name + '</strong> <span class="lvl">Con ' + def.skill + '+</span><div class="mats">' + mats + '</div></div>' +
          '<span class="craft-go">' + (active ? "Selected" : "Place") + '</span></button>';
      }
      html += '</div>';
      if (state.placeMode) html += '<button type="button" class="btn btn-block" id="btn-cancel-place">Cancel placement</button>';
      html += '<p class="hint">Long-press placed furniture to rotate or pick up.</p>';
    } else {
      html += '<p class="hint">Enter the building (tap ENTER door) to place furniture inside.</p>';
    }
    body.innerHTML = html;
    body.querySelectorAll("[data-type]").forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); setBuildingType(b, btn.dataset.type); renderWorkshop(); updateHud(); };
    });
    body.querySelectorAll("[data-fort]").forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); doFortify(b, btn.dataset.fort); renderWorkshop(); updateHud(); };
    });
    body.querySelectorAll("[data-furn]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (btn.classList.contains("disabled")) return;
        state.placeMode = { type: btn.dataset.furn, rot: 0 };
        closeOverlays();
        toast("Tap a floor tile to place " + FURNITURE_DEFS[btn.dataset.furn].name, "sys");
      };
    });
    const cancel = document.getElementById("btn-cancel-place");
    if (cancel) cancel.onclick = (e) => { e.stopPropagation(); state.placeMode = null; renderWorkshop(); };
  }

  function renderEquipTab(body, status) {
    const p = state.player;
    status.textContent = "Tap an inventory item below to equip, or unequip a slot. Armor: " + armorTotal(p.equip);
    let html = '<div class="equip-grid">';
    for (const slot of EQUIP_SLOTS) {
      const id = p.equip[slot];
      const name = id ? ITEM_DEFS[id].name : "— empty —";
      html += `<button type="button" class="equip-slot" data-unequip="${slot}"><span class="slot-name">${slot}</span><span class="slot-item">${name}</span></button>`;
    }
    html += '</div><p class="hint">Equippable items in bag:</p><div class="inv-grid" id="equip-inv"></div>';
    body.innerHTML = html;
    const grid = document.getElementById("equip-inv");
    const equippable = p.inv.filter((it) => {
      const d = ITEM_DEFS[it.id];
      return d && (d.slot || d.type === "weapon" || d.type === "armor" || d.type === "ammo" || d.type === "tool");
    });
    grid.innerHTML = equippable.length ? equippable.map((it) => {
      const d = ITEM_DEFS[it.id];
      const slot = d.slot || (d.type === "tool" ? "weapon" : "");
      return `<button type="button" class="inv-item" data-equip="${it.id}"><span class="name">${d.name} ×${it.qty}</span><span class="meta">${slot || d.type}</span></button>`;
    }).join("") : "<p>No equippable gear in bag.</p>";
    body.querySelectorAll("[data-unequip]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slot = btn.dataset.unequip;
        if (p.equip[slot]) { /* stays in inv already */ p.equip[slot] = null; syncWeaponAlias(p); toast("Unequipped " + slot, "sys"); }
        renderWorkshop(); updateHud(); saveGame(true);
      };
    });
    grid.querySelectorAll("[data-equip]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        equipItem(btn.dataset.equip);
        renderWorkshop(); updateHud();
      };
    });
  }

  function equipItem(id) {
    const p = state.player;
    const d = ITEM_DEFS[id];
    if (!d || invCount(p.inv, id) <= 0) { toast("You don't have that", "bad"); return; }
    let slot = d.slot;
    if (!slot && d.type === "tool") slot = "weapon";
    if (!slot && d.type === "weapon") slot = "weapon";
    if (!slot) { toast("Can't equip that", "bad"); return; }
    p.equip[slot] = id;
    syncWeaponAlias(p);
    toast("Equipped " + d.name, "good");
    saveGame(true);
  }

  function renderInventory() {
    const grid = document.getElementById("inv-grid");
    const inv = state.player ? state.player.inv : [];
    let html = "";
    if (!inv.length) html = "<p>Bag empty.</p>";
    else {
      html = inv.map((it, i) => {
        const def = ITEM_DEFS[it.id] || { name: it.id };
        const eq = Object.values(state.player.equip).includes(it.id) ? " · worn" : "";
        const sel = state.selectedInv === i ? " selected" : "";
        return `<button type="button" class="inv-item${sel}" data-idx="${i}"><span class="name">${def.name} ×${it.qty}</span><span class="meta">${def.type}${eq}</span></button>`;
      }).join("");
    }
    const storage = getStorageBuilding();
    if (storage && pointInBuilding(state.player.x, state.player.y, storage)) {
      html += '<p style="margin-top:10px"><strong>Storage stash</strong></p>';
      html += '<div class="panel-actions"><button class="btn" type="button" id="btn-stash-dep">Deposit mats/food</button><button class="btn" type="button" id="btn-stash-wd">Withdraw</button></div>';
      const stash = storage.base.stash || [];
      html += stash.length ? "<p>" + stash.map((s) => (ITEM_DEFS[s.id]?.name || s.id) + "×" + s.qty).join(", ") + "</p>" : "<p>Empty.</p>";
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".inv-item").forEach((btn) => {
      btn.addEventListener("click", () => { state.selectedInv = +btn.dataset.idx; renderInventory(); });
    });
    const dep = document.getElementById("btn-stash-dep");
    const wd = document.getElementById("btn-stash-wd");
    if (dep) dep.onclick = () => { stashDeposit(); renderInventory(); };
    if (wd) wd.onclick = () => { stashWithdraw(); renderInventory(); };
  }

  function stashDeposit() {
    const storage = getStorageBuilding();
    if (!storage) return;
    const p = state.player, keep = [];
    for (const it of p.inv) {
      const t = ITEM_DEFS[it.id] && ITEM_DEFS[it.id].type;
      if (t === "mat" || t === "food" || t === "heal" || t === "ammo") invAdd(storage.base.stash, it.id, it.qty, 40);
      else keep.push(it);
    }
    p.inv = keep;
    // clear equip refs missing from inv
    for (const slot of EQUIP_SLOTS) {
      if (p.equip[slot] && invCount(p.inv, p.equip[slot]) <= 0) p.equip[slot] = null;
    }
    syncWeaponAlias(p);
    toast("Deposited", "good"); saveGame(true);
  }
  function stashWithdraw() {
    const storage = getStorageBuilding();
    if (!storage) return;
    const left = [];
    for (const it of storage.base.stash) {
      const before = invCount(state.player.inv, it.id);
      invAdd(state.player.inv, it.id, it.qty, MAX_INV);
      const took = invCount(state.player.inv, it.id) - before;
      if (took < it.qty) left.push({ id: it.id, qty: it.qty - took });
    }
    storage.base.stash = left;
    toast("Withdrew", "good"); saveGame(true);
  }

  function useSelected() {
    const p = state.player;
    if (!p || state.selectedInv < 0 || state.selectedInv >= p.inv.length) { toast("Select an item", "bad"); return; }
    const it = p.inv[state.selectedInv];
    const def = ITEM_DEFS[it.id];
    if (!def) return;
    if (def.type === "food" || def.type === "heal") {
      p.hp = Math.min(p.maxHp, p.hp + (def.heal || 0));
      p.hunger = Math.min(p.maxHunger, p.hunger + (def.hunger || 0));
      invRemove(p.inv, it.id, 1);
      toast("Used " + def.name, "good");
      if (state.selectedInv >= p.inv.length) state.selectedInv = -1;
      renderInventory(); updateHud(); saveGame(true);
    } else if (def.slot || def.type === "weapon" || def.type === "armor" || def.type === "ammo" || def.type === "tool") {
      equipItem(it.id); renderInventory(); updateHud();
    } else toast("Open Skills → Craft/Smith for materials", "sys");
  }
  function dropSelected() {
    const p = state.player;
    if (!p || state.selectedInv < 0 || state.selectedInv >= p.inv.length) { toast("Select an item", "bad"); return; }
    const it = p.inv[state.selectedInv];
    for (const slot of EQUIP_SLOTS) if (p.equip[slot] === it.id) p.equip[slot] = null;
    syncWeaponAlias(p);
    state.lootPiles.push({ x: p.x + 18, y: p.y, items: [{ id: it.id, qty: it.qty }], life: 99999 });
    p.inv.splice(state.selectedInv, 1);
    state.selectedInv = -1;
    toast("Dropped", "sys"); renderInventory(); updateHud(); saveGame(true);
  }



  function openBank() {
    state.selectedBank = -1;
    renderBank();
    openOverlay("overlay-bank");
  }
  function renderBank() {
    const p = state.player;
    const status = document.getElementById("bank-status");
    const grid = document.getElementById("bank-grid");
    const invg = document.getElementById("bank-inv-grid");
    if (!status) return;
    status.textContent = "Bank is shared across all bank chests. Survives death. Coins: " + getCoins(p);
    grid.innerHTML = (state.bank.length ? state.bank : []).map((it, i) => {
      const def = ITEM_DEFS[it.id] || { name: it.id };
      const sel = state.selectedBank === i ? " selected" : "";
      return '<button type="button" class="inv-item' + sel + '" data-bank="' + i + '"><span class="name">' + def.name + " ×" + it.qty + '</span><span class="meta">In bank</span></button>';
    }).join("") || "<p>Bank empty.</p>";
    invg.innerHTML = p.inv.map((it, i) => {
      const def = ITEM_DEFS[it.id] || { name: it.id };
      return '<button type="button" class="inv-item" data-depid="' + it.id + '"><span class="name">' + def.name + " ×" + it.qty + '</span><span class="meta">Bag</span></button>';
    }).join("") || "<p>Bag empty.</p>";
    grid.querySelectorAll("[data-bank]").forEach((btn) => {
      let press = null;
      const withdraw = (qty) => {
        const it = state.bank[+btn.dataset.bank];
        if (!it) return;
        const took = bankWithdraw(state.bank, p.inv, it.id, qty, MAX_INV);
        toast(took ? ("Withdrew " + took + " " + ITEM_DEFS[it.id].name) : "Can't withdraw", took ? "good" : "bad");
        renderBank(); updateHud(); saveGame(true);
      };
      btn.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        press = setTimeout(() => { press = "long"; showQtySheet("Withdraw", (q) => withdraw(q === "all" ? 9999 : q)); }, 450);
      });
      btn.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        if (press === "long") { press = null; return; }
        if (typeof press === "number") { clearTimeout(press); withdraw(1); }
        press = null;
      });
      btn.addEventListener("click", (e) => e.stopPropagation());
    });
    invg.querySelectorAll("[data-depid]").forEach((btn) => {
      let press = null;
      const deposit = (qty) => {
        const id = btn.dataset.depid;
        for (const slot of EQUIP_SLOTS) if (p.equip[slot] === id) p.equip[slot] = null;
        syncWeaponAlias(p);
        const took = bankDeposit(state.bank, p.inv, id, qty);
        toast(took ? ("Deposited " + took) : "Nothing deposited", took ? "good" : "bad");
        renderBank(); updateHud(); saveGame(true);
      };
      btn.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        press = setTimeout(() => { press = "long"; showQtySheet("Deposit", (q) => deposit(q === "all" ? 9999 : q)); }, 450);
      });
      btn.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        if (press === "long") { press = null; return; }
        if (typeof press === "number") { clearTimeout(press); deposit(1); }
        press = null;
      });
    });
  }
  function showQtySheet(title, cb) {
    const sheet = document.getElementById("qty-sheet");
    if (!sheet) { cb(5); return; }
    document.getElementById("qty-title").textContent = title;
    sheet.classList.add("open");
    sheet.querySelectorAll("[data-qty]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        sheet.classList.remove("open");
        const v = b.dataset.qty;
        cb(v === "all" ? "all" : +v);
      };
    });
  }

  function openShop() {
    renderShop();
    openOverlay("overlay-shop");
  }
  function renderShop() {
    const p = state.player;
    const status = document.getElementById("shop-status");
    const buy = document.getElementById("shop-buy");
    const sell = document.getElementById("shop-sell");
    if (!status) return;
    if (!state.shop || !state.shop.stock) {
      state.shop = { stock: SHOP_STOCK_DEFAULT.map((s) => Object.assign({}, s)), restockTimer: 90 };
    }
    status.textContent = "Mira the Trader — Your coins: " + getCoins(p);
    buy.innerHTML = state.shop.stock.map((row, i) => {
      const def = ITEM_DEFS[row.id];
      const can = getCoins(p) >= row.buy && row.stock > 0;
      return '<button type="button" class="craft-row ' + (can?"":"disabled") + '" data-buy="' + i + '">' +
        '<div class="craft-main"><strong>' + def.name + '</strong><div class="mats">Buy ' + row.buy + 'c · Stock ' + row.stock + '/' + row.max + '</div></div>' +
        '<span class="craft-go">Buy</span></button>';
    }).join("");
    sell.innerHTML = p.inv.filter((it) => it.id !== "coins").map((it) => {
      const row = state.shop.stock.find((s) => s.id === it.id);
      const price = row ? row.sell : 2;
      return '<button type="button" class="craft-row" data-sell="' + it.id + '">' +
        '<div class="craft-main"><strong>' + ITEM_DEFS[it.id].name + ' ×' + it.qty + '</strong><div class="mats">Sell ' + price + 'c each</div></div>' +
        '<span class="craft-go">Sell</span></button>';
    }).join("") || "<p>Nothing to sell.</p>";
    buy.querySelectorAll("[data-buy]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const row = state.shop.stock[+btn.dataset.buy];
        const coins = getCoins(p);
        const res = shopBuy(row, p.inv, coins);
        if (res.ok) { setCoins(p, res.coins); toast(res.msg, "good"); }
        else toast(res.msg, "bad");
        renderShop(); updateHud(); saveGame(true);
      };
    });
    sell.querySelectorAll("[data-sell]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.sell;
        const row = state.shop.stock.find((s) => s.id === id) || { sell: 2, stock: 0, max: 99, id };
        // unequip
        for (const slot of EQUIP_SLOTS) if (p.equip[slot] === id) p.equip[slot] = null;
        syncWeaponAlias(p);
        const res = shopSell(row, p.inv, id, getCoins(p));
        if (res.ok) { setCoins(p, res.coins); toast(res.msg, "good"); }
        else toast(res.msg, "bad");
        renderShop(); updateHud(); saveGame(true);
      };
    });
  }

  // ── Boot ──
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function showTitle() {
    document.getElementById("title-screen").classList.remove("hidden");
    document.getElementById("btn-continue").disabled = !hasSave();
    state.running = false;
  }
  function hideTitle() { document.getElementById("title-screen").classList.add("hidden"); }

  function beginPlay(fromSave) {
    hideTitle(); closeOverlays(); hideContextMenu();
    if (fromSave) {
      if (!loadGame()) startNewGame();
      else { state.running = true; state.paused = false; toast("Welcome back", "sys"); }
    } else startNewGame();
    updateHud();
    if (!state.tutorialShown) {
      state.tutorialShown = true;
      setTimeout(() => openOverlay("overlay-help"), 400);
      saveGame(true);
    }
  }

  document.getElementById("btn-new").addEventListener("click", () => {
    if (hasSave() && !confirm("Start a new game? Current save will be overwritten.")) return;
    beginPlay(false);
  });
  document.getElementById("btn-continue").addEventListener("click", () => beginPlay(true));
  document.getElementById("btn-help-title").addEventListener("click", () => {
    document.getElementById("overlay-help").classList.add("open");
  });
  document.getElementById("btn-help").addEventListener("click", () => openOverlay("overlay-help"));
  document.getElementById("btn-close-help").addEventListener("click", () => {
    document.getElementById("overlay-help").classList.remove("open");
    if (state.running) state.paused = false;
  });
  document.getElementById("btn-inv").addEventListener("click", () => { renderInventory(); openOverlay("overlay-inv"); });
  document.getElementById("btn-close-inv").addEventListener("click", closeOverlays);
  document.getElementById("btn-use").addEventListener("click", useSelected);
  document.getElementById("btn-drop").addEventListener("click", dropSelected);
  document.getElementById("btn-skills").addEventListener("click", () => openWorkshop(state.workshopTab || "craft"));
  document.getElementById("btn-close-workshop").addEventListener("click", closeOverlays);
  const btnBankClose = document.getElementById("btn-close-bank");
  if (btnBankClose) btnBankClose.addEventListener("click", closeOverlays);
  const btnShopClose = document.getElementById("btn-close-shop");
  if (btnShopClose) btnShopClose.addEventListener("click", closeOverlays);
  const btnDepAll = document.getElementById("btn-bank-deposit-all");
  if (btnDepAll) btnDepAll.addEventListener("click", () => {
    const p = state.player;
    const keep = [];
    for (const it of p.inv.slice()) {
      const d = ITEM_DEFS[it.id];
      if (!d || it.id === "coins" || d.type === "weapon" || d.type === "armor" || d.type === "tool") {
        keep.push(it); continue;
      }
      for (const slot of EQUIP_SLOTS) if (p.equip[slot] === it.id) p.equip[slot] = null;
      invAdd(state.bank, it.id, it.qty, 60);
    }
    p.inv = keep;
    syncWeaponAlias(p);
    toast("Deposited inventory to bank", "good");
    renderBank(); updateHud(); saveGame(true);
  });
  document.querySelectorAll(".ws-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      state.workshopTab = tab.dataset.tab;
      renderWorkshop();
    });
  });
  document.getElementById("btn-menu").addEventListener("click", () => openOverlay("overlay-menu"));
  document.getElementById("btn-resume").addEventListener("click", closeOverlays);
  document.getElementById("btn-save").addEventListener("click", () => saveGame(false));
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!confirm("Delete your Ashen Vale save on this device?")) return;
    resetSave(); closeOverlays(); showTitle(); toast("Save deleted", "sys");
  });

  // Overlay backdrop closes; panel stops propagation
  document.querySelectorAll(".overlay").forEach((ov) => {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeOverlays();
    });
    const panel = ov.querySelector(".panel");
    if (panel) panel.addEventListener("click", (e) => e.stopPropagation());
  });
  document.getElementById("context-dismiss").addEventListener("click", hideContextMenu);

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 120));

  window.AshenVale = {
    state, D, ITEM_DEFS, RECIPES, FORTIFY, BUILDING_TYPES, CREATURE_DEFS, NODE_DEFS,
    FURNITURE_DEFS, SHOP_STOCK_DEFAULT,
    invAdd, invRemove, invCount, canAfford, payNeed, xpToNext, gainXp,
    createPlayer, generateWorld, serialize, clientToWorld, migrateSkills,
    emptyEquip, armorTotal, reduceDamage, meleeDamage, rangedDamage, consumeAmmo,
    cookOutcome, recipeBlocked, doCraft, bestToolTier, defaultBase, pointInBuilding,
    enterBuilding, exitBuilding, placeFurnitureAt, furnitureFits, furnitureRect, rectsOverlap,
    bankDeposit, bankWithdraw, shopBuy, shopSell, getCoins, setCoins,
    SAVE_KEY, SAVE_KEY_LEGACY, SKILL_NAMES, WORLD_W, WORLD_H, EQUIP_SLOTS,
  };

  resize();
  showTitle();
  requestAnimationFrame(frame);
})();
