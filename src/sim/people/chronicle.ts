import { Species } from "../../shared/types.ts";
import type { Society } from "./society.ts";

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
  leave: [0.28, "A family moves on"], merge: [0.55, "A band joins another"], "band-end": [0.95, "A band is no more"], respect: [0.35, "A voice rises"],
};
/** How much rarer-than-usual an event of this kind is allowed to count for. */
const RARITY = 0.3;

/**
  `hint` carries what only the caller knows: the animal for a hunt (a Species), 1 for strangers who speak
  another language or a move into unknown land, 2 for twins.
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
    case "move": if (hint === 1) { sig += 0.08; title = "A band sets off into the unknown"; } break;
    case "respect": title = "A new voice of the band"; break;
  }
  /* the first of anything counts for more; the thousandth for nothing extra */
  sig += RARITY / (1 + n);
  return { sig: Math.max(0, Math.min(1, sig)), title };
}
