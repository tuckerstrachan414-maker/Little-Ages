import { Species } from "../../shared/types.ts";
import type { Society } from "./society.ts";
import { TECHS as IDEAS } from "../tech/tree.ts";
import { unpackHint } from "../tech/tree.ts";
import { MATS } from "../economy/goods.ts";

/*
  How much an event matters, and a headline for it. Nothing is scripted: weight comes from
  what happened (a band ending outweighs a baby), who it happened to (a death the whole band
  feels) and how rare it is in this world so far (the first meeting of two peoples, the first
  mammoth, the first time a band splits). The ribbon, the journal and the Spotlight all
  read this one number.
*/

export interface Weighed { sig: number; title: string; }

/** Plain weight and headline for each kind of event, before rarity and circumstance. */
const BASE: Record<string, [number, string]> = {
  birth: [0.14, "A birth"], death: [0.2, "A death"], couple: [0.3, "A new couple"], parted: [0.32, "A couple parts"],
  kill: [0.4, "A great hunt"], hurt: [0.28, "Hurt on a hunt"], attack: [0.4, "Attacked by wild animals"],
  contact: [0.45, "Neighbors meet"], move: [0.3, "A band moves camp"], split: [0.7, "A band splits"],
  leave: [0.28, "A family moves on"], merge: [0.55, "A band joins another"], "band-end": [0.95, "A band is no more"],
  leader: [0.42, "A new leader"], contest: [0.38, "Two voices"],
  refused: [0.2, "Food refused"], feud: [0.43, "Bad blood"], fight: [0.36, "A fight"], peace: [0.3, "Peace is made"],
  leftfor: [0.4, "Left for another"], mocked: [0.18, "Taken down a peg"], gift: [0.14, "A gift between bands"],
  discover: [0.36, "A discovery"], spread: [0.24, "Know-how spreads"], lost: [0.28, "Know-how lost"],
  fireout: [0.2, "The fire goes out"], ember: [0.28, "Fire fetched from neighbors"], weir: [0.28, "A fish weir"], sow: [0.28, "Seed in the ground"], harvest: [0.42, "A first harvest"],
  hut: [0.34, "A first hut"], pit: [0.3, "Food put by"], field: [0.3, "A field sown again"], seed: [0.36, "The grain grows tame"],
  gather: [0.48, "Bands gather"], disperse: [0.32, "A gathering breaks up"],
  village: [0.84, "A village is born"], villagegrow: [0.45, "A village grows"], abandon: [0.6, "A village abandoned"], return: [0.5, "Back to the old village"],
  drought: [0.4, "A dry year"], found: [0.3, "A deposit found"], exhausted: [0.38, "A deposit dug out"], regrown: [0.2, "The wood comes back"],
  pots: [0.3, "The first pots"], communal: [0.44, "The village builds"], chief: [0.5, "A chief"], tier: [0.5, "A settlement grows"], age: [0.7, "A new age"], well: [0.4, "A well"], granary: [0.34, "A granary"], kiln: [0.3, "A kiln"], pen: [0.3, "A pen"], upgrade: [0.3, "A house rebuilt"], built: [0.3, "Something new built"],
  kept: [0.22, "Young animals kept"], tamed: [0.5, "Animals tamed"], herd: [0.3, "A flock thinned"],
};
/** Every kind of event the simulation tells of. */
export const KINDS = Object.keys(BASE);
/** How much rarer-than-usual an event of this kind is allowed to count for. */
const RARITY = 0.3;

/**
  `hint` carries what only the caller knows: the animal for a hunt (a Species), 1 for strangers who speak
  another language or a move into unknown land, 2 for twins; 1 for a feud passed down, a fight where someone
  was hurt, peace made by a go-between, a family driven out by a feud, a split along a feud or a following,
  gifts between two peoples. For know-how, `hint` is 100 times a level plus the idea: a discovery first in the
  world (level 2) or first among a people (1); know-how crossing between peoples (1); lost to the world (1); see packHint.
*/
export function weigh(s: Society, kind: string, who: number[], band: number, hint: number): Weighed {
  const [base, name] = BASE[kind] ?? [0.2, "Something happened"];
  let sig = base, title = name;
  const n = s.seen.get(kind) ?? 0;
  s.seen.set(kind, n + 1);
  switch (kind) {
    case "birth":
      if (hint === 2) { sig += 0.12; title = "Twins are born"; }
      break;
    case "death": {
      const a = s.archive.get(who[0]);
      const b = s.bandById.get(band);
      if (a) {
        const age = (a.died - a.born) / 2400;
        if (b && b.respected === a.id) { sig += 0.38; title = "A leader is gone"; }
        else if (age < 2) { sig += 0.08; title = "A baby is lost"; }
        else if (age < 12) { sig += 0.1; title = "A child is lost"; }
        else if (age > 56) title = "An elder dies";
        if (a.children.length >= 3) sig += 0.08;
        if (a.cause === "childbirth") { sig += 0.1; title = "Lost in childbirth"; }
        else if (a.cause === "wolves" || a.cause === "a bear" || a.cause.startsWith("hunting")) sig += 0.12;
        if (b && b.members.length <= 3) sig += 0.1;
      }
      break;
    }
    case "couple": if (hint === 1) { sig += 0.12; title = "Two peoples marry"; } break;
    case "kill": {
      /* the animal's weight in the hunt: mammoths outrank bears, bears aurochs */
      sig = hint === Species.Mammoth ? 0.6 : hint === Species.Bear ? 0.45 : 0.4;
      title = hint === Species.Mammoth ? "A mammoth brought down" : hint === Species.Aurochs ? "An aurochs brought down" : "A bear brought down";
      break;
    }
    case "contact": if (hint === 1) { sig += 0.2; title = "Strangers meet"; } else title = "Kin found"; break;
    case "move": if (hint === 1) { sig += 0.08; title = "A band sets off into the unknown"; } else if (hint === 2) { sig += 0.12; title = "Going home"; } break;
    case "hut": if (hint === 1) { sig += 0.1; title = "Huts go up"; } else if (n === 0) title = "The first hut anywhere"; break;
    case "pit": if (n === 0) title = "Food put by in the ground"; break;
    case "gather": sig += Math.min(0.25, Math.max(0, hint - 40) / 200); break;
    case "village": if (n === 0) title = "The first village"; break;
    case "pots": if (hint === 1) { sig += 0.15; title = "The first pots anywhere"; } break;
    case "age": if (hint === 1) { sig += 0.25; title = "A new age begins"; } else if (n === 0) sig += 0.1; break;
    case "tier": if (hint === 2) { sig += 0.15; title = "A town"; } else if (hint === 3) { sig += 0.3; title = "A city"; } else if (hint === 0) { sig -= 0.1; title = "A settlement dwindles"; } break;
    case "chief": if (hint === 1) title = "The village changes its chief"; break;
    case "communal": title = hint === 1 ? "The village raises a granary" : "The village digs a well"; break;
    case "well": case "granary": case "kiln": case "pen": case "built": if (hint === 1) { sig += 0.15; title = `The first ${kind === "built" ? "of its kind" : kind} anywhere`; } break;
    case "upgrade": if (hint === 1) { sig += 0.12; title = "A house built to last"; } break;
    case "kept": title = hint === 1 ? "Wolf pups taken in" : n === 0 ? "The first young animals carried home" : title; break;
    case "tamed": if (hint === 2) { sig += 0.3; title = "The first tame animals anywhere"; } else title = "A people takes to herding"; break;
    case "herd": title = hint === 1 ? "Wolves among the flock" : "Animals wander off"; break;
    case "found": { const m = MATS[hint]; if (m) { title = `${m.name.charAt(0).toUpperCase()}${m.name.slice(1)} found`; if (hint >= 15) sig += 0.08; } break; }
    case "exhausted": { const m = MATS[hint]; if (m) title = `The ${m.name} runs out`; break; }
    case "feud": if (hint === 1) { sig += 0.04; title = "A feud passes down"; } break;
    case "fight": if (hint === 1) { sig += 0.08; title = "Hurt in a fight"; } break;
    case "peace": if (hint === 1) { sig += 0.12; title = "A feud is settled"; } else title = "A feud cools"; break;
    case "leave": if (hint === 1) { sig += 0.12; title = "Driven out by a feud"; } break;
    case "split": if (hint === 1) { sig += 0.05; title = "A band divides"; } break;
    case "gift": if (hint === 1) { sig += 0.2; title = "Gifts between peoples"; } break;
    case "refused": if (hint === 1) sig += 0.06; break;
    case "discover": {
      const { level, id } = unpackHint(hint), d = IDEAS[id];
      if (level === 2) { sig += 0.42; title = d?.title || title; }
      else if (level === 1) { sig += 0.16; title = `New to a people: ${d?.name ?? "a way of doing things"}`; }
      else title = `Worked out again: ${d?.name ?? "a way of doing things"}`;
      break;
    }
    case "spread": { const { level, id } = unpackHint(hint), d = IDEAS[id]; if (level >= 1) { sig += 0.12; title = `Across peoples: ${d?.name ?? "know-how"}`; } else title = `Know-how spreads: ${d?.name ?? ""}`; break; }
    case "lost": { const { level, id } = unpackHint(hint), d = IDEAS[id]; if (level >= 1) { sig += 0.42; title = `Lost to the world: ${d?.name ?? "know-how"}`; } else title = `Know-how lost: ${d?.name ?? ""}`; break; }
    case "fireout": if (hint === 1) sig += 0.08; break;
    case "harvest": if (hint === 1) { sig += 0.3; title = "The first harvest anywhere"; } break;
  }
  /* the first of anything counts for more; the thousandth for nothing extra */
  sig += RARITY / (1 + n);
  return { sig: Math.max(0, Math.min(1, sig)), title };
}
