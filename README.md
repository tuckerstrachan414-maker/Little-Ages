# Little Ages

A pixel-art civilization sim where nothing is scripted. Every person has their own needs, personality, family, memories and knowledge, and acts for themselves. Tribes, leaders, kingdoms, revolts, trade, religions, wars and inventions only happen because people decided they were worth doing. Worlds run from the Stone Age toward the Space Age on huge procedural maps with a real underground.

- **Plan:** [`docs/PLAN.md`](docs/PLAN.md)
- **Style board:** [`style-board/`](style-board/), a live pixel-art board used to choose the game's look. It's also published as an artifact for picking styles.

## Status

Milestone 1, "A living world", is being built in three checkpoints:

- **A. The world** (this branch). Plate-tectonic continents, mountain ranges, wind-driven rain and rain shadows, rivers and lakes, Whittaker biomes, 21 tree species that change with the seasons, and living wildlife. Herds, packs, bears, birds, rabbits and fish breed, starve, migrate and hunt, all balanced by what the land can feed.
- **B. The people.** Genetics, minds, utility AI with a "why?", bands and the life cycle.
- **C. The interface.** Pinned tags, the history ribbon, the journal, search and Spotlight.

## Run it

```sh
npm install
npm run dev        # play at http://localhost:5173
npm run build      # one self-contained file: dist/index.html
npm test           # world generation and ecology tests
npm run sim -- --size medium --seed 7 --years 10   # watch the wild change, headless
```

`scripts/worldpng.ts` writes PNGs of a world for every season and map mode (`node --experimental-strip-types scripts/worldpng.ts large 12 /tmp/world`).

## Layout

- `src/sim/` runs in a Web Worker and owns the world. It holds world generation (`world/`), wildlife (`wildlife.ts`), pasture, small game and fish (`ecology.ts`), birds (`birds.ts`) and the tick loop (`worker.ts`).
- `src/render/` draws it on a canvas. `renderer.ts` handles the map, chunks and clouds; `ground.ts` makes smooth close-up coasts and surf; `life.ts` draws birds, rabbits and fish; `sprites/` holds the pixel art.
- `src/ui/` has the world-creation screen and the heads-up display.
- `src/shared/` holds randomness, noise, the palette, types and worker messages.

Nothing in the simulation is triggered by a date or a script. Everything comes from the land, the weather, and what animals (and later people) decide to do.
