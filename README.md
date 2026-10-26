# Little Ages

A pixel-art civilization sim where nothing is scripted. Every person has their own needs, personality, family, memories and knowledge, and acts for themselves. Tribes, leaders, kingdoms, revolts, trade, religions, wars and inventions only happen because people decided they were worth doing. Worlds run from the Stone Age toward the Space Age on huge procedural maps with a real underground.

- **Plan:** [`docs/PLAN.md`](docs/PLAN.md)
- **Style board:** [`style-board/`](style-board/), a live pixel-art board used to choose the game's look. It's also published as an artifact for picking styles.

## Status

Milestone 1, "A living world", is being built in three checkpoints:

- **A. The world** (done). Plate-tectonic continents, mountain ranges, wind-driven rain and rain shadows, rivers and lakes, Whittaker biomes, 21 tree species that change with the seasons, and living wildlife. Herds, packs, bears, birds, rabbits and fish breed, starve, migrate and hunt, all balanced by what the land can feed.
- **B. The people** (this branch). Every person is a real individual:
  - **Genes.** A diploid genome of real loci for skin, hair color and curl, red hair and blue eyes (recessive), height, build, beards, baldness, graying and temperament. Founders get ancestries that fit the sun and cold where they live. Children inherit one copy of each gene from each parent, with the odd mutation, so families look alike and mixed couples have children in between.
  - **Minds.** Needs (food, water, rest, warmth, company, safety, health), mood, eight heritable temperament traits, skills, knowledge (fire, snares, fishing, hides, spears), memories, and opinions of everyone they know. Each person keeps their own mental map of places (berry patches, fishing spots, game, water, other camps) and learns more by exploring and by talk.
  - **A utility AI with a "why?".** Everyone weighs what matters most right now, makes a step-by-step plan, and can always tell you why in plain words ("Gathering berries at the patch west of camp; the band only has food for two days and she has three children to feed").
  - **Bands.** Shared food stores, the fire, households and shelters in each culture's style, sharing norms, a respected elder. Bands move camp when the land runs out, split when they grow too big, take in families from kin bands, and meet strangers. Peoples have their own languages, names, clothing, dyes, hairstyles and marriage customs.
  - **The life cycle.** Courtship and couples (never close kin), pregnancy and nursing, babies carried, toddlers, children who play and learn skills by watching their parents, teens, adults, elders, illness, injuries, hunting accidents, animal attacks, hunger, grief and fostering orphans.
  - **On screen.** Hand-drawn pixel people with their genes' colors and their culture's clothes, 24 animations, thought bubbles, camps with fires and shelters, band labels, a pinned tag for anyone you click (with their why, needs, family, friends, rivals and memories) and a news feed.
- **C. The interface.** The history ribbon, the journal, search and Spotlight.

## Run it

```sh
npm install
npm run dev        # play at http://localhost:5173
npm run build      # one self-contained file: dist/index.html
npm run page       # the publishable single page: dist/little-ages.html
npm test           # world, wildlife, genetics and people tests
npm run sim -- --size medium --seed 7 --years 20 --bands 12   # watch people live, headless
npm run sim -- --size medium --seed 7 --years 10 --wild       # just the wildlife
```

The headless run prints the population, births, deaths and their causes, couples, camp moves, band splits, kills by species and food brought in, season by season. `--start cradle` begins with one people in one warm homeland instead of peoples scattered across the world.

`scripts/worldpng.ts` writes PNGs of a world for every season and map mode (`node --experimental-strip-types scripts/worldpng.ts large 12 /tmp/world`).

## Layout

- `src/sim/` runs in a Web Worker and owns the world. It holds world generation (`world/`), wildlife (`wildlife.ts`), plants, pasture, small game and fish (`ecology.ts`), birds (`birds.ts`), the people (`people/`) and the tick loop (`worker.ts`).
- `src/sim/people/`: `genetics.ts` (genome, inheritance, looks), `language.ts` (sound systems and names), `culture.ts` (clothing, hair, shelters, customs), `person.ts` (what a person is), `mind.ts` (choosing goals and plans, and the words for why), `doing.ts` (carrying out each step), `walk.ts` (pathfinding by season), `band.ts` (stores and choosing camps), `society.ts` (founding, the life cycle, bands and news) and `inspect.ts` (describing anyone in words).
- `src/render/` draws it on a canvas. `renderer.ts` handles the map, chunks and clouds; `ground.ts` makes smooth close-up coasts and surf; `life.ts` draws birds, rabbits and fish; `people.ts` draws people, camps, bubbles and labels; `sprites/` holds the pixel art. `dev/sprites.html` shows every person sprite and animation (`npm run dev`, then open `/dev/sprites.html`).
- `src/ui/` has the world-creation screen, the heads-up display, the pinned tag, the bands list and the news feed (`people.ts`).
- `src/shared/` holds randomness, noise, the palette, types and worker messages.

Nothing in the simulation is triggered by a date or a script. Everything comes from the land, the weather, and what animals and people decide to do. A test checks the people code for date triggers.
