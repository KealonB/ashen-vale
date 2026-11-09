# Ashen Vale

A **solo**, mobile-first zombie survival prototype in plain HTML/CSS/JavaScript.  
Inspired by the *feel* of classic skill grinding and Project Zomboid–style scavenging — original canvas art, title, and code (not affiliated with Jagex or The Indie Stone).

**Play online:** [https://kealonb.github.io/ashen-vale/](https://kealonb.github.io/ashen-vale/)

## Play locally

1. Open `index.html` in a modern mobile or desktop browser.
2. Tap **New Game**.
3. Tap ground to move (yellow ring = registered tap), tap zombies to attack, tap trees/bushes/crates to gather.
4. Open **Build** while standing inside a stone building to claim, designate type, and fortify.

## Features

- Top-down RSC-inspired original canvas art (chunky tiles, outlined sprites, stone/timber buildings)
- Tap-to-move / attack / gather with fixed mobile touch mapping + tap markers
- Health & hunger, day/night cycle
- Skills: Combat, Foraging, Crafting, Fitness, **Construction**
- **Base building inside existing buildings only**: claim → Safehouse / Workshop / Storage / Kitchen
- Fortify: board windows, reinforce doors, brace walls; zombies attack barricades
- Inventory, crafting (Workshop/Kitchen unlock advanced recipes), death drops gear (skills kept; Storage stash persists)
- `localStorage` save v2 (migrates old v1 skills gracefully)

## Files

| File | Role |
|------|------|
| `index.html` | Shell, HUD, overlays |
| `style.css` | Classic stone/wood UI |
| `game.js` | State, simulation, canvas render |
| `.nojekyll` | GitHub Pages serves files as-is |
| `test-core.mjs` | Headless unit tests |

No external dependencies, no build step. Cache-bust: `?v=2` on CSS/JS links.

## Deploy on GitHub Pages

Repo uses **Deploy from a branch**: `main` + `/` (root).  
Live: `https://kealonb.github.io/ashen-vale/`

## Reset / privacy

Progress is in this browser’s `localStorage` (`ashenvale_save_v2`).  
**Menu → Reset Save** clears it.

## License

Prototype for personal / demo use.
