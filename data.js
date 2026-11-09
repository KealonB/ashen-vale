/**
 * Ashen Vale — shared data & pure helpers (Phase 1)
 * Loaded before game.js. Exposes window.AshenData
 */
(function (global) {
  "use strict";

  const SAVE_KEY = "ashenvale_save_v3";
  const SAVE_KEY_LEGACY = ["ashenvale_save_v2", "ashenvale_save_v1"];

  const SKILL_NAMES = [
    "combat", "ranged", "woodcutting", "mining", "fishing", "cooking",
    "crafting", "smithing", "construction", "fitness",
  ];
  const SKILL_LABELS = {
    combat: "Attack", ranged: "Ranged", woodcutting: "Woodcutting", mining: "Mining",
    fishing: "Fishing", cooking: "Cooking", crafting: "Crafting", smithing: "Smithing",
    construction: "Construction", fitness: "Fitness",
  };

  const EQUIP_SLOTS = ["head", "body", "legs", "feet", "hands", "cape", "weapon", "ammo"];

  const BUILDING_TYPES = {
    none: { name: "Unclaimed", desc: "Claim to designate a use.", skill: 1 },
    safehouse: { name: "Safehouse", desc: "Respawn + slow heal inside.", skill: 1 },
    workshop: { name: "Workshop", desc: "Forge, anvil, advanced crafts.", skill: 2 },
    storage: { name: "Storage", desc: "Stash persists through death.", skill: 2 },
    kitchen: { name: "Kitchen", desc: "Better cooking / stove.", skill: 3 },
  };

  const FORTIFY = {
    board: { label: "Board windows", need: { plank: 2, nails: 2 }, skill: 1, xp: 18, addWall: 40 },
    door:  { label: "Reinforce door", need: { plank: 3, nails: 4 }, skill: 2, xp: 28, addWall: 60 },
    walls: { label: "Brace walls", need: { plank: 4, nails: 6 }, skill: 3, xp: 40, addWall: 80 },
    repair:{ label: "Repair fortifications", need: { plank: 1, nails: 1 }, skill: 1, xp: 10, repair: 35 },
  };

  const ITEM_DEFS = {
    // mats
    wood: { name: "Logs", stack: 30, type: "mat" },
    oak_logs: { name: "Oak logs", stack: 30, type: "mat" },
    stick: { name: "Stick", stack: 30, type: "mat" },
    plank: { name: "Plank", stack: 30, type: "mat" },
    cloth: { name: "Cloth", stack: 20, type: "mat" },
    scrap: { name: "Scrap", stack: 30, type: "mat" },
    nails: { name: "Nails", stack: 40, type: "mat" },
    string: { name: "String", stack: 20, type: "mat" },
    feather: { name: "Feather", stack: 40, type: "mat" },
    copper_ore: { name: "Copper ore", stack: 30, type: "mat" },
    tin_ore: { name: "Tin ore", stack: 30, type: "mat" },
    iron_ore: { name: "Iron ore", stack: 30, type: "mat" },
    bronze_bar: { name: "Bronze bar", stack: 30, type: "mat" },
    iron_bar: { name: "Iron bar", stack: 30, type: "mat" },
    steel_bar: { name: "Steel bar", stack: 30, type: "mat" },
    coins: { name: "Coins", stack: 9999, type: "mat" },
    raw_fish: { name: "Raw fish", stack: 20, type: "mat" },
    raw_meat: { name: "Raw meat", stack: 20, type: "mat" },
    burned_food: { name: "Burnt food", stack: 20, type: "mat" },
    // food
    berries: { name: "Berries", stack: 20, type: "food", heal: 0, hunger: 14 },
    fish: { name: "Cooked fish", stack: 20, type: "food", heal: 6, hunger: 28 },
    meat: { name: "Cooked meat", stack: 20, type: "food", heal: 8, hunger: 32 },
    stew: { name: "Hearty stew", stack: 10, type: "food", heal: 12, hunger: 45 },
    canned: { name: "Canned food", stack: 10, type: "food", heal: 8, hunger: 40 },
    water: { name: "Water", stack: 10, type: "food", heal: 2, hunger: 6 },
    bandage: { name: "Bandage", stack: 10, type: "heal", heal: 28, hunger: 0 },
    // tools
    bronze_axe: { name: "Bronze axe", stack: 1, type: "tool", tool: "axe", tier: 1 },
    iron_axe: { name: "Iron axe", stack: 1, type: "tool", tool: "axe", tier: 2 },
    steel_axe: { name: "Steel axe", stack: 1, type: "tool", tool: "axe", tier: 3 },
    bronze_pick: { name: "Bronze pickaxe", stack: 1, type: "tool", tool: "pick", tier: 1 },
    iron_pick: { name: "Iron pickaxe", stack: 1, type: "tool", tool: "pick", tier: 2 },
    steel_pick: { name: "Steel pickaxe", stack: 1, type: "tool", tool: "pick", tier: 3 },
    // weapons
    knife: { name: "Knife", stack: 1, type: "weapon", slot: "weapon", dmg: 10, style: "melee" },
    spear: { name: "Spear", stack: 1, type: "weapon", slot: "weapon", dmg: 16, style: "melee" },
    bat: { name: "Nail bat", stack: 1, type: "weapon", slot: "weapon", dmg: 22, style: "melee" },
    bronze_sword: { name: "Bronze sword", stack: 1, type: "weapon", slot: "weapon", dmg: 14, style: "melee" },
    iron_sword: { name: "Iron sword", stack: 1, type: "weapon", slot: "weapon", dmg: 20, style: "melee" },
    steel_sword: { name: "Steel sword", stack: 1, type: "weapon", slot: "weapon", dmg: 28, style: "melee" },
    shortbow: { name: "Shortbow", stack: 1, type: "weapon", slot: "weapon", dmg: 12, style: "ranged", range: 220 },
    bronze_arrows: { name: "Bronze arrows", stack: 80, type: "ammo", slot: "ammo", dmgBonus: 2 },
    iron_arrows: { name: "Iron arrows", stack: 80, type: "ammo", slot: "ammo", dmgBonus: 5 },
    steel_arrows: { name: "Steel arrows", stack: 80, type: "ammo", slot: "ammo", dmgBonus: 9 },
    // armor smithed
    bronze_helm: { name: "Bronze helm", stack: 1, type: "armor", slot: "head", armor: 3, tint: "#b08d57" },
    bronze_body: { name: "Bronze platebody", stack: 1, type: "armor", slot: "body", armor: 6, tint: "#b08d57" },
    iron_helm: { name: "Iron helm", stack: 1, type: "armor", slot: "head", armor: 5, tint: "#8a9098" },
    iron_body: { name: "Iron platebody", stack: 1, type: "armor", slot: "body", armor: 9, tint: "#8a9098" },
    // outfits / loot
    hoodie: { name: "Hoodie", stack: 1, type: "armor", slot: "body", armor: 1, tint: "#3a5a8a", cosmetic: true },
    jeans: { name: "Jeans", stack: 1, type: "armor", slot: "legs", armor: 1, tint: "#3a4a6a", cosmetic: true },
    hiking_boots: { name: "Hiking boots", stack: 1, type: "armor", slot: "feet", armor: 1, tint: "#5a3a20", cosmetic: true },
    gloves: { name: "Work gloves", stack: 1, type: "armor", slot: "hands", armor: 1, tint: "#6a5a40", cosmetic: true },
    scarf_cape: { name: "Travel cape", stack: 1, type: "armor", slot: "cape", armor: 1, tint: "#8a3030", cosmetic: true },
    leather_cap: { name: "Leather cap", stack: 1, type: "armor", slot: "head", armor: 2, tint: "#6a4a28" },
  };

  // Crafting (general) + smithing recipes tagged station
  const RECIPES = [
    { id: "plank", out: { id: "plank", qty: 2 }, need: { wood: 1 }, skill: "crafting", level: 1, xp: 8, tab: "craft" },
    { id: "nails", out: { id: "nails", qty: 4 }, need: { scrap: 1 }, skill: "crafting", level: 1, xp: 8, tab: "craft" },
    { id: "string", out: { id: "string", qty: 1 }, need: { cloth: 1 }, skill: "crafting", level: 1, xp: 6, tab: "craft" },
    { id: "stick", out: { id: "stick", qty: 2 }, need: { wood: 1 }, skill: "crafting", level: 1, xp: 4, tab: "craft" },
    { id: "bandage", out: { id: "bandage", qty: 1 }, need: { cloth: 2 }, skill: "crafting", level: 1, xp: 10, tab: "craft" },
    { id: "spear", out: { id: "spear", qty: 1 }, need: { stick: 2, knife: 1 }, keep: ["knife"], skill: "crafting", level: 2, xp: 20, tab: "craft" },
    { id: "bat", out: { id: "bat", qty: 1 }, need: { wood: 3, scrap: 2 }, skill: "crafting", level: 3, xp: 28, tab: "craft", workshop: true },
    { id: "shortbow", out: { id: "shortbow", qty: 1 }, need: { wood: 3, string: 1 }, skill: "crafting", level: 4, xp: 35, tab: "craft", workshop: true },
    { id: "bronze_arrows", out: { id: "bronze_arrows", qty: 10 }, need: { stick: 5, bronze_bar: 1, feather: 5 }, skill: "crafting", level: 3, xp: 22, tab: "craft", workshop: true },
    { id: "iron_arrows", out: { id: "iron_arrows", qty: 10 }, need: { stick: 5, iron_bar: 1, feather: 5 }, skill: "crafting", level: 5, xp: 30, tab: "craft", workshop: true },
    { id: "stew", out: { id: "stew", qty: 1 }, need: { berries: 2, raw_meat: 1, water: 1 }, skill: "cooking", level: 2, xp: 20, tab: "craft", kitchen: true },
    // smithing
    { id: "smelt_bronze", out: { id: "bronze_bar", qty: 1 }, need: { copper_ore: 1, tin_ore: 1 }, skill: "smithing", level: 1, xp: 15, tab: "smith", forge: true },
    { id: "smelt_iron", out: { id: "iron_bar", qty: 1 }, need: { iron_ore: 2 }, skill: "smithing", level: 3, xp: 22, tab: "smith", forge: true },
    { id: "smelt_steel", out: { id: "steel_bar", qty: 1 }, need: { iron_ore: 2, scrap: 1 }, skill: "smithing", level: 5, xp: 35, tab: "smith", forge: true },
    { id: "bronze_sword", out: { id: "bronze_sword", qty: 1 }, need: { bronze_bar: 2 }, skill: "smithing", level: 2, xp: 25, tab: "smith", anvil: true },
    { id: "iron_sword", out: { id: "iron_sword", qty: 1 }, need: { iron_bar: 2 }, skill: "smithing", level: 4, xp: 40, tab: "smith", anvil: true },
    { id: "steel_sword", out: { id: "steel_sword", qty: 1 }, need: { steel_bar: 2 }, skill: "smithing", level: 6, xp: 55, tab: "smith", anvil: true },
    { id: "bronze_axe", out: { id: "bronze_axe", qty: 1 }, need: { bronze_bar: 2, stick: 1 }, skill: "smithing", level: 1, xp: 20, tab: "smith", anvil: true },
    { id: "iron_axe", out: { id: "iron_axe", qty: 1 }, need: { iron_bar: 2, stick: 1 }, skill: "smithing", level: 3, xp: 35, tab: "smith", anvil: true },
    { id: "steel_axe", out: { id: "steel_axe", qty: 1 }, need: { steel_bar: 2, stick: 1 }, skill: "smithing", level: 5, xp: 50, tab: "smith", anvil: true },
    { id: "bronze_pick", out: { id: "bronze_pick", qty: 1 }, need: { bronze_bar: 2, stick: 1 }, skill: "smithing", level: 1, xp: 20, tab: "smith", anvil: true },
    { id: "iron_pick", out: { id: "iron_pick", qty: 1 }, need: { iron_bar: 2, stick: 1 }, skill: "smithing", level: 3, xp: 35, tab: "smith", anvil: true },
    { id: "steel_pick", out: { id: "steel_pick", qty: 1 }, need: { steel_bar: 2, stick: 1 }, skill: "smithing", level: 5, xp: 50, tab: "smith", anvil: true },
    { id: "bronze_helm", out: { id: "bronze_helm", qty: 1 }, need: { bronze_bar: 2 }, skill: "smithing", level: 2, xp: 22, tab: "smith", anvil: true },
    { id: "bronze_body", out: { id: "bronze_body", qty: 1 }, need: { bronze_bar: 4 }, skill: "smithing", level: 4, xp: 45, tab: "smith", anvil: true },
    { id: "iron_helm", out: { id: "iron_helm", qty: 1 }, need: { iron_bar: 2 }, skill: "smithing", level: 4, xp: 35, tab: "smith", anvil: true },
    { id: "iron_body", out: { id: "iron_body", qty: 1 }, need: { iron_bar: 4 }, skill: "smithing", level: 6, xp: 60, tab: "smith", anvil: true },
  ];

  const NODE_DEFS = {
    tree: { skill: "woodcutting", tool: "axe", tier: 1, drops: [{ id: "wood", qty: [1, 2] }], xp: 12, label: "Tree", verb: "Chop" },
    oak: { skill: "woodcutting", tool: "axe", tier: 2, drops: [{ id: "oak_logs", qty: [1, 2] }], xp: 22, label: "Oak", verb: "Chop" },
    bush: { skill: "woodcutting", tool: null, tier: 0, drops: [{ id: "berries", qty: [1, 2] }], xp: 6, label: "Bush", verb: "Pick" },
    copper_rock: { skill: "mining", tool: "pick", tier: 1, drops: [{ id: "copper_ore", qty: [1, 1] }], xp: 14, label: "Copper rock", verb: "Mine" },
    tin_rock: { skill: "mining", tool: "pick", tier: 1, drops: [{ id: "tin_ore", qty: [1, 1] }], xp: 14, label: "Tin rock", verb: "Mine" },
    iron_rock: { skill: "mining", tool: "pick", tier: 2, drops: [{ id: "iron_ore", qty: [1, 1] }], xp: 24, label: "Iron rock", verb: "Mine" },
    scrapheap: { skill: "mining", tool: "pick", tier: 1, drops: [{ id: "scrap", qty: [1, 2] }, { id: "nails", qty: [0, 1] }], xp: 10, label: "Scrap pile", verb: "Scavenge" },
    fish_spot: { skill: "fishing", tool: null, tier: 0, drops: [{ id: "raw_fish", qty: [1, 1] }], xp: 16, label: "Fishing spot", verb: "Fish" },
  };

  const CREATURE_DEFS = {
    zombie: { name: "Zombie", aggressive: true, hp: [28, 48], speed: 48, dmg: [6, 11], xp: 14, r: 12, color: "#5a7a40", drops: [{ id: "cloth", c: 0.35 }, { id: "scrap", c: 0.25 }] },
    rat: { name: "Rat", aggressive: true, pack: true, hp: [8, 14], speed: 70, dmg: [2, 4], xp: 5, r: 7, color: "#6a5a48", agro: 90, drops: [{ id: "raw_meat", c: 0.4 }] },
    squirrel: { name: "Squirrel", aggressive: false, flee: true, hp: [6, 10], speed: 95, dmg: [0, 0], xp: 3, r: 6, color: "#a07040", agro: 70, drops: [{ id: "raw_meat", c: 0.3 }] },
    chicken: { name: "Chicken", aggressive: false, flee: true, hp: [8, 12], speed: 75, dmg: [0, 0], xp: 4, r: 8, color: "#e8e0d0", agro: 80, drops: [{ id: "feather", c: 0.9, qty: [1, 3] }, { id: "raw_meat", c: 0.7 }] },
    goblin: { name: "Goblin", aggressive: true, hp: [22, 34], speed: 55, dmg: [5, 9], xp: 18, r: 11, color: "#4a7a38", agro: 150, drops: [{ id: "coins", c: 0.8, qty: [1, 8] }, { id: "scrap", c: 0.4 }, { id: "bronze_helm", c: 0.05 }, { id: "hoodie", c: 0.04 }] },
  };

  function xpToNext(level) {
    return Math.floor(50 * Math.pow(1.35, level - 1));
  }

  function emptySkills() {
    const s = {};
    for (const n of SKILL_NAMES) s[n] = { level: 1, xp: 0, next: xpToNext(1) };
    return s;
  }

  function migrateSkills(skills) {
    const base = emptySkills();
    if (!skills) return base;
    for (const n of SKILL_NAMES) {
      if (skills[n]) {
        base[n] = {
          level: skills[n].level || 1,
          xp: skills[n].xp || 0,
          next: skills[n].next || xpToNext(skills[n].level || 1),
        };
      }
    }
    // Fold old foraging into woodcutting (+ a bit mining)
    if (skills.foraging && !skills.woodcutting) {
      const f = skills.foraging;
      base.woodcutting = { level: f.level || 1, xp: f.xp || 0, next: xpToNext(f.level || 1) };
      base.mining.level = Math.max(base.mining.level, Math.max(1, Math.floor((f.level || 1) / 2)));
    }
    return base;
  }

  function emptyEquip() {
    const e = {};
    for (const s of EQUIP_SLOTS) e[s] = null;
    return e;
  }

  function invCount(inv, id) {
    let n = 0;
    for (const it of inv) if (it.id === id) n += it.qty;
    return n;
  }

  function invAdd(inv, id, qty, maxSlots) {
    const def = ITEM_DEFS[id];
    if (!def) return false;
    const cap = maxSlots == null ? 24 : maxSlots;
    qty = qty || 1;
    const start = qty;
    for (const it of inv) {
      if (it.id === id && it.qty < def.stack) {
        const take = Math.min(def.stack - it.qty, qty);
        it.qty += take; qty -= take;
        if (qty <= 0) return true;
      }
    }
    while (qty > 0) {
      if (inv.length >= cap) return qty < start;
      const take = Math.min(def.stack, qty);
      inv.push({ id, qty: take });
      qty -= take;
    }
    return true;
  }

  function invRemove(inv, id, qty) {
    qty = qty || 1;
    for (let i = inv.length - 1; i >= 0 && qty > 0; i--) {
      if (inv[i].id !== id) continue;
      const take = Math.min(inv[i].qty, qty);
      inv[i].qty -= take; qty -= take;
      if (inv[i].qty <= 0) inv.splice(i, 1);
    }
    return qty <= 0;
  }

  function canAfford(inv, need) {
    return Object.keys(need).every((id) => invCount(inv, id) >= need[id]);
  }

  function payNeed(inv, need, keep) {
    const k = new Set(keep || []);
    for (const [id, q] of Object.entries(need)) {
      if (k.has(id)) continue;
      invRemove(inv, id, q);
    }
  }

  function bestToolTier(inv, equip, toolType) {
    let best = 0;
    const check = (id) => {
      const d = ITEM_DEFS[id];
      if (d && d.tool === toolType) best = Math.max(best, d.tier || 0);
    };
    if (equip && equip.weapon) check(equip.weapon);
    for (const it of inv || []) check(it.id);
    return best;
  }

  function armorTotal(equip) {
    let a = 0;
    if (!equip) return 0;
    for (const slot of EQUIP_SLOTS) {
      const id = equip[slot];
      if (!id) continue;
      const d = ITEM_DEFS[id];
      if (d && d.armor) a += d.armor;
    }
    return a;
  }

  function reduceDamage(raw, armor) {
    // Each armor point ~4% reduction, soft cap
    const factor = 1 / (1 + armor * 0.04);
    return Math.max(1, Math.round(raw * factor));
  }

  function meleeDamage(equip) {
    const w = equip && equip.weapon && ITEM_DEFS[equip.weapon];
    if (w && w.style === "melee") return w.dmg || 8;
    if (w && w.style === "ranged") return 6; // bow bash
    return 8;
  }

  function rangedDamage(equip) {
    const w = equip && equip.weapon && ITEM_DEFS[equip.weapon];
    if (!w || w.style !== "ranged") return 0;
    let d = w.dmg || 10;
    const ammo = equip.ammo && ITEM_DEFS[equip.ammo];
    if (ammo && ammo.dmgBonus) d += ammo.dmgBonus;
    return d;
  }

  function consumeAmmo(player) {
    const ammoId = player.equip.ammo;
    if (!ammoId) return false;
    if (!invRemove(player.inv, ammoId, 1)) {
      player.equip.ammo = null;
      return false;
    }
    if (invCount(player.inv, ammoId) <= 0) player.equip.ammo = null;
    return true;
  }

  function cookOutcome(cookingLevel) {
    // burn chance decreases with level
    const burn = Math.max(0.05, 0.55 - cookingLevel * 0.04);
    return Math.random() < burn ? "burn" : "cook";
  }

  function clientToWorld(clientX, clientY, rect, cam, viewW, viewH) {
    const rw = rect.width || 1;
    const rh = rect.height || 1;
    const vw = viewW || rw;
    const vh = viewH || rh;
    return {
      x: ((clientX - rect.left) / rw) * vw + cam.x,
      y: ((clientY - rect.top) / rh) * vh + cam.y,
    };
  }

  function defaultBase() {
    return {
      claimed: false, type: "none", wallHp: 0, wallMax: 0,
      boarded: false, doorReinforced: false, braced: false, stash: [],
      hasForge: false, hasAnvil: false,
    };
  }

  global.AshenData = {
    SAVE_KEY, SAVE_KEY_LEGACY, SKILL_NAMES, SKILL_LABELS, EQUIP_SLOTS,
    BUILDING_TYPES, FORTIFY, ITEM_DEFS, RECIPES, NODE_DEFS, CREATURE_DEFS,
    xpToNext, emptySkills, migrateSkills, emptyEquip,
    invCount, invAdd, invRemove, canAfford, payNeed,
    bestToolTier, armorTotal, reduceDamage, meleeDamage, rangedDamage,
    consumeAmmo, cookOutcome, clientToWorld, defaultBase,
  };
})(typeof window !== "undefined" ? window : globalThis);
