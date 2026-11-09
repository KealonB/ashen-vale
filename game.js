/**
 * Ashen Vale — skill-based zombie survival prototype
 * Architecture: STATE (data) → UPDATE (simulation) → RENDER (canvas)
 * Solo vertical slice; multiplayer not implemented (structure leaves room).
 */
(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════
  const SAVE_KEY = "ashenvale_save_v2";
  const SAVE_KEY_LEGACY = "ashenvale_save_v1";
  const WORLD_W = 2400;
  const WORLD_H = 2400;
  const TILE = 32;
  const PLAYER_R = 14;
  const ZOMBIE_R = 13;
  const ATTACK_RANGE = 52;
  const GATHER_RANGE = 48;
  const DAY_LEN = 180; // seconds of real time per in-game day
  const HUNGER_RATE = 0.35; // per second
  const MOVE_BASE = 95;
  const ZOMBIE_SPEED = 48;
  const AGRO_RANGE = 160;
  const MAX_INV = 16;

  const SKILL_NAMES = ["combat", "foraging", "crafting", "fitness", "construction"];
  const SKILL_LABELS = { combat: "Combat", foraging: "Foraging", crafting: "Crafting", fitness: "Fitness", construction: "Construction" };

  const BUILDING_TYPES = {
    none: { name: "Unclaimed", desc: "Claim to designate a use." },
    safehouse: { name: "Safehouse", desc: "Respawn here. Slow heal inside.", skill: 1 },
    workshop: { name: "Workshop", desc: "Unlocks advanced craft recipes.", skill: 2 },
    storage: { name: "Storage", desc: "Stash persists through death.", skill: 2 },
    kitchen: { name: "Kitchen", desc: "Cook hearty stew from berries.", skill: 3 },
  };

  const FORTIFY = {
    board: { label: "Board windows", need: { plank: 2, nails: 2 }, skill: 1, xp: 18, addWall: 40 },
    door:  { label: "Reinforce door", need: { plank: 3, nails: 4 }, skill: 2, xp: 28, addWall: 60 },
    walls: { label: "Brace walls", need: { plank: 4, nails: 6 }, skill: 3, xp: 40, addWall: 80 },
    repair:{ label: "Repair fortifications", need: { plank: 1, nails: 1 }, skill: 1, xp: 10, repair: 35 },
  };

  const ITEM_DEFS = {
    wood:      { name: "Wood", stack: 20, type: "mat" },
    stick:     { name: "Stick", stack: 20, type: "mat" },
    cloth:     { name: "Cloth", stack: 10, type: "mat" },
    scrap:     { name: "Scrap Metal", stack: 15, type: "mat" },
    berries:   { name: "Berries", stack: 10, type: "food", heal: 0, hunger: 18 },
    canned:    { name: "Canned Food", stack: 5, type: "food", heal: 8, hunger: 40 },
    bandage:   { name: "Bandage", stack: 8, type: "heal", heal: 28, hunger: 0 },
    knife:     { name: "Knife", stack: 1, type: "weapon", dmg: 14, range: "Knife" },
    spear:     { name: "Spear", stack: 1, type: "weapon", dmg: 22, range: "Spear" },
    bat:       { name: "Nail Bat", stack: 1, type: "weapon", dmg: 30, range: "Nail Bat" },
    water:     { name: "Water Bottle", stack: 5, type: "food", heal: 4, hunger: 8 },
  };

  const RECIPES = [
    { id: "plank", out: { id: "plank", qty: 2 }, need: { wood: 1 }, skill: 1, xp: 6 },
    { id: "nails", out: { id: "nails", qty: 4 }, need: { scrap: 1 }, skill: 1, xp: 8 },
    { id: "bandage", out: { id: "bandage", qty: 1 }, need: { cloth: 2 }, skill: 1, xp: 12 },
    { id: "stick", out: { id: "stick", qty: 2 }, need: { wood: 1 }, skill: 1, xp: 6 },
    { id: "spear", out: { id: "spear", qty: 1 }, need: { stick: 2, knife: 1 }, keep: ["knife"], skill: 2, xp: 25 },
    { id: "bat", out: { id: "bat", qty: 1 }, need: { wood: 3, scrap: 2 }, skill: 4, xp: 40, workshop: true },
    { id: "stew", out: { id: "stew", qty: 1 }, need: { berries: 3, water: 1 }, skill: 1, xp: 15, kitchen: true },
  ];

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════
  const state = {
    running: false,
    paused: false,
    time: 0,
    day: 1,
    dayTimer: 0,
    cam: { x: 0, y: 0 },
    viewW: 390,
    viewH: 500,
    player: null,
    tapMarkers: [],
    msgLog: [],
    zombies: [],
    props: [],       // trees, bushes, crates, buildings (static + gatherable)
    lootPiles: [],   // ground loot / death drops
    particles: [],
    floatTexts: [],
    selectedInv: -1,
    toastTimer: 0,
    toastMsg: "",
    deathTimer: 0,
    tutorialShown: false,
    seed: 1,
  };

  function emptySkills() {
    const s = {};
    for (const n of SKILL_NAMES) s[n] = { level: 1, xp: 0, next: 50 };
    return s;
  }

  function xpToNext(level) {
    return Math.floor(50 * Math.pow(1.35, level - 1));
  }

  function createPlayer(x, y, keepSkills) {
    const skills = keepSkills ? migrateSkills(keepSkills) : emptySkills();
    return {
      x, y,
      vx: 0, vy: 0,
      target: null, // {x,y} or {zombieId}
      r: PLAYER_R,
      hp: 100, maxHp: 100,
      hunger: 100, maxHunger: 100,
      attackCd: 0,
      gatherCd: 0,
      facing: 0,
      weapon: null, // item id equipped
      inv: [
        { id: "knife", qty: 1 },
        { id: "berries", qty: 3 },
        { id: "bandage", qty: 1 },
        { id: "plank", qty: 2 },
        { id: "nails", qty: 4 },
      ],
      skills,
      kills: 0,
      alive: true,
    };
  }

  // Simple seeded RNG for map gen
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function pointInBuilding(x, y, b) {
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }
  function buildingCenter(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  function defaultBase() {
    return { claimed: false, type: "none", wallHp: 0, wallMax: 0, boarded: false, doorReinforced: false, braced: false, stash: [] };
  }
  function migrateSkills(skills) {
    const base = emptySkills();
    if (!skills) return base;
    for (const n of SKILL_NAMES) {
      if (skills[n]) base[n] = { level: skills[n].level || 1, xp: skills[n].xp || 0, next: skills[n].next || xpToNext(skills[n].level || 1) };
    }
    return base;
  }
  function buildingsList() { return state.props.filter((p) => p.kind === "building"); }
  function buildingAt(x, y) {
    for (const b of buildingsList()) if (pointInBuilding(x, y, b)) return b;
    return null;
  }
  function playerBuilding() { return state.player ? buildingAt(state.player.x, state.player.y) : null; }
  function hasWorkshop() { return buildingsList().some((b) => b.base && b.base.claimed && b.base.type === "workshop"); }
  function hasKitchen() { return buildingsList().some((b) => b.base && b.base.claimed && b.base.type === "kitchen"); }
  function getSafehouse() { return buildingsList().find((b) => b.base && b.base.claimed && b.base.type === "safehouse"); }
  function getStorageBuilding() { return buildingsList().find((b) => b.base && b.base.claimed && b.base.type === "storage"); }

  function invCount(inv, id) {
    let n = 0;
    for (const it of inv) if (it.id === id) n += it.qty;
    return n;
  }

  function invAdd(inv, id, qty) {
    const def = ITEM_DEFS[id];
    if (!def) return false;
    qty = qty || 1;
    for (const it of inv) {
      if (it.id === id && it.qty < def.stack) {
        const space = def.stack - it.qty;
        const take = Math.min(space, qty);
        it.qty += take;
        qty -= take;
        if (qty <= 0) return true;
      }
    }
    while (qty > 0) {
      if (inv.length >= MAX_INV) return qty < (arguments[2] || qty); // partial
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
      inv[i].qty -= take;
      qty -= take;
      if (inv[i].qty <= 0) inv.splice(i, 1);
    }
    return qty <= 0;
  }

  function weaponDmg(p) {
    if (p.weapon && ITEM_DEFS[p.weapon]) return ITEM_DEFS[p.weapon].dmg;
    return 8; // fists
  }

  function moveSpeed(p) {
    const fit = p.skills.fitness.level;
    return MOVE_BASE * (1 + (fit - 1) * 0.04);
  }

  function gainXp(p, skill, amount) {
    const s = p.skills[skill];
    if (!s) return;
    s.xp += amount;
    let leveled = false;
    while (s.xp >= s.next) {
      s.xp -= s.next;
      s.level += 1;
      s.next = xpToNext(s.level);
      leveled = true;
      toast(`${SKILL_LABELS[skill]} → Level ${s.level}!`);
    }
    if (leveled && skill === "fitness") {
      p.maxHp = 100 + (s.level - 1) * 5;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // WORLD GENERATION
  // ═══════════════════════════════════════════════════════════
  function generateWorld(seed) {
    const rnd = mulberry32(seed);
    const props = [];
    const zombies = [];
    const lootPiles = [];

    // Campfire spawn center
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    props.push({ kind: "campfire", x: cx, y: cy, r: 20, solid: false });

    // Buildings (rects)
    const buildings = [
      { x: cx - 280, y: cy - 60, w: 120, h: 100 },
      { x: cx + 160, y: cy - 200, w: 140, h: 110 },
      { x: cx - 100, y: cy + 220, w: 160, h: 90 },
      { x: cx + 300, y: cy + 120, w: 100, h: 120 },
      { x: cx - 420, y: cy + 80, w: 110, h: 90 },
    ];
    for (const b of buildings) {
      props.push({ kind: "building", x: b.x, y: b.y, w: b.w, h: b.h, solid: true, base: defaultBase() });
      // crates near buildings
      const nCrates = 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < nCrates; i++) {
        props.push({
          kind: "crate",
          x: b.x + 20 + rnd() * (b.w - 40),
          y: b.y + b.h + 18 + rnd() * 30,
          r: 12,
          solid: true,
          hp: 1,
          loot: pickCrateLoot(rnd),
        });
      }
    }

    // Trees & bushes
    for (let i = 0; i < 90; i++) {
      const x = 80 + rnd() * (WORLD_W - 160);
      const y = 80 + rnd() * (WORLD_H - 160);
      if (Math.hypot(x - cx, y - cy) < 100) continue;
      if (insideAnyBuilding(x, y, buildings, 30)) continue;
      if (rnd() < 0.55) {
        props.push({ kind: "tree", x, y, r: 16, solid: true, hp: 3, gathered: 0 });
      } else {
        props.push({ kind: "bush", x, y, r: 12, solid: false, hp: 1, gathered: 0 });
      }
    }

    // Rocks / scrap spots
    for (let i = 0; i < 18; i++) {
      const x = 80 + rnd() * (WORLD_W - 160);
      const y = 80 + rnd() * (WORLD_H - 160);
      if (Math.hypot(x - cx, y - cy) < 120) continue;
      props.push({ kind: "scrapheap", x, y, r: 14, solid: false, hp: 2, gathered: 0 });
    }

    // Starter loot near camp
    lootPiles.push({
      x: cx + 40, y: cy - 30,
      items: [{ id: "cloth", qty: 2 }, { id: "water", qty: 1 }, { id: "plank", qty: 2 }],
      life: 99999,
    });

    // Zombies
    for (let i = 0; i < 28; i++) {
      let x, y, tries = 0;
      do {
        x = 100 + rnd() * (WORLD_W - 200);
        y = 100 + rnd() * (WORLD_H - 200);
        tries++;
      } while ((Math.hypot(x - cx, y - cy) < 220 || insideAnyBuilding(x, y, buildings, 10)) && tries < 40);
      zombies.push(makeZombie(x, y, rnd));
    }

    return { props, zombies, lootPiles, spawn: { x: cx, y: cy + 40 } };
  }

  function insideAnyBuilding(x, y, buildings, pad) {
    pad = pad || 0;
    for (const b of buildings) {
      if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return true;
    }
    return false;
  }

  function pickCrateLoot(rnd) {
    const pool = [
      [{ id: "canned", qty: 1 }],
      [{ id: "cloth", qty: 2 }],
      [{ id: "scrap", qty: 2 }],
      [{ id: "nails", qty: 3 }],
      [{ id: "plank", qty: 2 }],
      [{ id: "bandage", qty: 1 }],
      [{ id: "water", qty: 1 }, { id: "berries", qty: 2 }],
      [{ id: "wood", qty: 3 }],
    ];
    return pool[Math.floor(rnd() * pool.length)].map((x) => ({ ...x }));
  }

  function makeZombie(x, y, rnd) {
    const r = rnd || Math.random;
    return {
      id: Math.floor(r() * 1e9),
      x, y,
      vx: 0, vy: 0,
      r: ZOMBIE_R,
      hp: 28 + Math.floor(r() * 20),
      maxHp: 40,
      speed: ZOMBIE_SPEED * (0.85 + r() * 0.3),
      attackCd: 0,
      wanderT: r() * 3,
      wx: x, wy: y,
      alive: true,
      hitFlash: 0,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════
  function serialize() {
    return {
      v: 2,
      seed: state.seed,
      day: state.day,
      dayTimer: state.dayTimer,
      time: state.time,
      player: {
        x: state.player.x, y: state.player.y,
        hp: state.player.hp, maxHp: state.player.maxHp,
        hunger: state.player.hunger,
        weapon: state.player.weapon,
        inv: state.player.inv,
        skills: state.player.skills,
        kills: state.player.kills,
      },
      zombies: state.zombies.filter((z) => z.alive).map((z) => ({
        id: z.id, x: z.x, y: z.y, hp: z.hp, speed: z.speed,
      })),
      props: state.props.map((p) => ({
        kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r,
        solid: p.solid, hp: p.hp, gathered: p.gathered, loot: p.loot,
        base: p.base || null,
      })),
      lootPiles: state.lootPiles,
      tutorialShown: state.tutorialShown,
    };
  }

  function normalizeLoadedProps(props) {
    return (props || []).map((p) => {
      const out = Object.assign({}, p);
      if (out.kind === "building") {
        out.base = Object.assign(defaultBase(), out.base || {});
        if (!Array.isArray(out.base.stash)) out.base.stash = [];
      }
      return out;
    });
  }

  function saveGame(silent) {
    if (!state.player) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
      try { localStorage.removeItem(SAVE_KEY_LEGACY); } catch (e2) { /* ignore */ }
      if (!silent) toast("Game saved");
    } catch (e) {
      toast("Save failed (storage full?)");
    }
  }

  function loadRaw() {
    try {
      let raw = localStorage.getItem(SAVE_KEY);
      if (raw) return JSON.parse(raw);
      raw = localStorage.getItem(SAVE_KEY_LEGACY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      data.v = 2;
      if (data.player) data.player.skills = migrateSkills(data.player.skills);
      data.props = normalizeLoadedProps(data.props);
      return data;
    } catch (e) { return null; }
  }

  function loadGame() {
    try {
      const data = loadRaw();
      if (!data || !data.player) return false;
      state.seed = data.seed;
      state.day = data.day || 1;
      state.dayTimer = data.dayTimer || 0;
      state.time = data.time || 0;
      state.tutorialShown = !!data.tutorialShown;
      state.props = normalizeLoadedProps(data.props);
      state.lootPiles = data.lootPiles || [];
      state.zombies = (data.zombies || []).map((z) => {
        const zz = makeZombie(z.x, z.y);
        zz.id = z.id; zz.hp = z.hp; zz.speed = z.speed; zz.alive = true;
        return zz;
      });
      const p = createPlayer(data.player.x, data.player.y, data.player.skills);
      Object.assign(p, {
        hp: data.player.hp,
        maxHp: data.player.maxHp || 100,
        hunger: data.player.hunger,
        weapon: data.player.weapon,
        inv: data.player.inv || [],
        kills: data.player.kills || 0,
      });
      state.player = p;
      state.particles = [];
      state.floatTexts = [];
      state.tapMarkers = [];
      return true;
    } catch (e) {
      return false;
    }
  }

  function hasSave() {
    try { return !!(localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY)); } catch (e) { return false; }
  }

  function resetSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(SAVE_KEY_LEGACY);
    } catch (e) { /* ignore */ }
  }

  function startNewGame() {
    state.seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const world = generateWorld(state.seed);
    state.props = world.props;
    state.zombies = world.zombies;
    state.lootPiles = world.lootPiles;
    state.player = createPlayer(world.spawn.x, world.spawn.y);
    state.player.weapon = "knife";
    state.day = 1;
    state.dayTimer = 0;
    state.time = 0;
    state.particles = [];
    state.floatTexts = [];
    state.tapMarkers = [];
    state.deathTimer = 0;
    state.tutorialShown = false;
    state.running = true;
    state.paused = false;
    saveGame(true);
  }


  function canAfford(need) {
    return Object.keys(need).every((id) => invCount(state.player.inv, id) >= need[id]);
  }
  function payNeed(need) {
    for (const [id, q] of Object.entries(need)) invRemove(state.player.inv, id, q);
  }
  function claimBuilding(b) {
    if (!b || b.kind !== "building") return false;
    if (!pointInBuilding(state.player.x, state.player.y, b)) { toast("Stand inside to claim"); return false; }
    if (b.base.claimed) { toast("Already claimed"); return false; }
    b.base.claimed = true; b.base.type = "none"; b.base.wallHp = 20; b.base.wallMax = 20;
    gainXp(state.player, "construction", 15);
    toast("Building claimed — choose a type");
    saveGame(true);
    return true;
  }
  function setBuildingType(b, type) {
    const def = BUILDING_TYPES[type];
    if (!b || !b.base || !b.base.claimed || !def || type === "none") return false;
    if (state.player.skills.construction.level < (def.skill || 1)) { toast("Need Construction " + def.skill); return false; }
    for (const other of buildingsList()) {
      if (other !== b && other.base && other.base.type === type) { toast("You already have a " + def.name); return false; }
    }
    b.base.type = type;
    gainXp(state.player, "construction", 20);
    toast("Designated as " + def.name);
    saveGame(true);
    return true;
  }
  function doFortify(b, key) {
    const f = FORTIFY[key];
    if (!f || !b || !b.base || !b.base.claimed) return false;
    const p = state.player;
    if (p.skills.construction.level < f.skill) { toast("Need Construction " + f.skill); return false; }
    if (!canAfford(f.need)) { toast("Need more planks/nails"); return false; }
    if (key === "board" && b.base.boarded) { toast("Windows already boarded"); return false; }
    if (key === "door" && b.base.doorReinforced) { toast("Door already reinforced"); return false; }
    if (key === "walls" && b.base.braced) { toast("Walls already braced"); return false; }
    if (key === "repair" && b.base.wallHp >= b.base.wallMax) { toast("Already at full fort HP"); return false; }
    payNeed(f.need);
    if (f.repair) b.base.wallHp = Math.min(b.base.wallMax, b.base.wallHp + f.repair);
    else {
      if (key === "board") b.base.boarded = true;
      if (key === "door") b.base.doorReinforced = true;
      if (key === "walls") b.base.braced = true;
      b.base.wallMax += f.addWall;
      b.base.wallHp = Math.min(b.base.wallMax, b.base.wallHp + f.addWall);
    }
    gainXp(p, "construction", f.xp);
    toast(f.label + " done");
    saveGame(true);
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════
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
      state.dayTimer -= DAY_LEN;
      state.day += 1;
      toast(`Day ${state.day} begins…`);
      // night brings a few more zombies far from camp
      spawnNightZombies();
    }

    const p = state.player;
    if (!p.alive) return;

    // Hunger
    p.hunger = Math.max(0, p.hunger - HUNGER_RATE * dt);
    if (p.hunger <= 0) {
      p.hp -= 2.5 * dt;
    } else if (p.hunger > 60 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + 1.2 * dt);
    }
    const insideB = playerBuilding();
    if (insideB && insideB.base && insideB.base.type === "safehouse" && insideB.base.wallHp > 0) {
      p.hp = Math.min(p.maxHp, p.hp + 3.5 * dt);
    }

    p.attackCd = Math.max(0, p.attackCd - dt);
    p.gatherCd = Math.max(0, p.gatherCd - dt);

    // Movement toward target
    if (p.target) {
      if (p.target.zombieId != null) {
        const z = state.zombies.find((zz) => zz.id === p.target.zombieId && zz.alive);
        if (!z) { p.target = null; }
        else {
          const d = dist(p, z);
          if (d <= ATTACK_RANGE) {
            p.vx = 0; p.vy = 0;
            tryAttack(p, z);
          } else {
            moveToward(p, z.x, z.y, moveSpeed(p), dt);
          }
        }
      } else if (p.target.propId != null) {
        const prop = state.props[p.target.propId];
        if (!prop || (prop.hp != null && prop.hp <= 0)) { p.target = null; }
        else {
          const px = propCenter(prop);
          const d = dist(p, px);
          if (d <= GATHER_RANGE) {
            p.vx = 0; p.vy = 0;
            tryGather(p, prop, p.target.propId);
          } else {
            moveToward(p, px.x, px.y, moveSpeed(p), dt);
          }
        }
      } else if (p.target.lootId != null) {
        const pile = state.lootPiles[p.target.lootId];
        if (!pile) { p.target = null; }
        else {
          const d = dist(p, pile);
          if (d <= GATHER_RANGE) {
            p.vx = 0; p.vy = 0;
            pickupLoot(p, p.target.lootId);
            p.target = null;
          } else {
            moveToward(p, pile.x, pile.y, moveSpeed(p), dt);
          }
        }
      } else {
        const d = Math.hypot(p.target.x - p.x, p.target.y - p.y);
        if (d < 4) {
          p.x = p.target.x; p.y = p.target.y;
          p.vx = 0; p.vy = 0;
          p.target = null;
        } else {
          moveToward(p, p.target.x, p.target.y, moveSpeed(p), dt);
        }
      }
    } else {
      p.vx = 0; p.vy = 0;
    }

    // Resolve player position vs solids
    resolveSolid(p);

    // Zombies — attack nearby fortifications, else chase player
    for (const z of state.zombies) {
      if (!z.alive) continue;
      z.hitFlash = Math.max(0, z.hitFlash - dt);
      z.attackCd = Math.max(0, z.attackCd - dt);
      const d = dist(z, p);
      let fort = null, fortDist = 9999;
      for (const b of buildingsList()) {
        if (!b.base || !b.base.claimed || b.base.wallHp <= 0) continue;
        const c = buildingCenter(b);
        if (dist(p, c) > 220) continue;
        const fd = dist(z, c);
        if (fd < fortDist) { fortDist = fd; fort = b; }
      }
      if (fort && fortDist < AGRO_RANGE + 40 && d > 70) {
        const door = { x: fort.x + fort.w / 2, y: fort.y + fort.h + 4 };
        if (dist(z, door) > 18) moveToward(z, door.x, door.y, z.speed, dt);
        else if (z.attackCd <= 0) {
          z.attackCd = 1.0;
          const dmg = 4 + Math.floor(Math.random() * 4);
          fort.base.wallHp = Math.max(0, fort.base.wallHp - dmg);
          floatText(door.x, door.y - 10, `-${dmg}`, "#e0b45a");
          if (fort.base.wallHp <= 0) toast("Barricade broken!");
        }
      } else if (d < AGRO_RANGE) {
        moveToward(z, p.x, p.y, z.speed, dt);
        if (d < z.r + p.r + 4 && z.attackCd <= 0) {
          const ib = playerBuilding();
          if (ib && ib.base && ib.base.claimed && ib.base.wallHp > 0) {
            z.attackCd = 1.1;
            const dmg = 3 + Math.floor(Math.random() * 3);
            ib.base.wallHp = Math.max(0, ib.base.wallHp - dmg);
            floatText(ib.x + ib.w / 2, ib.y, `wall -${dmg}`, "#e0b45a");
          } else {
            z.attackCd = 1.1;
            const dmg = 6 + Math.floor(Math.random() * 5);
            p.hp -= dmg;
            floatText(p.x, p.y - 20, `-${dmg}`, "#e05a5a");
            burst(p.x, p.y, "#e05a5a", 6);
            if (p.hp <= 0) { playerDie(); break; }
          }
        }
      } else {
        z.wanderT -= dt;
        if (z.wanderT <= 0) {
          z.wanderT = 2 + Math.random() * 3;
          z.wx = clamp(z.x + (Math.random() - 0.5) * 120, 40, WORLD_W - 40);
          z.wy = clamp(z.y + (Math.random() - 0.5) * 120, 40, WORLD_H - 40);
        }
        moveToward(z, z.wx, z.wy, z.speed * 0.35, dt);
      }
      resolveSolid(z);
    }

    // Particles / float text
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 40 * dt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.floatTexts.length - 1; i >= 0; i--) {
      const ft = state.floatTexts[i];
      ft.life -= dt;
      ft.y -= 20 * dt;
      if (ft.life <= 0) state.floatTexts.splice(i, 1);
    }
    for (let i = state.tapMarkers.length - 1; i >= 0; i--) {
      state.tapMarkers[i].life -= dt;
      if (state.tapMarkers[i].life <= 0) state.tapMarkers.splice(i, 1);
    }

    if (state.toastTimer > 0) {
      state.toastTimer -= dt;
      if (state.toastTimer <= 0) {
        document.getElementById("toast").classList.remove("show");
      }
    }

    // Autosave every ~20s
    if (Math.floor(state.time / 20) !== Math.floor((state.time - dt) / 20)) {
      saveGame(true);
    }

    updateHud();
  }

  function moveToward(ent, tx, ty, speed, dt) {
    const dx = tx - ent.x, dy = ty - ent.y;
    const d = Math.hypot(dx, dy) || 1;
    ent.facing = Math.atan2(dy, dx);
    const step = Math.min(speed * dt, d);
    ent.x += (dx / d) * step;
    ent.y += (dy / d) * step;
    ent.x = clamp(ent.x, 20, WORLD_W - 20);
    ent.y = clamp(ent.y, 20, WORLD_H - 20);
  }

  function propCenter(prop) {
    if (prop.kind === "building") {
      return { x: prop.x + prop.w / 2, y: prop.y + prop.h / 2 };
    }
    return { x: prop.x, y: prop.y };
  }

  function resolveSolid(ent) {
    for (const prop of state.props) {
      if (!prop.solid) continue;
      if (prop.kind === "building") {
        // Enterable interiors; fortification is HP-based, not a physics wall.
        continue;
      } else if (prop.r) {
        const d = dist(ent, prop);
        const minD = ent.r + prop.r * 0.7;
        if (d < minD && d > 0) {
          const push = (minD - d) / d;
          ent.x += (ent.x - prop.x) * push;
          ent.y += (ent.y - prop.y) * push;
        }
      }
    }
  }

  function tryAttack(p, z) {
    if (p.attackCd > 0) return;
    p.attackCd = 0.55;
    const base = weaponDmg(p);
    const bonus = 1 + (p.skills.combat.level - 1) * 0.08;
    const dmg = Math.round(base * bonus * (0.85 + Math.random() * 0.3));
    z.hp -= dmg;
    z.hitFlash = 0.15;
    floatText(z.x, z.y - 18, `-${dmg}`, "#ffe08a");
    burst(z.x, z.y, "#7ecf8a", 5);
    gainXp(p, "combat", 4 + Math.floor(dmg / 5));
    gainXp(p, "fitness", 1);
    if (z.hp <= 0) {
      z.alive = false;
      p.kills += 1;
      toast("Zombie down");
      // chance to drop scrap/cloth
      if (Math.random() < 0.45) {
        const drop = Math.random() < 0.5 ? { id: "cloth", qty: 1 } : { id: "scrap", qty: 1 };
        state.lootPiles.push({ x: z.x, y: z.y, items: [drop], life: 120 });
      }
      gainXp(p, "combat", 10);
    }
  }

  function tryGather(p, prop, idx) {
    if (p.gatherCd > 0) return;
    if (prop.kind === "building" || prop.kind === "campfire") {
      p.target = null;
      return;
    }
    p.gatherCd = 0.7;
    const forageBonus = p.skills.foraging.level;

    if (prop.kind === "tree") {
      prop.hp -= 1;
      invAdd(p.inv, "wood", 1);
      if (Math.random() < 0.35 + forageBonus * 0.03) invAdd(p.inv, "stick", 1);
      floatText(prop.x, prop.y - 16, "+wood", "#a8d4a0");
      gainXp(p, "foraging", 5);
      gainXp(p, "fitness", 2);
      if (prop.hp <= 0) {
        prop.solid = false;
        prop.gathered = 1;
        toast("Tree felled");
        p.target = null;
      }
    } else if (prop.kind === "bush") {
      prop.hp = 0;
      prop.gathered = 1;
      const qty = 1 + (Math.random() < 0.3 + forageBonus * 0.04 ? 1 : 0);
      invAdd(p.inv, "berries", qty);
      floatText(prop.x, prop.y - 16, "+berries", "#d48ad0");
      gainXp(p, "foraging", 6);
      toast("Picked berries");
      p.target = null;
    } else if (prop.kind === "crate") {
      prop.hp = 0;
      prop.solid = false;
      if (prop.loot) {
        for (const it of prop.loot) invAdd(p.inv, it.id, it.qty);
        state.lootPiles.push({ x: prop.x, y: prop.y, items: prop.loot.map((x) => ({ ...x })), life: 0.01 });
        // immediately try pickup into inv already done; clear tiny pile
        state.lootPiles.pop();
      }
      floatText(prop.x, prop.y - 16, "Loot!", "#e0b45a");
      gainXp(p, "foraging", 8);
      toast("Crate looted");
      p.target = null;
    } else if (prop.kind === "scrapheap") {
      prop.hp -= 1;
      invAdd(p.inv, "scrap", 1);
      if (Math.random() < 0.2) invAdd(p.inv, "cloth", 1);
      if (Math.random() < 0.25) invAdd(p.inv, "nails", 1);
      floatText(prop.x, prop.y - 16, "+scrap", "#9aa0a8");
      gainXp(p, "foraging", 5);
      if (prop.hp <= 0) {
        prop.gathered = 1;
        p.target = null;
        toast("Scrap pile cleared");
      }
    }
  }

  function pickupLoot(p, idx) {
    const pile = state.lootPiles[idx];
    if (!pile) return;
    const left = [];
    for (const it of pile.items) {
      const before = invCount(p.inv, it.id);
      invAdd(p.inv, it.id, it.qty);
      const after = invCount(p.inv, it.id);
      const took = after - before;
      if (took < it.qty) left.push({ id: it.id, qty: it.qty - took });
    }
    if (left.length) {
      pile.items = left;
      toast("Bag full — some left on ground");
    } else {
      state.lootPiles.splice(idx, 1);
      toast("Loot picked up");
    }
  }

  function playerDie() {
    const p = state.player;
    p.alive = false;
    p.hp = 0;
    // Drop inventory as loot pile
    if (p.inv.length) {
      state.lootPiles.push({
        x: p.x,
        y: p.y,
        items: p.inv.map((it) => ({ id: it.id, qty: it.qty })),
        life: 99999,
        deathDrop: true,
      });
    }
    p.inv = [];
    p.weapon = null;
    p.target = null;
    state.deathTimer = 2.8;
    document.getElementById("death-banner").classList.add("show");
    toast("You died — skills kept, gear dropped");
    saveGame(true);
  }

  function respawnPlayer() {
    const safe = getSafehouse();
    const camp = state.props.find((pr) => pr.kind === "campfire");
    let sx, sy;
    if (safe) { sx = safe.x + safe.w / 2; sy = safe.y + safe.h / 2; }
    else if (camp) { sx = camp.x; sy = camp.y + 40; }
    else { sx = WORLD_W / 2; sy = WORLD_H / 2; }
    const skills = state.player.skills;
    const kills = state.player.kills;
    const maxHp = state.player.maxHp;
    state.player = createPlayer(sx, sy, skills);
    state.player.kills = kills;
    state.player.maxHp = maxHp;
    state.player.hp = Math.min(60, maxHp);
    state.player.hunger = 55;
    state.player.inv = [{ id: "berries", qty: 1 }];
    toast(safe ? "Respawned at Safehouse" : "Back at the campfire. Recover your gear if you can.");
    saveGame(true);
  }

  function spawnNightZombies() {
    const camp = state.props.find((pr) => pr.kind === "campfire");
    const cx = camp ? camp.x : WORLD_W / 2;
    const cy = camp ? camp.y : WORLD_H / 2;
    const alive = state.zombies.filter((z) => z.alive).length;
    const add = Math.min(6, Math.max(0, 35 - alive));
    for (let i = 0; i < add; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 350 + Math.random() * 500;
      const x = clamp(cx + Math.cos(ang) * rad, 60, WORLD_W - 60);
      const y = clamp(cy + Math.sin(ang) * rad, 60, WORLD_H - 60);
      state.zombies.push(makeZombie(x, y));
    }
    if (add) toast(`${add} more dead stir in the dark…`);
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 60;
      state.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.4, color, r: 2 + Math.random() * 2,
      });
    }
  }

  function floatText(x, y, text, color) {
    state.floatTexts.push({ x, y, text, color, life: 0.9 });
  }

  function toast(msg) {
    state.toastMsg = msg;
    state.toastTimer = 2.2;
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
  }

  // ═══════════════════════════════════════════════════════════
  // INPUT
  // ═══════════════════════════════════════════════════════════
  const canvas = document.getElementById("game");
  const minimap = document.getElementById("minimap");
  const ctx = canvas.getContext("2d");
  const mctx = minimap.getContext("2d");

  /**
   * Screen→world in CSS/logical pixels (matches ctx.setTransform(dpr) draw space).
   * Do NOT multiply by canvas.width/height (backing store) — that double-applies DPR.
   */
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

  function canvasToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return clientToWorld(clientX, clientY, rect, state.cam, state.viewW, state.viewH);
  }

  function onTap(clientX, clientY) {
    if (!state.running || state.paused || state.deathTimer > 0) return;
    const p = state.player;
    if (!p || !p.alive) return;
    const w = canvasToWorld(clientX, clientY);

    // Tap marker so player sees registered world point
    state.tapMarkers.push({ x: w.x, y: w.y, life: 0.55 });

    // Zombie first — generous hit pad for fat-finger taps
    let bestZ = null, bestZd = 40;
    for (const z of state.zombies) {
      if (!z.alive) continue;
      const d = Math.hypot(z.x - w.x, z.y - w.y);
      if (d < z.r + 28 && d < bestZd) { bestZ = z; bestZd = d; }
    }
    if (bestZ) {
      p.target = { zombieId: bestZ.id };
      return;
    }

    // Loot piles
    for (let i = 0; i < state.lootPiles.length; i++) {
      const pile = state.lootPiles[i];
      if (Math.hypot(pile.x - w.x, pile.y - w.y) < 28) {
        p.target = { lootId: i };
        return;
      }
    }

    // Gatherables
    let bestP = -1, bestPd = 46;
    for (let i = 0; i < state.props.length; i++) {
      const prop = state.props[i];
      if (prop.kind === "building" || prop.kind === "campfire") continue;
      if (prop.hp != null && prop.hp <= 0) continue;
      if (prop.gathered) continue;
      const c = propCenter(prop);
      const d = Math.hypot(c.x - w.x, c.y - w.y);
      const hitR = prop.r ? prop.r + 22 : 28;
      if (d < hitR && d < bestPd) { bestP = i; bestPd = d; }
    }
    if (bestP >= 0) {
      p.target = { propId: bestP };
      return;
    }

    // Move
    p.target = {
      x: clamp(w.x, 20, WORLD_W - 20),
      y: clamp(w.y, 20, WORLD_H - 20),
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    onTap(e.clientX, e.clientY);
  }, { passive: false });
  canvas.addEventListener("touchstart", (e) => { e.preventDefault(); }, { passive: false });
  canvas.addEventListener("gesturestart", (e) => { e.preventDefault(); }, { passive: false });

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  function resize() {
    const wrap = document.getElementById("canvas-wrap");
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight);
    state.viewW = w;
    state.viewH = h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function dayFactor() {
    // 0 night-ish, 1 day — based on dayTimer
    const t = state.dayTimer / DAY_LEN;
    // dawn 0-0.15, day 0.15-0.55, dusk 0.55-0.7, night 0.7-1
    if (t < 0.15) return 0.45 + (t / 0.15) * 0.55;
    if (t < 0.55) return 1;
    if (t < 0.7) return 1 - ((t - 0.55) / 0.15) * 0.55;
    return 0.4;
  }

  function timeLabel() {
    const t = state.dayTimer / DAY_LEN;
    if (t < 0.15) return "Dawn";
    if (t < 0.55) return "Day";
    if (t < 0.7) return "Dusk";
    return "Night";
  }

  function render() {
    const vw = state.viewW;
    const vh = state.viewH;
    if (!state.player) {
      ctx.fillStyle = "#3a5a28";
      ctx.fillRect(0, 0, vw, vh);
      return;
    }

    const p = state.player;
    state.cam.x = clamp(p.x - vw / 2, 0, Math.max(0, WORLD_W - vw));
    state.cam.y = clamp(p.y - vh / 2, 0, Math.max(0, WORLD_H - vh));
    const cam = state.cam;
    const light = dayFactor();

    // Chunky grass/dirt/stone tiles (RSC-inspired original)
    const t0x = Math.floor(cam.x / TILE) - 1;
    const t0y = Math.floor(cam.y / TILE) - 1;
    const t1x = Math.ceil((cam.x + vw) / TILE) + 1;
    const t1y = Math.ceil((cam.y + vh) / TILE) + 1;
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const h = ((tx * 73856093) ^ (ty * 19349663) ^ state.seed) >>> 0;
        const kind = h % 7;
        let r, g, b;
        if (kind < 4) { r = 40 + (h % 20); g = (90 + light * 40 + (h % 25)) | 0; b = 35; }
        else if (kind < 6) { r = 90 + (h % 20); g = 70 + (h % 15); b = 40; }
        else { r = 110; g = 105; b = 85; }
        ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
        ctx.fillRect(tx * TILE - cam.x, ty * TILE - cam.y, TILE, TILE);
        ctx.strokeStyle = "rgba(0,0,0,0.08)";
        ctx.strokeRect(tx * TILE - cam.x + 0.5, ty * TILE - cam.y + 0.5, TILE - 1, TILE - 1);
      }
    }

    // Props
    for (const prop of state.props) {
      drawProp(prop, cam, light);
    }

    // Loot piles
    for (const pile of state.lootPiles) {
      const sx = pile.x - cam.x, sy = pile.y - cam.y;
      if (sx < -20 || sy < -20 || sx > vw + 20 || sy > vh + 20) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.fillStyle = pile.deathDrop ? "#c9a227" : "#8a7a4a";
      ctx.fill();
      ctx.strokeStyle = "#e8d080";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#1a1810";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loot", sx, sy + 3);
    }

    // Zombies
    for (const z of state.zombies) {
      if (!z.alive) continue;
      const sx = z.x - cam.x, sy = z.y - cam.y;
      if (sx < -30 || sy < -30 || sx > vw + 30 || sy > vh + 30) continue;
      drawZombie(sx, sy, z);
    }

    // Player
    if (p.alive || state.deathTimer > 0) {
      drawPlayer(p.x - cam.x, p.y - cam.y, p);
    }

    // Move target marker
    if (p.target && p.target.x != null && p.target.zombieId == null && p.target.propId == null && p.target.lootId == null) {
      ctx.beginPath();
      ctx.arc(p.target.x - cam.x, p.target.y - cam.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(126,207,138,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Attack range ring when near zombie target
    if (p.target && p.target.zombieId != null) {
      ctx.beginPath();
      ctx.arc(p.x - cam.x, p.y - cam.y, ATTACK_RANGE, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(224,90,90,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Tap registration markers
    for (const tm of state.tapMarkers) {
      const a = Math.max(0, tm.life / 0.55);
      ctx.beginPath();
      ctx.arc(tm.x - cam.x, tm.y - cam.y, 10 + (1 - a) * 8, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(232,200,96,${a})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tm.x - cam.x, tm.y - cam.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(232,200,96,${a})`;
      ctx.fill();
    }

    // Particles
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life * 2);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x - cam.x, pt.y - cam.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Float texts
    ctx.textAlign = "center";
    ctx.font = "bold 12px sans-serif";
    for (const ft of state.floatTexts) {
      ctx.globalAlpha = Math.min(1, ft.life * 2);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x - cam.x, ft.y - cam.y);
      ctx.globalAlpha = 1;
    }

    // Night vignette
    if (light < 0.85) {
      const g = ctx.createRadialGradient(vw / 2, vh / 2, vw * 0.2, vw / 2, vh / 2, vw * 0.75);
      const a = (1 - light) * 0.55;
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);
    }

    drawMinimap();
  }

  function drawProp(prop, cam, light) {
    const wrap = document.getElementById("canvas-wrap");
    const vw = wrap.clientWidth, vh = wrap.clientHeight;

    if (prop.kind === "building") {
      const sx = prop.x - cam.x, sy = prop.y - cam.y;
      if (sx + prop.w < -40 || sy + prop.h < -40 || sx > vw + 40 || sy > vh + 40) return;
      // stone floor
      ctx.fillStyle = "#6a6050";
      ctx.fillRect(sx, sy, prop.w, prop.h);
      // timber frame walls
      ctx.fillStyle = "#5a4030";
      ctx.fillRect(sx, sy, prop.w, 10);
      ctx.fillRect(sx, sy + prop.h - 10, prop.w, 10);
      ctx.fillRect(sx, sy, 10, prop.h);
      ctx.fillRect(sx + prop.w - 10, sy, 10, prop.h);
      ctx.strokeStyle = "#3a2a18";
      ctx.lineWidth = 1;
      for (let yy = 12; yy < prop.h - 12; yy += 10) {
        for (let xx = 12; xx < prop.w - 12; xx += 16) ctx.strokeRect(sx + xx, sy + yy, 14, 8);
      }
      // red roof
      ctx.fillStyle = "#7a3030";
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy + 4);
      ctx.lineTo(sx + prop.w / 2, sy - 22);
      ctx.lineTo(sx + prop.w + 4, sy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#1a1208";
      ctx.lineWidth = 2;
      ctx.stroke();
      // door
      ctx.fillStyle = "#4a3a28";
      ctx.fillRect(sx + prop.w / 2 - 12, sy + prop.h - 10, 24, 10);
      const winColor = (prop.base && prop.base.boarded) ? "#5a4028" : "#80a0c0";
      ctx.fillStyle = winColor;
      ctx.fillRect(sx + 18, sy + 28, 16, 14);
      ctx.fillRect(sx + prop.w - 34, sy + 28, 16, 14);
      ctx.strokeStyle = "#1a1208";
      ctx.strokeRect(sx + 18, sy + 28, 16, 14);
      ctx.strokeRect(sx + prop.w - 34, sy + 28, 16, 14);
      if (prop.base && prop.base.boarded) {
        ctx.beginPath();
        ctx.moveTo(sx + 18, sy + 28); ctx.lineTo(sx + 34, sy + 42);
        ctx.moveTo(sx + 34, sy + 28); ctx.lineTo(sx + 18, sy + 42);
        ctx.stroke();
      }
      ctx.strokeStyle = "#1a1208";
      ctx.lineWidth = 3;
      ctx.strokeRect(sx, sy, prop.w, prop.h);
      if (prop.base && prop.base.claimed) {
        const label = (BUILDING_TYPES[prop.base.type] && BUILDING_TYPES[prop.base.type].name) || "Claimed";
        ctx.fillStyle = "#e8c860";
        ctx.font = "bold 11px Georgia";
        ctx.textAlign = "center";
        ctx.fillText(label, sx + prop.w / 2, sy - 28);
        if (prop.base.wallMax > 0) {
          ctx.fillStyle = "#1a1208";
          ctx.fillRect(sx + 10, sy + prop.h + 4, prop.w - 20, 5);
          ctx.fillStyle = "#6aaa40";
          ctx.fillRect(sx + 10, sy + prop.h + 4, (prop.w - 20) * (prop.base.wallHp / prop.base.wallMax), 5);
        }
      }
      return;
    }

    const sx = prop.x - cam.x, sy = prop.y - cam.y;
    if (sx < -40 || sy < -40 || sx > vw + 40 || sy > vh + 40) return;

    if (prop.kind === "campfire") {
      ctx.beginPath();
      ctx.arc(sx, sy, 18, 0, Math.PI * 2);
      ctx.fillStyle = "#3a3228";
      ctx.fill();
      const flicker = 10 + Math.sin(state.time * 8) * 3;
      const fg = ctx.createRadialGradient(sx, sy, 2, sx, sy, flicker);
      fg.addColorStop(0, "rgba(255,200,80,0.95)");
      fg.addColorStop(0.5, "rgba(255,100,40,0.55)");
      fg.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(sx, sy - 4, flicker, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c9a06a";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("CAMP", sx, sy + 28);
      return;
    }

    if (prop.kind === "tree") {
      if (prop.hp <= 0) {
        ctx.fillStyle = "#4a3a28";
        ctx.fillRect(sx - 4, sy - 4, 8, 10);
        return;
      }
      ctx.fillStyle = "#5a4030";
      ctx.fillRect(sx - 4, sy - 2, 8, 16);
      ctx.beginPath();
      ctx.arc(sx, sy - 14, 16, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${30 + light * 20 | 0},${90 + light * 40 | 0},${45})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx - 8, sy - 8, 10, 0, Math.PI * 2);
      ctx.arc(sx + 8, sy - 10, 11, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (prop.kind === "bush") {
      if (prop.hp <= 0) return;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 14, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${40},${100 + light * 30 | 0},${55})`;
      ctx.fill();
      ctx.fillStyle = "#c060a0";
      ctx.beginPath();
      ctx.arc(sx - 4, sy - 2, 2.5, 0, Math.PI * 2);
      ctx.arc(sx + 5, sy + 1, 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (prop.kind === "crate") {
      if (prop.hp <= 0) return;
      ctx.fillStyle = "#8a6a38";
      ctx.fillRect(sx - 11, sy - 9, 22, 18);
      ctx.strokeStyle = "#5a4020";
      ctx.strokeRect(sx - 11, sy - 9, 22, 18);
      ctx.beginPath();
      ctx.moveTo(sx - 11, sy);
      ctx.lineTo(sx + 11, sy);
      ctx.stroke();
      return;
    }

    if (prop.kind === "scrapheap") {
      if (prop.hp <= 0) return;
      ctx.fillStyle = "#6a7078";
      ctx.beginPath();
      ctx.moveTo(sx - 12, sy + 6);
      ctx.lineTo(sx - 4, sy - 8);
      ctx.lineTo(sx + 10, sy - 4);
      ctx.lineTo(sx + 12, sy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#9aa0a8";
      ctx.fillRect(sx - 2, sy - 2, 8, 5);
    }
  }

  function drawPlayer(sx, sy, p) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(sx, sy + 11, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3a6a4a";
    ctx.beginPath(); ctx.arc(sx, sy, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#d2b48c";
    ctx.beginPath(); ctx.arc(sx, sy - 8, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 2; ctx.stroke();
    const fx = Math.cos(p.facing) * 7;
    const fy = Math.sin(p.facing) * 7;
    if (p.weapon) {
      ctx.strokeStyle = "#c9c0a0"; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx + fx * 0.4, sy + fy * 0.4);
      ctx.lineTo(sx + fx * 2.4, sy + fy * 2.4);
      ctx.stroke();
    }
  }

  function drawZombie(sx, sy, z) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(sx, sy + 10, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = z.hitFlash > 0 ? "#c8e0a0" : "#5a7a40";
    ctx.beginPath(); ctx.arc(sx, sy, z.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1a1208"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#c04040";
    ctx.fillRect(sx - 5, sy - 5, 3, 3);
    ctx.fillRect(sx + 2, sy - 5, 3, 3);
    if (z.hp < 40) {
      ctx.fillStyle = "#1a1208";
      ctx.fillRect(sx - 12, sy - 22, 24, 4);
      ctx.fillStyle = "#c04040";
      ctx.fillRect(sx - 12, sy - 22, 24 * clamp(z.hp / 40, 0, 1), 4);
    }
  }

  function drawMinimap() {
    const s = 72 / Math.max(WORLD_W, WORLD_H);
    mctx.clearRect(0, 0, 72, 72);
    mctx.fillStyle = "rgba(20,35,28,0.9)";
    mctx.fillRect(0, 0, 72, 72);
    for (const prop of state.props) {
      if (prop.kind === "building") {
        mctx.fillStyle = (prop.base && prop.base.claimed) ? "#e8c860" : "#6a5438";
        mctx.fillRect(prop.x * s, prop.y * s, Math.max(2, prop.w * s), Math.max(2, prop.h * s));
      } else if (prop.kind === "campfire") {
        mctx.fillStyle = "#e0a040";
        mctx.fillRect(prop.x * s - 1, prop.y * s - 1, 3, 3);
      }
    }
    for (const z of state.zombies) {
      if (!z.alive) continue;
      mctx.fillStyle = "#c04040";
      mctx.fillRect(z.x * s - 0.5, z.y * s - 0.5, 2, 2);
    }
    if (state.player) {
      mctx.fillStyle = "#7ecf8a";
      mctx.fillRect(state.player.x * s - 1.5, state.player.y * s - 1.5, 3, 3);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HUD / UI
  // ═══════════════════════════════════════════════════════════
  function updateHud() {
    const p = state.player;
    if (!p) return;
    const hpPct = clamp(p.hp / p.maxHp, 0, 1) * 100;
    const huPct = clamp(p.hunger / p.maxHunger, 0, 1) * 100;
    document.querySelector("#bar-health i").style.width = hpPct + "%";
    document.querySelector("#bar-hunger i").style.width = huPct + "%";
    document.getElementById("val-health").textContent = Math.ceil(Math.max(0, p.hp));
    document.getElementById("val-hunger").textContent = Math.ceil(p.hunger);
    document.getElementById("val-day").textContent = String(state.day);
    document.getElementById("val-time").textContent = timeLabel();

    // XP bar shows combat progress as a general "progress" feel
    const c = p.skills.combat;
    document.querySelector("#bar-xp i").style.width = (c.xp / c.next) * 100 + "%";

    const sk = document.getElementById("hud-skills");
    sk.innerHTML = SKILL_NAMES.map((n) => {
      const s = p.skills[n];
      return `<span class="skill-chip">${SKILL_LABELS[n]} <strong>${s.level}</strong></span>`;
    }).join("") + `<span class="skill-chip">Kills <strong>${p.kills}</strong></span>`
      + (p.weapon ? `<span class="skill-chip">Weap <strong>${ITEM_DEFS[p.weapon].name}</strong></span>` : "");
  }

  function openOverlay(id) {
    state.paused = true;
    document.getElementById(id).classList.add("open");
  }
  function closeOverlays() {
    document.querySelectorAll(".overlay").forEach((el) => el.classList.remove("open"));
    state.paused = false;
    state.selectedInv = -1;
  }

  function renderInventory() {
    const grid = document.getElementById("inv-grid");
    const inv = state.player ? state.player.inv : [];
    let html = "";
    if (!inv.length) html = "<p>Bag is empty. Scavenge crates, trees, and bushes.</p>";
    else {
      html = inv.map((it, i) => {
        const def = ITEM_DEFS[it.id] || { name: it.id };
        const eq = state.player.weapon === it.id ? " · equipped" : "";
        const sel = state.selectedInv === i ? " selected" : "";
        return `<button type="button" class="inv-item${sel}" data-idx="${i}">
          <span class="name">${def.name} ×${it.qty}</span>
          <span class="meta">${def.type}${eq}</span>
        </button>`;
      }).join("");
    }
    const storage = getStorageBuilding();
    if (storage && pointInBuilding(state.player.x, state.player.y, storage)) {
      const stash = storage.base.stash || [];
      html += '<p style="margin-top:10px"><strong>Storage stash</strong> (survives death)</p>';
      html += '<div class="panel-actions"><button class="btn" type="button" id="btn-stash-dep">Deposit mats/food</button>' +
        '<button class="btn" type="button" id="btn-stash-wd">Withdraw all</button></div>';
      html += stash.length
        ? '<p>' + stash.map((s) => (ITEM_DEFS[s.id] ? ITEM_DEFS[s.id].name : s.id) + "×" + s.qty).join(", ") + "</p>"
        : "<p>Stash empty.</p>";
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".inv-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedInv = +btn.dataset.idx;
        renderInventory();
      });
    });
    const dep = document.getElementById("btn-stash-dep");
    const wd = document.getElementById("btn-stash-wd");
    if (dep) dep.addEventListener("click", () => { stashDeposit(); renderInventory(); });
    if (wd) wd.addEventListener("click", () => { stashWithdraw(); renderInventory(); });
  }

  function renderCraft() {
    const list = document.getElementById("craft-list");
    const p = state.player;
    const craftLv = p.skills.crafting.level;
    list.innerHTML = RECIPES.map((r) => {
      const locked = craftLv < r.skill;
      const needShop = r.workshop && !hasWorkshop();
      const needKit = r.kitchen && !hasKitchen();
      const blocked = locked || needShop || needKit;
      const can = !blocked && canAfford(r.need);
      const needStr = Object.entries(r.need).map(([id, q]) => `${ITEM_DEFS[id].name}×${q}`).join(", ");
      const outName = ITEM_DEFS[r.out.id].name;
      let note = "";
      if (needShop) note = " · need Workshop";
      else if (needKit) note = " · need Kitchen";
      else if (locked) note = ` · Crafting ${r.skill}+`;
      return `<div class="craft-row">
        <div>
          <strong>${outName}</strong>
          <div class="meta" style="color:var(--muted);font-size:11px;margin-top:2px">
            Need: ${needStr}${note}
          </div>
        </div>
        <button type="button" data-recipe="${r.id}" ${can ? "" : "disabled"}>Craft</button>
      </div>`;
    }).join("");
    list.querySelectorAll("button[data-recipe]").forEach((btn) => {
      btn.addEventListener("click", () => {
        doCraft(btn.dataset.recipe);
        renderCraft();
        updateHud();
      });
    });
  }

  function doCraft(recipeId) {
    const r = RECIPES.find((x) => x.id === recipeId);
    if (!r || !state.player) return;
    const p = state.player;
    if (p.skills.crafting.level < r.skill) return;
    if (r.workshop && !hasWorkshop()) return;
    if (r.kitchen && !hasKitchen()) return;
    if (!canAfford(r.need)) return;
    const keep = new Set(r.keep || []);
    for (const [id, q] of Object.entries(r.need)) {
      if (keep.has(id)) continue;
      invRemove(p.inv, id, q);
    }
    invAdd(p.inv, r.out.id, r.out.qty);
    gainXp(p, "crafting", r.xp);
    toast(`Crafted ${ITEM_DEFS[r.out.id].name}`);
    saveGame(true);
  }

  function renderBuild() {
    const status = document.getElementById("build-status");
    const actions = document.getElementById("build-actions");
    if (!status || !actions) return;
    const b = playerBuilding();
    const p = state.player;
    if (!b) {
      status.textContent = "Walk inside a stone building, then open Build to claim or fortify it.";
      actions.innerHTML = "";
      return;
    }
    const base = b.base;
    if (!base.claimed) {
      status.textContent = "You are inside an unclaimed building.";
      actions.innerHTML = '<button class="btn primary" type="button" id="btn-claim" style="width:100%;min-height:52px">Claim this building</button>';
      document.getElementById("btn-claim").onclick = () => { claimBuilding(b); renderBuild(); updateHud(); };
      return;
    }
    const tdef = BUILDING_TYPES[base.type] || BUILDING_TYPES.none;
    status.innerHTML = "<strong>" + tdef.name + "</strong> — " + tdef.desc +
      "<br/>Fort HP: " + base.wallHp + "/" + base.wallMax +
      (base.boarded ? " · windows boarded" : "") +
      (base.doorReinforced ? " · door reinforced" : "") +
      (base.braced ? " · walls braced" : "") +
      "<br/>Construction lvl " + p.skills.construction.level;
    let html = "";
    if (base.type === "none") {
      html += '<p style="margin:8px 0 4px">Designate building type:</p><div class="build-type-grid">';
      for (const [k, def] of Object.entries(BUILDING_TYPES)) {
        if (k === "none") continue;
        html += '<button class="btn" type="button" data-type="' + k + '">' + def.name +
          '<br/><span style="font-weight:400;color:var(--muted)">Con ' + def.skill + '+</span></button>';
      }
      html += "</div>";
    }
    html += '<p style="margin:10px 0 4px">Fortify (planks &amp; nails):</p><div class="build-list">';
    for (const [key, f] of Object.entries(FORTIFY)) {
      const needStr = Object.entries(f.need).map(([id, q]) => ITEM_DEFS[id].name + "×" + q).join(", ");
      const can = p.skills.construction.level >= f.skill && canAfford(f.need);
      html += '<div class="build-row"><div><strong>' + f.label + '</strong>' +
        '<div style="color:var(--muted);font-size:11px">' + needStr + " · Con " + f.skill + "+</div></div>" +
        '<button type="button" data-fort="' + key + '"' + (can ? "" : " disabled") + ">Build</button></div>";
    }
    html += "</div>";
    actions.innerHTML = html;
    actions.querySelectorAll("[data-type]").forEach((btn) => {
      btn.onclick = () => { setBuildingType(b, btn.dataset.type); renderBuild(); updateHud(); };
    });
    actions.querySelectorAll("[data-fort]").forEach((btn) => {
      btn.onclick = () => { doFortify(b, btn.dataset.fort); renderBuild(); updateHud(); };
    });
  }

  function stashDeposit() {
    const storage = getStorageBuilding();
    if (!storage || !pointInBuilding(state.player.x, state.player.y, storage)) return;
    const p = state.player;
    const keep = [];
    for (const it of p.inv) {
      const t = ITEM_DEFS[it.id] && ITEM_DEFS[it.id].type;
      if (t === "mat" || t === "food" || t === "heal") invAdd(storage.base.stash, it.id, it.qty, 24);
      else keep.push(it);
    }
    p.inv = keep;
    if (p.weapon && !p.inv.some((i) => i.id === p.weapon)) p.weapon = null;
    toast("Deposited to stash");
    saveGame(true);
  }
  function stashWithdraw() {
    const storage = getStorageBuilding();
    if (!storage || !pointInBuilding(state.player.x, state.player.y, storage)) return;
    const left = [];
    for (const it of storage.base.stash) {
      const before = invCount(state.player.inv, it.id);
      invAdd(state.player.inv, it.id, it.qty);
      const took = invCount(state.player.inv, it.id) - before;
      if (took < it.qty) left.push({ id: it.id, qty: it.qty - took });
    }
    storage.base.stash = left;
    toast("Withdrew from stash");
    saveGame(true);
  }

  function useSelected() {
    const p = state.player;
    if (!p || state.selectedInv < 0 || state.selectedInv >= p.inv.length) {
      toast("Select an item first");
      return;
    }
    const it = p.inv[state.selectedInv];
    const def = ITEM_DEFS[it.id];
    if (!def) return;
    if (def.type === "food" || def.type === "heal") {
      p.hp = Math.min(p.maxHp, p.hp + (def.heal || 0));
      p.hunger = Math.min(p.maxHunger, p.hunger + (def.hunger || 0));
      invRemove(p.inv, it.id, 1);
      toast(`Used ${def.name}`);
      if (state.selectedInv >= p.inv.length) state.selectedInv = -1;
      renderInventory();
      updateHud();
      saveGame();
    } else if (def.type === "weapon") {
      p.weapon = it.id;
      toast(`Equipped ${def.name}`);
      renderInventory();
      updateHud();
      saveGame();
    } else {
      toast("Can't use that directly — try crafting");
    }
  }

  function dropSelected() {
    const p = state.player;
    if (!p || state.selectedInv < 0 || state.selectedInv >= p.inv.length) {
      toast("Select an item first");
      return;
    }
    const it = p.inv[state.selectedInv];
    if (p.weapon === it.id) p.weapon = null;
    state.lootPiles.push({
      x: p.x + 20, y: p.y,
      items: [{ id: it.id, qty: it.qty }],
      life: 99999,
    });
    p.inv.splice(state.selectedInv, 1);
    state.selectedInv = -1;
    toast("Dropped");
    renderInventory();
    updateHud();
    saveGame();
  }

  // ═══════════════════════════════════════════════════════════
  // LOOP & BOOT
  // ═══════════════════════════════════════════════════════════
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

  function hideTitle() {
    document.getElementById("title-screen").classList.add("hidden");
  }

  function beginPlay(fromSave) {
    hideTitle();
    closeOverlays();
    if (fromSave) {
      if (!loadGame()) {
        startNewGame();
      } else {
        state.running = true;
        state.paused = false;
        toast("Welcome back");
      }
    } else {
      startNewGame();
    }
    updateHud();
    if (!state.tutorialShown) {
      state.tutorialShown = true;
      setTimeout(() => openOverlay("overlay-help"), 400);
      saveGame();
    }
  }

  // Wire UI
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
  document.getElementById("btn-inv").addEventListener("click", () => {
    renderInventory();
    openOverlay("overlay-inv");
  });
  document.getElementById("btn-close-inv").addEventListener("click", closeOverlays);
  document.getElementById("btn-use").addEventListener("click", useSelected);
  document.getElementById("btn-drop").addEventListener("click", dropSelected);
  document.getElementById("btn-craft").addEventListener("click", () => {
    renderCraft();
    openOverlay("overlay-craft");
  });
  document.getElementById("btn-close-craft").addEventListener("click", closeOverlays);
  const btnBuild = document.getElementById("btn-build");
  if (btnBuild) btnBuild.addEventListener("click", () => { renderBuild(); openOverlay("overlay-build"); });
  const btnCloseBuild = document.getElementById("btn-close-build");
  if (btnCloseBuild) btnCloseBuild.addEventListener("click", closeOverlays);
  document.getElementById("btn-menu").addEventListener("click", () => openOverlay("overlay-menu"));
  document.getElementById("btn-resume").addEventListener("click", closeOverlays);
  document.getElementById("btn-save").addEventListener("click", () => { saveGame(); });
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!confirm("Delete your Ashen Vale save on this device?")) return;
    resetSave();
    closeOverlays();
    showTitle();
    toast("Save deleted");
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 100));

  // Expose for Node tests (optional)
  window.AshenVale = {
    state,
    ITEM_DEFS,
    RECIPES,
    FORTIFY,
    BUILDING_TYPES,
    invAdd,
    invRemove,
    invCount,
    xpToNext,
    gainXp,
    createPlayer,
    generateWorld,
    weaponDmg,
    serialize,
    clientToWorld,
    migrateSkills,
    pointInBuilding,
    defaultBase,
    claimBuilding,
    setBuildingType,
    doFortify,
    SAVE_KEY,
    SAVE_KEY_LEGACY,
    WORLD_W,
    WORLD_H,
    SKILL_NAMES,
  };

  resize();
  showTitle();
  requestAnimationFrame(frame);
})();
