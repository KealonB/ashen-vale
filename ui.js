/**
 * Ashen Vale UI + boot (split for GitHub Pages size limits)
 */
(function () {
  "use strict";
  const A = window.__AV;
  if (!A) { console.error("Ashen Vale engine missing"); return; }
  const {
    state, ITEM_DEFS, RECIPES, FORTIFY, BUILDING_TYPES, FURNITURE_DEFS, SHOP_STOCK_DEFAULT,
    SKILL_LABELS, EQUIP_SLOTS, MAX_INV,
    clamp, timeLabel, pointInBuilding,
    invAdd, invRemove, invCount, canAfford, payNeed, gainXp,
    armorTotal, recipeBlocked, doCraft, placeFurnitureAt,
    bankDeposit, bankWithdraw, shopBuy, shopSell, getCoins, setCoins,
    claimBuilding, setBuildingType, doFortify, playerBuilding, getBuildingById,
    hasWorkshop, hasKitchen, hasForgeAccess, hasAnvilAccess, getSafehouse, getStorageBuilding,
    syncWeaponAlias, hideContextMenu, toast, saveGame, loadGame, hasSave, resetSave, startNewGame,
    update, render, resize, canvas, enterBuilding, exitBuilding, backupCorruptSave,
  } = A;

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
  function showBootError(err) {
    try {
      const el = document.getElementById("boot-error");
      if (!el) { console.error(err); return; }
      const msg = (err && err.message) ? err.message : String(err || "Unknown error");
      el.hidden = false;
      el.textContent = "Ashen Vale hit an error: " + msg + " — Try New Game, or clear site data if it keeps failing.";
      console.error(err);
    } catch (e) { console.error(err); }
  }
  function showSaveNotice() {
    if (!state._saveNotice) return;
    const msg = state._saveNotice;
    state._saveNotice = "";
    toast(msg, "bad");
    try {
      const el = document.getElementById("boot-error");
      if (el) { el.hidden = false; el.textContent = msg; setTimeout(() => { el.hidden = true; }, 8000); }
    } catch (e) {}
  }

  let last = performance.now();
  function frame(now) {
    try {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      render();
    } catch (err) {
      showBootError(err);
    }
    requestAnimationFrame(frame);
  }

  function showTitle() {
    document.getElementById("title-screen").classList.remove("hidden");
    document.getElementById("btn-continue").disabled = !hasSave();
    state.running = false;
  }
  function hideTitle() { document.getElementById("title-screen").classList.add("hidden"); }

  function beginPlay(fromSave) {
    try {
      hideTitle(); closeOverlays(); hideContextMenu();
      if (fromSave) {
        if (!loadGame()) {
          showSaveNotice();
          startNewGame();
        } else {
          state.running = true; state.paused = false; toast("Welcome back", "sys");
        }
      } else startNewGame();
      updateHud();
      showSaveNotice();
      if (!state.tutorialShown) {
        state.tutorialShown = true;
        setTimeout(() => openOverlay("overlay-help"), 400);
        saveGame(true);
      }
    } catch (err) {
      showBootError(err);
      try { showTitle(); } catch (e) {}
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


  A.openWorkshopImpl = openWorkshop;
  A.openBankImpl = openBank;
  A.openShopImpl = openShop;
  A.renderWorkshopImpl = renderWorkshop;
  A.renderInventoryImpl = renderInventory;
  A.updateHudImpl = updateHud;
  A.openOverlayImpl = openOverlay;
  A.closeOverlaysImpl = closeOverlays;

  window.AshenVale = Object.assign(A, {
    openWorkshop, openBank, openShop, renderWorkshop, beginPlay, showTitle,
    updateHud, openOverlay, closeOverlays,
  });

  try {
    resize();
    showTitle();
    requestAnimationFrame(frame);
  } catch (err) {
    showBootError(err);
  }
})();
