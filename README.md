# Ashen Vale

A **solo**, mobile-first zombie survival prototype in plain HTML/CSS/JavaScript.  
Inspired by the *feel* of old-school skill grinding and Project Zomboid–style scavenging — but fully original art (canvas-drawn), title, and code.

**Play online:** [https://kealonb.github.io/ashen-vale/](https://kealonb.github.io/ashen-vale/)

## Play locally

1. Open `index.html` in a modern mobile or desktop browser  
   (or serve the folder: `npx serve .` / any static host).
2. Tap **New Game**.
3. Tap ground to move, tap zombies to attack, tap trees/bushes/crates to gather.

## Features (vertical slice)

- Top-down illustrated canvas world (buildings, trees, bushes, crates, scrap, campfire)
- Tap-to-move / tap-to-attack / tap-to-gather
- Health & hunger, day/night cycle
- Skills: **Combat**, **Foraging**, **Crafting**, **Fitness** (XP + levels)
- Inventory, equip weapons, eat/heal, craft recipes
- Death: **skills kept**, carried items drop as recoverable loot; respawn at campfire
- `localStorage` autosave + menu reset with confirmation
- In-game help / tutorial on first play
- Minimap + HUD tuned for phones

**Not included:** multiplayer (code separates state / update / render so it can grow later).

## Files

| File | Role |
|------|------|
| `index.html` | Shell, HUD, overlays |
| `style.css` | Mobile-first layout |
| `game.js` | Game state, simulation, canvas render |
| `README.md` | This file |
| `.nojekyll` | Lets GitHub Pages serve files as-is |

No external dependencies, no build step.

## Deploy on GitHub Pages

This repo is set up for **Deploy from a branch**: `main` + `/` (root).

To recreate elsewhere:

1. Put `index.html`, `style.css`, `game.js`, `README.md`, and `.nojekyll` at the repo root.
2. Push to `main`.
3. Enable Pages: repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / root**.  
   Or via API: `POST /repos/{owner}/{repo}/pages` with `source.branch=main` and `source.path=/`.
4. Open `https://<owner>.github.io/<repo>/` after the Pages build finishes.

## Reset / privacy

Progress is stored only in **this browser’s** `localStorage` under key `ashenvale_save_v1`.  
Use **Menu → Reset Save** to clear it.

## License

Prototype for personal / demo use. Not affiliated with Jagex or The Indie Stone.
