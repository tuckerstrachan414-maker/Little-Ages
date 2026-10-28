# Little Ages: Plan

## Vision

Little Ages is a cozy pixel-art world you watch. Every person is a real individual with needs, a personality, a family, memories, friends, enemies and things they know how to do. Nothing is scripted. Villages, leaders, nations, religions, trade, revolts, wars and inventions happen only because people decided, for their own reasons, that they were worth doing.

The game has no end. There is no win or lose condition, and no path that the people are meant to follow. Societies grow, change, split, fall and rise again the way real human societies do. You can watch the big picture (whole societies changing over time) and zoom in on the lives of individuals acting on the world. Any moment in history can be revisited: if you read about an event, you can go back and watch it happen.

---

## What you decided

**Direction**
- Finish Milestone 2C (first villages) next, then keep the milestone order.
- The first moment that proves the game is fun: **a village forming**.
- **Infinite progression.** No win or lose condition. The people are not meant to follow a path; they evolve like real humans.
- **Single-player** only.
- **Built for the public.** Each public release has a polished first run.

**What you want to watch**
- The core focus is **societies growing and changing**, plus **individuals living their lives and acting on the world**.
- Rising conflict must be **readable**. You should be able to watch a war or a betrayal build.
- The main story is **the progression of society as a whole**.
- The History Book and the Story Spotlight are core features, but both are **hidden by default**. The auto-camera is **off by default**.
- **Rewind:** if you read an event in the History Book, you can go back and watch it happen.

**Your role**
- Mostly watching. You can **follow and inspect** a person, but you don't direct them.
- Big god powers exist **behind the sandbox toggle**. Small nudges (weather, sparks of ideas) are always available.
- **Saving:** autosave plus manual save slots.
- The world **pauses when the game is closed** and picks up exactly where it stopped.

**Look and feel**
- **Field Notes** palette. Dark outlines. Balanced proportions.
- **Lively** animation: squash, stretch and overshoot on most actions.
- The feel is **clear, readable stories**. Making the story easy to follow matters more than any particular cartoon style.

**Scale and pacing**
- **No cap and no minimum** on the number of people. The world produces as many people as it produces. There is no target population.
- **No default map size.** You choose the size each time you start a world.
- **A day lasts five minutes** at normal speed.
- Technology moves **slowly and feels real**.
- **Civilizations can die out completely.**

**Realism and tone**
- Violence is **visible but gentle**: fights and deaths appear on screen, non-graphically.
- **Religion, crime, oppression and plagues are on by default**, with no controls to turn them off.
- History is **free to diverge**. No bronze age or other stage is guaranteed to happen.
- **Invented worlds only.** No real-Earth mode.

**People and culture**
- The "why?" line has **adjustable detail**: short by default, longer when you want it.
- Invented names are **deliberately foreign**. You decode them through the journal.
- A **language tree and culture map** exist as a map mode.
- Map modes include **trade routes**.
- A **tutorial comes later.**

**Ideas**
- In: news spreading at walking speed, grudges that last across generations, ruins and rediscovery, place names with history.
- Later: art that reflects real events, and era-shifting UI.

**Sound**
- **Ambient sound first** (birds, wind, rain, rivers, town noise). Music comes later.

**Device**
- Played on a **laptop trackpad**. Touch and phone support aren't needed.

---

## Where we are

- **Done:** the repo, style board rounds 1 and 2, and Milestone 1 (the living valley) in full: the world, the people, and the interface.
- **Done:** Milestone 2 checkpoints A (sharing, friends, feuds and the first leaders) and B (the first discoveries).
- **Next:** Milestone 2 checkpoint C, first villages.
- **Planned:** Milestone 2 checkpoint D, watch and rewind (see below).

How to check checkpoint 2B for yourself: start a world, run it at 100x for two or three minutes, and press `I`. The IDEAS card lists what has been worked out so far, by whom and when. Click a camp to see who knows what.

How to check checkpoint 2A for yourself: start a world, run it at 100x for a minute or two, then click a camp. The band card says who leads. Open the journal on "Friends and feuds" and click a feud to fly there.

How to check Milestone 1 for yourself: zoom into a camp and click anyone. Their tag says what they're doing and why, how they feel, who their family is, and what they remember.

### Known gaps in the current build (to fix as part of the plan)

- **The ribbon scrub only moves the clock.** It sets the displayed time, but the people and the world don't go back. Rewind (below) replaces this.
- **The simulation depends on speed.** Each tick is split into steps that depend on the speed setting, so the same seed can give different results at different speeds. Replays need a fixed step (see Build notes).
- **The day length is 60 seconds** in the code. The new target is 300 seconds (five minutes), a five-fold change.

---

## The game

### Overall
The world is generated from a seed and runs forever. Peoples and their cultures form, grow, fight, split, trade and fade. The history builds itself and can be revisited. There is no ending screen. Starting in the Stone Age, people discover things one at a time, and those discoveries spread or get lost through teaching, trade, travel, conquest and war. The space age is content the world can reach, not a finish line.

### Your role
You watch. You can follow any person, read their mind, read the history, and rewind to any moment the world has kept. Your nudges (rain, drought, a blessed harvest, a spark of an idea in a curious person's head) ripple out in ways nobody can predict, including you. Strong powers (earthquakes, plagues, meteors, terraforming, spawning people) are behind the sandbox toggle.

### The people
Every person has needs (food, water, rest, warmth, health, safety, love, belonging, respect, freedom, purpose and curiosity), and how much each one matters is different for every person. They have a personality: how brave, kind, greedy, ambitious, curious, loyal, stubborn or religious they are. It is partly inherited and partly shaped by what happens to them. They remember who helped them, who cheated them and where the berries were last spring, and their opinions shift with those memories.

Every moment, a person weighs what they could do against what they want, what they believe will work and what it will cost them, then makes a real multi-step plan. They only know what they've seen or been told, so they can be wrong, fooled by rumors, or surprised.

### Society and power
Nobody is told to form a village. People team up because they notice that sharing hunts, defending each other and splitting work makes their lives easier. Leaders appear when someone earns enough respect, fear or followers. Rules (sharing food, paying tribute, punishing thieves, who becomes chief next) are ideas people suggest, argue about and either adopt or reject.

When things feel unfair (a chief hoards grain, taxes crush, one group is oppressed), people grumble, gossip and form factions. From there each person chooses for themselves: put up with it, go live alone in the woods, found a new village, riot, overthrow the leader, or break away. Bands, chiefdoms, kingdoms, republics and empires are labels the game puts on what people actually built. They can collapse, and a people can vanish entirely if nobody carries them on.

### Family, life and genetics
People are born, grow up, fall in love (or marry for land and alliances), have children, grow old and die. You can read their age at a glance: babies are carried, kids play, teens are lanky, adults work, elders go gray and use canes.

Looks come from real genetics. Skin tone, hair color and curl, eye color, height and build are inherited from both parents, so a child of a dark-skinned and a light-skinned parent lands in between, and siblings each turn out a little different. Each world starts with ancestries that fit where people begin. Family trees, dynasties, feuds and inheritance grow out of this, so you can trace a peasant girl's line until her great-great-grandson becomes king.

### Cultures and languages
Every group develops its own culture: values (honor, freedom, tradition, faith, family), building style, clothing, food, festivals and customs. These pass from parents to children and slowly drift.

Each culture has its own invented language, and every name comes from it: people, places, rivers, kingdoms. Names are deliberately foreign, so the journal helps you decode them. When a group splits off, its language and customs drift into a dialect and eventually a new language. Trade spreads borrowed words and ideas. Cultures that meet can blend, clash, or one can absorb the other. A language tree and a culture map show who split from whom.

### The world
Every world is generated from a seed, with continents and oceans (or a shape you pick: supercontinent, archipelago or random), mountains, rivers, lakes, forests, deserts, tundra, jungles, grasslands and coasts. Climate comes from latitude, altitude, wind and rain shadows. There are full seasons: snow piles up in winter, crops fail in droughts, rivers flood and leaves turn in autumn.

Animals live real lives. Herds migrate, breed and can be hunted to extinction, which can push people to move, farm or tame animals instead. Where people live shapes them: snowy peoples need warm clothes and food storage, river peoples fish and build boats, desert peoples chase water.

### Underground
The world has real depth: soil, rock layers, ore veins, caves and underground water. People dig cellars, wells, mines and tunnels, and later sewers, subways and bunkers, but only when they have a reason and the know-how. The layer view flips the top-down camera between depths (Surface, Shallow, Deep, Caverns). The cross-section tool lets you drag a cut line and see a side slice of that spot. Mining is dangerous: cave-ins, flooding and bad air push people to invent supports, pumps and ventilation.

### Progress and technology
There is no tech tree to click through. Discoveries happen inside people's heads, when a curious person doing a related activity is under pressure to solve a problem: a hunter knapping flint, a freezing family experimenting with hides, a dead fire, a broken spear. Discoveries are slow and feel real.

Knowledge spreads through teaching, watching, trade, travel, conquest and later books and schools, so nations get good at different things and swap ideas along trade routes. It can be lost: if the only smith dies without an apprentice, or a library burns, that skill can vanish. Every craft keeps improving slowly, so progress never hits a ceiling.

### Economy, trade and logistics
Everything is physical. Food is grown, carried, stored and eaten, and can spoil or be stolen. People start by sharing and bartering. Money appears on its own when one good (shells, copper, salt) becomes something everyone accepts. Each town has its own prices based on what's plentiful and scarce, so merchants appear because they profit from moving grain from a full town to a hungry one. Goods move on backs, then by pack animal, cart, boat, ship, train, truck and plane. Fights over food, water, land and trade routes grow from neighbor arguments into town rivalries and full wars.

### Story and history
The game watches everything and writes a History Book as it goes: eras, nation histories, biographies of notable people, wars, discoveries and disasters. Storylines are tracked automatically, so you can follow the big arc of society (a nation's rise and fall) and the small ones (two brothers feuding over a field). The Story Spotlight can fly to real moments, but it is off by default, and the History Book and Spotlight are hidden until you open them. None of it is scripted: the game only finds the drama and tells it.

Religions, myths, crime, plagues and oppression emerge, and so do heroes, reformers, rebels and abolitionists.

### Watch and rewind (new)
This is the feature that makes history explorable. You can go back to any moment the world has kept and watch it again.

- **Going back.** Drag the ribbon to any moment, or press **Watch** on any event in the History Book. The game loads the nearest saved moment before it and replays quietly up to just before the event. Then it plays the event at the speed you choose, with the camera following it.
- **The watch bar.** While watching, a bar shows what you're watching ("Spring, day 4, year 3: raid at Ama's Ford"), with play, pause, speed, and **Back to now**.
- **The same events every time.** The simulation is deterministic, so a replay matches the first run exactly: the same people, the same choices, the same History Book entries.
- **Changing the past.** If you nudge the world while looking at a past moment, that starts a new future from there. The game asks you to confirm first, and the old future is replaced.
- **Keyframes.** A keyframe is a saved copy of the whole world at one moment. The game keeps one per season, plus one at each save, in IndexedDB. Old keyframes thin out over time (every season for recent years, then yearly, then every decade), so a world that has run for ages stays light. A replay from a thinned keyframe takes longer, but it runs faster than real time.
- **Desync check.** Each keyframe stores a checksum of the simulation. A replay that doesn't match the checksum is flagged on screen. This catches bugs that would silently rewrite history.
- **Thinned events come back.** The History Book lets go of old minor events to stay light. Replay regenerates them, so an event dropped from the book can still be watched.
- **Society overview.** A card that shows the big picture for each people: population, number of villages or bands, known discoveries, leaders and cultural drift, as lines over time. You can scrub it with the ribbon.

### Art style and animation
A top-down 3/4 view, like Stardew Valley or RimWorld. Small, cute 8×16 people who are still easy to read: man or woman, child, teen or elder, skin tone, hair, beards, clothing and what they're carrying. People and buildings are built from parts, so no two people look the same. Houses vary by wealth, age, repair and owner, and each culture keeps a recognizable style (round huts, longhouses, stilt houses).

Every action has its own animation: walking, running, carrying, chopping, mining, plowing, sowing, harvesting, fishing, hunting, cooking, eating, building, sleeping, praying, dancing and fighting. Talking shows gestures plus tiny picture bubbles (a fish, a heart, an angry scribble, a crown). Emotions show in posture. Babies get carried, elders walk slowly, the injured limp and the sick lie in bed.

The world's look changes with the world's state. Day and night, weather, seasons, torches and glowing windows make it feel alive. Whether the art gets darker as conflict rises, or stays cute throughout, is still open; see Honest notes.

### Sound
Ambient sound comes first: birds and wind in the wild, hammering and chatter in towns, rain, rivers and storms. Ambient sound follows where you're looking. Music comes later, generated and mood-driven: calm in peacetime, tense in war, grand when a city booms. People babble in tiny voices built from the sounds of their own invented language, so two cultures sound different. Everything can be mixed or muted.

### User interface
The world fills the whole screen, with small cards in the corners: date and speed top-left, search and menu top-right, a short news feed bottom-left, and an inspect card that slides in when you click anything. The inspect card shows who someone is, how they feel and what they're doing, plus the plain-English "why?" line. Another click opens their family tree, memories, friends, enemies, beliefs and skills.

Search finds any person, town, nation, river or invention instantly. Map modes color the world by nation, culture, religion, language, wealth, happiness, or trade routes. Everything works on a laptop trackpad: two-finger pan, pinch to zoom, click-and-drag, with keyboard shortcuts as a backup. The History Book, Spotlight, Society overview and watch bar stay hidden until you open them.

### Pacing and time
At normal speed a day takes **five minutes**. A year is four seasons of ten days each, so at normal speed a year takes about three hours and twenty minutes. Speed controls run from paused up to fast-forward. Fast-forward is what lets you see a generation pass. Because a year is long at 1x, the speed controls and watch-and-rewind carry most of the time-travel.

Progress isn't on a timer. A world hit by plagues, wars or harsh climate can stall for centuries, and a lucky one can surge ahead. Worlds autosave, and a closed world pauses and resumes from exactly where it stopped.

### Realism and tone
Religion, crime, oppression, plagues, war, betrayal and collapse are all on by default. Violence is visible but gentle. Nothing is scripted to happen. Civilizations can die out. Nothing guarantees that any one people will survive.

---

## Ideas

**In the game**
- **News at real speed.** Rumors and news spread person to person at walking pace, then faster as travel and writing arrive. Rumors can be wrong or deliberately spread.
- **Grudges across generations.** Families remember who betrayed whom, and old feuds can restart wars decades later.
- **Ruins and rediscovery.** Abandoned villages decay into ruins that later peoples find and wonder about. Lost knowledge can be rediscovered from them.
- **Place names with history.** Villages and towns get named after founders or events ("Ama's Ford", "Burnt Hill"), in that culture's own language.

**Later**
- **Art reflects real events.** Cave paintings, statues and songs depict things that really happened to those people (a great hunt, a hero, a flood).
- **Era-shifting UI.** The interface's materials change with each era: carved stone, bronze, parchment, riveted brass, glass screens, holo panels. The layout never moves.

---

## Milestones

Each milestone is complete before the next starts. Each one gets a playable public build, with a polished first run.

1. **A living valley** (done). World generation, people with needs, personality, memory and genetics, gathering, hunting, fishing, families, births and deaths, the inspect card with "why?", the history ribbon, the journal, search, the Story Spotlight and relationship threads.
2. **First villages** (in progress).
   - **A. Sharing, friends and feuds, and the first leaders** (done).
   - **B. The first discoveries** (done).
   - **C. First villages** (next). Bands that can stay put stop moving. Huts in each culture's style, stores and the first fields, seasonal gatherings that stop dispersing. A village is named after its founder or an event.
   - **D. Watch and rewind** (planned). Rewind to any kept moment, watch any event from the History Book, the watch bar, the Society overview, keyframes and the desync check. See "Watch and rewind" above.
3. **Chiefs and quarrels**. Rules and norms, factions, leaving, revolts, secession, raids, war, religion, crime, news at walking speed, and generational grudges.
4. **Roads and trade**. Barter, then money, then markets, merchants, logistics, disease, writing, knowledge spreading and being lost, languages drifting, and the language tree and culture map.
5. **Underground and the big world**. Mining, the layer and cross-section views, full continents, ships, first contact, map modes, and ruins and rediscovery.
6. **The ages roll on**. Bronze, iron, medieval, industrial and modern eras (bridges, ships, electricity, cars, planes, skyscrapers, subways), with music.
7. **Later expansion**. The space age, with rockets to other planets. This is more world to discover, not an ending.

**Later**: art reflects real events and era-shifting UI (see Ideas).

**Public release**: the first public release is when a checkpoint is polished, and the tutorial and first-run tips come with it. Timing is open; see Honest notes.

---

## Honest notes

- **No population target.** The game has no cap and no minimum. Performance is the limit, not design. The benchmark reports frame time and simulation ticks per second at the populations a world actually reaches.
- **Played on a laptop trackpad.** Performance has to be good on an ordinary laptop, not only a strong PC.
- **Infinite progression means no endings.** Worlds are measured by how well they keep living and changing, not by reaching a finish.
- **Day length is five minutes**, so the speed controls and watch-and-rewind are the main ways to move through time.
- **Art and era UI are later**, per your answer. Milestone 6 no longer includes era-shifting UI.

**Decisions I made that you should confirm:**
- **Watch and rewind sits in Milestone 2 as checkpoint D**, right after first villages. It needs the fixed-step simulation and save format, and each later milestone builds on them.
- **Rewinding and then nudging replaces the old future**, after a confirmation. The alternative is keeping old futures as branches, which is more complex.
- **Ambient sound is not yet placed in a milestone.** I suggest it comes after Milestone 2, before Milestone 3.
- **First public release timing is open.** I suggest after Milestone 2, so people can see villages form.
- **Whether art gets darker as conflict rises** wasn't asked in the interview. It's still open.

---

## Build notes (for me; you can skip this)

**Stack:** TypeScript + Vite. Canvas 2D with cached chunk and sprite canvases for rendering. The simulation runs in a Web Worker. The UI is a DOM/CSS overlay. WebAudio for sound. IndexedDB + fflate for saves and keyframes. Vitest for tests. Playwright (Chromium is preinstalled) for screenshots. Seeded deterministic RNG throughout.

**Project layout (current):**
- `src/sim/`: `world/` (generation, elevation, climate, hydrology, biomes, bake), `people/` (society, minds, bands, leaders, feuds, friends, ideas, language, genetics, walking, search, inspect), `wildlife.ts`, `birds.ts`, `ecology.ts`, `settle.ts`, `worker.ts` (the simulation thread).
- `src/render/`: camera, renderer, ground, depth, life, people and sprite generation.
- `src/ui/`: corner cards, history ribbon, timeline, journal, search, spotlight, ideas, bonds, dock, HUD.
- `src/shared/`: types, protocol (page ↔ worker messages), RNG, noise, palette, season effects.
- `tests/`, `scripts/` (headless simulation harness, page and world tools), `dev/`, `style-board/`, `docs/`.

**Simulation rules (new, required for watch and rewind):**
- **Fixed step.** The simulation advances in fixed sub-steps no matter what speed is set. Speed only changes how many fixed steps run per real second. Today the step size depends on speed, which breaks determinism; this must be fixed first.
- **Everything is saveable.** Every system's state must be serializable into a keyframe. A system is not finished until it's in the save format and its tests cover a save and a reload.
- **Inputs are logged.** Every nudge and every setting that changes the simulation is recorded with its simulation time, so a replay can reproduce it.
- **No hidden randomness.** No `Math.random`, no reading the clock, and no iteration order that depends on the environment inside the simulation. The UI may use the clock for throttling, since that does not change the simulation.
- **Checksums.** Keyframes store a checksum of the simulation state. Replays check against it.

**Rules still in force:**
- **No-hard-coding rule.** No event is ever triggered by date, script or quota. Everything comes from agent decisions, physics, ecology or player nudges. Eras and UI changes come from what exists in the world, never from the date.
- **Infinite progression.** No win or lose state, no ending screen, no event that closes the game.
- **Determinism.** Seeded RNG everywhere. The same seed gives the same history.

**Art rules** (from the style board research; every sprite follows them):
- **Hand-drawn sprite templates.** Body bases are authored pixel by pixel for each age and sex, in tiny and 8×16 sizes, with color regions that genetics, culture and clothing recolor. Every sprite passes the "silhouette at 1×" and grayscale value checks.
- **Real color ramps.** Each material gets a 3–4 shade ramp that shifts hue: shadows lean cool, highlights lean warm. Light comes from the top-left.
- **Outlines.** A dark outer outline, selective darker lines on the shadow side, and lighter inner lines.
- **Animation that feels alive.** Walk: 4 frames at 100–150 ms with a 1 px body bob. Idle: 2–4 frames at 300–500 ms with breathing and blinks. Work actions: an anticipation frame, an impact frame held 150–200 ms, then recovery. Throughout: varied frame timing, motions overshoot by about 30%, swings follow arcs, hair lags 1 px behind. Effects on top: dust, wood chips, splashes and sparks.
- **WorldBox-style terrain.** Clean biome color fields with tidy edge transitions. Water has a shallow band, depth shading and animated shoreline foam that doesn't pulse in unison. Every tree and unit casts a small ground shadow.

**Verification (every milestone):**
- Vitest: genetics inheritance stats, worldgen determinism and biome sanity, planner correctness, price convergence, tech prerequisites, and save-and-reload round trips.
- **Replay check (new):** replaying from a keyframe reproduces the original run exactly, checked by checksum, at several seeds and speeds.
- Headless harness `npm run sim -- --seed N --years Y` reports metrics across several seeds, showing that emergence happens and differs between seeds.
- Grep audit for date- or quota-triggered events.
- Playwright screenshots at every zoom level, surface, layer and cross-section view, and each era, at desktop and laptop widths.
- Performance benchmark: frame time and simulation ticks per second at the populations a world reaches, on a laptop-class machine.
- Publish a playable public build and push it to GitHub with each checkpoint.
