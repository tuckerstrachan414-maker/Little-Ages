# Little Ages

A pixel-art civilization sim where nothing is scripted. Every person has their own needs, personality, family, memories and knowledge, and acts for themselves. Tribes, leaders, kingdoms, revolts, trade, religions, wars and inventions only happen because people decided they were worth doing. Worlds run from the Stone Age toward the Space Age on huge procedural maps with a real underground.

- **Plan:** [`docs/PLAN.md`](docs/PLAN.md)
- **Style board:** [`style-board/`](style-board/), a live pixel-art board used to choose the game's look. It's also published as an artifact for picking styles.

## Status

Milestone 1, "A living world", is finished, in three checkpoints:

- **A. The world** (done). Plate-tectonic continents, mountain ranges, wind-driven rain and rain shadows, rivers and lakes, Whittaker biomes, 21 tree species that change with the seasons, and living wildlife. Herds, packs, bears, birds, rabbits and fish breed, starve, migrate and hunt, all balanced by what the land can feed.
- **B. The people** (done). Every person is a real individual:
  - **Genes.** A diploid genome of real loci for skin, hair color and curl, red hair and blue eyes (recessive), height, build, beards, baldness, graying and temperament. Founders get ancestries that fit the sun and cold where they live. Children inherit one copy of each gene from each parent, with the odd mutation, so families look alike and mixed couples have children in between.
  - **Minds.** Needs (food, water, rest, warmth, company, safety, health), mood, eight heritable temperament traits, skills, knowledge (fire, snares, fishing, hides, spears), memories, and opinions of everyone they know. Each person keeps their own mental map of places (berry patches, fishing spots, game, water, other camps) and learns more by exploring and by talk.
  - **A utility AI with a "why?".** Everyone weighs what matters most right now, makes a step-by-step plan, and can always tell you why in plain words ("Gathering berries at the patch west of camp; the band only has food for two days and she has three children to feed").
  - **Bands.** Shared food stores, the fire, households and shelters in each culture's style, sharing norms, a respected elder. Bands move camp when the land runs out, split when they grow too big, take in families from kin bands, and meet strangers. Peoples have their own languages, names, clothing, dyes, hairstyles and marriage customs.
  - **The life cycle.** Courtship and couples (never close kin), pregnancy and nursing, babies carried, toddlers, children who play and learn skills by watching their parents, teens, adults, elders, illness, injuries, hunting accidents, animal attacks, hunger, grief and fostering orphans.
  - **On screen.** Hand-drawn pixel people with their genes' colors and their culture's clothes, 24 animations, thought bubbles, camps with fires and shelters, band labels, a pinned tag for anyone you click (with their why, needs, family, friends, rivals and memories) and a news feed.
- **C. The interface** (done). Everything that has happened can be found, replayed and followed:
  - **Every event is weighed.** The simulation gives each event a weight from 0 to 1 and a headline, from what it was (a band ending outweighs a birth), who it happened to (the death of the one a band listens to counts for more) and how rare it is in this world so far (the first meeting of two peoples, the first mammoth). Nothing is scripted; the weight only describes what people did.
  - **The history ribbon** along the bottom. Seasons run along its foot, the head count rises and falls above them, and every notable moment stands as a banner, a little speech bubble of what it was about. Heavier events are bigger, and zooming in shows the smaller ones between. Hover a banner to read it, click it to fly there and pin the people in it, or drag along the ribbon to scrub through the past: the camera hops to where each thing happened, and letting go settles on the last one. The wheel zooms, shift-drag slides, YEAR / 5Y / ALL set how much shows, the arrows step between notable moments, and NOW brings you back to the present.
  - **The journal.** Every event, newest first, under the year and season. Filter by kind, by a few words, or to the notable. Open it on one person's or one band's own story from their tag, or on someone who has died from search.
  - **Search.** Press `/` (or `Ctrl+K`) and type any part of a name: the living, the dead (found where they died, with how), bands, the camps they sit in, whole peoples, and moments in history. With nothing typed it offers the people each band listens to.
  - **Story Spotlight.** Switch it on (`L`) and the camera goes looking for the story: it flies to the most worthwhile thing that has happened lately, pins and follows the people in it, slows the clock a little for the biggest moments, and when nothing is happening follows an ordinary person through their day. Pan, zoom or click and it waits for you.
  - **Bonds.** Switch on BONDS (`B`) and every couple, family tie, friendship and rivalry in view is a thread on the map: rose, green, blue and dashed red. They follow people as they walk. Kin of a pinned person who are out of view get an arrow at the screen's edge saying who and how far; press it to go there.

Milestone 2, "First villages", is under way, in three checkpoints:

- **A. Sharing, friends and feuds, and the first leaders** (this branch). Bands are no longer one shared larder, and nobody is made leader:
  - **Hearths and the pot.** Food brought back to camp is split between the band's pot, which anyone may eat from, and the household's own hearth. How much goes in the pot is up to whoever brought it, within their people's custom: meat from a big kill is nearly always shared (more so in the heat, when it would spoil), plant food mostly feeds the gatherer's family, the generous share more and the greedy less. People eat from their own hearth first, then the pot, then from close family's hearths without needing to ask.
  - **Asking and the evening round.** When the hearth and the pot are bare and the children are hungry, people walk over and ask a household that has food: kin first, then friends and those who owe them. Most people give, and hardly anyone turns away someone starving. Twice a day food also passes between hearths unasked, close kin first, evening things out so that a lean week means everyone going a little hungry rather than a few starving. Food given is remembered as a debt and paid back from the next good haul. A full hearth that turns a hungry family away is remembered too, and the whole camp notices.
  - **Feuds.** Wrongs add up to a grudge that fades over weeks: being turned away hungry, losing a sweetheart to someone else, a partner leaving for another, being hurt on someone's hunt, a freeloader who never brings anything in, quarrels that keep coming back, a leader pushed aside. Enough of it, in someone stubborn and hot-tempered, hardens into a feud. Both families take sides and come to dislike each other, feuding people will not share or hunt together, and face to face by the fire they can come to blows. A respected go-between can talk each side round. A feud can drive a family out to another band, split a band in two, or pass to a grown child when one side dies, and children growing up take on their parents' grudges.
  - **Leaders.** Every adult goes along with somebody's word: a seasoned hunter, a wise elder, their own father, or their own judgment. Whoever most of the band listens to leads it, and wears a feather in their hair. Their wish to move camp carries the others, their call to hunt is answered, they are expected to share and they settle quarrels. They are replaced only by someone with a clearly bigger following, and when a second voice gathers nearly as many, the band can split along the line. Where people share freely, a proud hunter who carries in a big kill is told it is a bag of bones, so that nobody grows too big.
  - **Friends far away.** People walk over to visit kin and friends in other bands, bringing a gift (beads, ochre, a good blade), and come home with news of where the food is. Gifts are remembered and returned, and in hard times a family goes to live where it has friends.
  - **On screen.** The tag shows each person's hearth and the band's pot, whom they listen to and how many listen to them, how much they share, who owes whom, and every feud they are part of and why. The band card shows its leader and any second voice, every hearth's food, how much went into the pot yesterday, and the band's feuds. BONDS draws feuds as heavy dark red lines and a fine gold line from each adult to the one they listen to, so a leader sits in a star of gold. The journal has a new group, "Friends and feuds", and the ribbon and Spotlight pick up feuds, fights, peace, new leaders, two voices, gifts between peoples, and hunters taken down a peg.
- **B. The first discoveries** (next): knowledge that lives in people's heads, found by a curious person under pressure while doing related work, spread by teaching and watching, and lost when the last who knew it dies: making fire, stone tools, digging sticks and baskets, nets and weirs, drying meat, and the first planting.
- **C. First villages**: bands that can stay put stop moving, huts in each culture's style, stores and the first fields, and gatherings that stop dispersing.

### Keys

`/` search, `J` journal, `L` Spotlight, `N` next Spotlight story, `B` bonds, `,` and `.` previous and next notable moment, `H` hides the interface, `Space` pauses, `1`-`6` set the speed, `Esc` closes a panel or unpins.

## Run it

```sh
npm install
npm run dev        # play at http://localhost:5173
npm run build      # one self-contained file: dist/index.html
npm run page       # the publishable single page: dist/little-ages.html
npm test           # world, wildlife, genetics, people, sharing and feuds, and interface tests
npm run sim -- --size medium --seed 7 --years 20 --bands 12   # watch people live, headless
npm run sim -- --size medium --seed 7 --years 10 --wild       # just the wildlife
```

The headless run prints the population, births, deaths and their causes, couples, camp moves, band splits, kills by species and food brought in, season by season, and how food was shared, how many feuds began and ended, fights, new leaders, and gifts between bands. `--start cradle` begins with one people in one warm homeland instead of peoples scattered across the world.

`scripts/worldpng.ts` writes PNGs of a world for every season and map mode (`node --experimental-strip-types scripts/worldpng.ts large 12 /tmp/world`).

## Layout

- `src/sim/` runs in a Web Worker and owns the world. It holds world generation (`world/`), wildlife (`wildlife.ts`), plants, pasture, small game and fish (`ecology.ts`), birds (`birds.ts`), the people (`people/`) and the tick loop (`worker.ts`).
- `src/sim/people/`: `genetics.ts` (genome, inheritance, looks), `language.ts` (sound systems and names), `culture.ts` (clothing, hair, shelters, customs), `person.ts` (what a person is), `mind.ts` (choosing goals and plans, and the words for why), `doing.ts` (carrying out each step), `walk.ts` (pathfinding by season), `band.ts` (stores and choosing camps), `society.ts` (founding, the life cycle, bands and news) and `inspect.ts` (describing anyone in words).
- `src/render/` draws it on a canvas. `renderer.ts` handles the map, chunks and clouds; `depth.ts` paints trees, animals and people in order of the row they stand on, so creatures pass behind trees north of them and in front of trees south of them; `scale.ts` sets how small creatures are drawn; `ground.ts` makes smooth close-up coasts and surf; `life.ts` draws birds, rabbits and fish; `people.ts` draws people, camps, bubbles and labels; `sprites/` holds the pixel art. `dev/sprites.html` shows every person sprite and animation (`npm run dev`, then open `/dev/sprites.html`).
- `src/sim/people/chronicle.ts` weighs events; `search.ts` finds people, bands and peoples by name and works out the relationship threads in view.
- Milestone 2 checkpoint A added `sharing.ts` (hearths and the pot, asking, the sharing rounds, debts), `feuds.ts` (grudges, feuds and the sides families take, fights, go-betweens, feuds passed down), `leaders.ts` (whom each adult listens to, the band's leader and second voice, taking a proud hunter down a peg) and `friends.ts` (visits and gifts between bands).
- `src/ui/` has the world-creation screen, the heads-up display, the pinned tag, the bands list and the news feed (`people.ts`). `dock.ts` lays the panels out and slides them in and out: the toolbar toggles every panel, and H (or HIDE UI) hides the whole interface. Hiding a pinned tag leaves a name chip, and the follow carries on. Checkpoint C added `history.ts` (the log the page keeps of everything that happened), `timeline.ts` (the ribbon's arithmetic), `ribbon.ts`, `journal.ts`, `search.ts`, `spotlight.ts` with `director.ts` (what it chooses to look at) and `bonds.ts` (threads over the map).
- `src/shared/` holds randomness, noise, the palette, types and worker messages.

Nothing in the simulation is triggered by a date or a script. Everything comes from the land, the weather, and what animals and people decide to do. A test checks the people code for date triggers.
