# Ashen Vale

Solo mobile-first survival with skill grinding, bases, and enterable buildings.  
Original canvas art/code — not affiliated with Jagex or The Indie Stone.

**Play:** [https://kealonb.github.io/ashen-vale/](https://kealonb.github.io/ashen-vale/)

## What’s in now (Phases 1–2)

- Tap + long-press actions; fixed mobile touch mapping
- Skills: Attack, Ranged, Woodcutting, Mining, Fishing, Cooking, Crafting, Smithing, Construction, Fitness
- Craft / Smith / Build / Equip panel with material feedback
- Enterable interiors, claim & fortify, place furniture (bed, forge, bank chest, …)
- Shared **bank** (survives death) + **Mira the Trader** shop (coins)
- Creatures: zombies, rats, goblins, squirrels, chickens

## Files

`index.html` · `style.css` · `data.js` · `game.js` · `.nojekyll` · `test-core.mjs`

Save key: `ashenvale_save_v4` (migrates older saves). Prefer **New Game** after major updates.

## Roadmap

| Phase | Focus |
|-------|--------|
| **3** | Zombie variety, horde nights, infection risk |
| **4** | Quests, NPC survivors, sound |
| **5** | Graphics rework — near third-person / side-angle camera, multiple monster/NPC variants, outfits that change the player sprite |

### Phase 5 (graphics) direction

Prefer **2.5D billboard sprites or low-poly Three.js** with a locked chase/orbit camera (slightly elevated, behind-side) rather than full free third-person. On phones, keep draw distance short, atlas sprites or very low poly, and one shadow/light budget; avoid heavy post-processing. Outfit swaps = texture/mesh swaps on the player rig; monster variants = palette + mesh/sprite variants sharing AI.

## Local

Open `index.html`. Tests: `node test-core.mjs`
