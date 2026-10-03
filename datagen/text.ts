// Template-grammar text generation. (An offline, cached LLM paraphrase pass can later be layered
// on top for variety; this module is the deterministic baseline.)
import type { Lang } from "./config";
import type { Rng } from "./rng";
import type { Sentiment } from "./noise";

type Bank = Record<Sentiment, string[]>;

// {B} brand reference, {T} topic noun, {C} competitor
const OPEN: Record<Lang, Bank> = {
  en: {
    positive: [
      "Honestly loving {B} right now.",
      "{B} just made my day.",
      "Big shoutout to {B}.",
      "Can't stop recommending {B}.",
      "{B} nailed it this time.",
      "Okay {B} is actually good.",
    ],
    neutral: [
      "Tried {B} today.",
      "Anyone else using {B}?",
      "Saw an ad for {B}.",
      "{B} announced something new.",
      "Heard about {B} from a friend.",
      "Thinking about switching to {B}.",
    ],
    negative: [
      "{B} has really let me down.",
      "Never again with {B}.",
      "Seriously disappointed in {B}.",
      "{B} is getting worse every month.",
      "Why is {B} like this?",
      "Done with {B}.",
    ],
    mixed: [
      "{B} is good but frustrating.",
      "Love and hate {B} at the same time.",
      "{B} has potential, still annoying.",
      "Mixed feelings about {B}.",
    ],
  },
  es: {
    positive: [
      "Me encanta {B}.",
      "{B} me alegró el día.",
      "Recomiendo {B} sin dudar.",
      "{B} lo hizo bien esta vez.",
    ],
    neutral: [
      "Probé {B} hoy.",
      "¿Alguien usa {B}?",
      "Vi un anuncio de {B}.",
      "{B} anunció algo nuevo.",
    ],
    negative: [
      "{B} me decepcionó mucho.",
      "Nunca más con {B}.",
      "{B} cada vez peor.",
      "Estoy harto de {B}.",
    ],
    mixed: ["{B} está bien pero frustra.", "Sentimientos encontrados con {B}."],
  },
  pt: {
    positive: [
      "Amando {B} agora.",
      "{B} salvou meu dia.",
      "Recomendo {B} demais.",
      "{B} acertou dessa vez.",
    ],
    neutral: [
      "Testei {B} hoje.",
      "Alguém usa {B}?",
      "Vi um anúncio da {B}.",
      "{B} anunciou novidade.",
    ],
    negative: [
      "{B} me decepcionou muito.",
      "Nunca mais com {B}.",
      "{B} está cada vez pior.",
      "Cansei da {B}.",
    ],
    mixed: ["{B} é bom mas irrita.", "Sentimentos mistos sobre {B}."],
  },
  fr: {
    positive: [
      "J'adore {B} en ce moment.",
      "{B} a fait ma journée.",
      "Je recommande {B} à fond.",
      "{B} a tout réussi.",
    ],
    neutral: [
      "J'ai testé {B} aujourd'hui.",
      "Quelqu'un utilise {B} ?",
      "Vu une pub pour {B}.",
      "{B} a annoncé du nouveau.",
    ],
    negative: [
      "{B} m'a vraiment déçu.",
      "Plus jamais {B}.",
      "{B} est de pire en pire.",
      "J'en ai marre de {B}.",
    ],
    mixed: ["{B} est bien mais agaçant.", "Avis partagé sur {B}."],
  },
  de: {
    positive: [
      "Ich liebe {B} gerade.",
      "{B} hat meinen Tag gerettet.",
      "Klare Empfehlung für {B}.",
      "{B} hat es diesmal geschafft.",
    ],
    neutral: [
      "Heute {B} ausprobiert.",
      "Nutzt jemand {B}?",
      "Werbung für {B} gesehen.",
      "{B} hat etwas Neues angekündigt.",
    ],
    negative: [
      "{B} hat mich enttäuscht.",
      "Nie wieder {B}.",
      "{B} wird immer schlechter.",
      "Ich habe genug von {B}.",
    ],
    mixed: ["{B} ist gut, aber nervig.", "Gemischte Gefühle bei {B}."],
  },
  it: {
    positive: [
      "Adoro {B} adesso.",
      "{B} mi ha svoltato la giornata.",
      "Consiglio {B} a tutti.",
      "{B} ha fatto centro.",
    ],
    neutral: [
      "Provato {B} oggi.",
      "Qualcuno usa {B}?",
      "Visto una pubblicità di {B}.",
      "{B} ha annunciato novità.",
    ],
    negative: [
      "{B} mi ha deluso.",
      "Mai più {B}.",
      "{B} peggiora ogni mese.",
      "Ne ho abbastanza di {B}.",
    ],
    mixed: ["{B} è buono ma frustrante.", "Sentimenti contrastanti su {B}."],
  },
};

const BODY: Record<Lang, Bank> = {
  en: {
    positive: [
      "The {T} is on another level.",
      "Great {T}, fair price.",
      "Their {T} keeps getting better.",
      "The {T} alone is worth it.",
    ],
    neutral: [
      "Curious how the {T} compares.",
      "The {T} seems about average.",
      "Reading up on the {T} before deciding.",
      "Not sure what to think about the {T} yet.",
    ],
    negative: [
      "The {T} is a joke.",
      "Terrible {T}, zero support.",
      "The {T} broke again this week.",
      "Waited ages and the {T} was still awful.",
    ],
    mixed: ["The {T} is great but everything else is a mess.", "Good {T}, bad follow-through."],
  },
  es: {
    positive: ["El {T} es de otro nivel.", "Buen {T} y buen precio."],
    neutral: ["Curioso cómo es el {T}.", "El {T} parece normal."],
    negative: ["El {T} es una broma.", "Pésimo {T}, cero soporte."],
    mixed: ["El {T} es bueno pero lo demás no."],
  },
  pt: {
    positive: ["O {T} é de outro nível.", "Ótimo {T} e preço justo."],
    neutral: ["Curioso com o {T}.", "O {T} parece normal."],
    negative: ["O {T} é uma piada.", "{T} péssimo, zero suporte."],
    mixed: ["O {T} é bom mas o resto não."],
  },
  fr: {
    positive: ["Le {T} est au top.", "Super {T}, prix correct."],
    neutral: ["Curieux de voir le {T}.", "Le {T} semble correct."],
    negative: ["Le {T} est une blague.", "{T} nul, zéro support."],
    mixed: ["Le {T} est bien mais le reste non."],
  },
  de: {
    positive: ["Der {T} ist ein anderes Level.", "Guter {T}, fairer Preis."],
    neutral: ["Neugierig auf den {T}.", "Der {T} wirkt durchschnittlich."],
    negative: ["Der {T} ist ein Witz.", "Schlechter {T}, null Support."],
    mixed: ["Der {T} ist gut, der Rest nicht."],
  },
  it: {
    positive: ["Il {T} è di un altro livello.", "Ottimo {T}, prezzo onesto."],
    neutral: ["Curioso del {T}.", "Il {T} sembra nella media."],
    negative: ["Il {T} è uno scherzo.", "{T} pessimo, zero assistenza."],
    mixed: ["Il {T} è buono ma il resto no."],
  },
};

const GENERIC_TOPICS: Record<Lang, string[]> = {
  en: [], // English uses the vertical's own topic words
  es: ["servicio", "precio", "producto", "diseño", "soporte"],
  pt: ["serviço", "preço", "produto", "design", "suporte"],
  fr: ["service", "prix", "produit", "design", "support"],
  de: ["Service", "Preis", "Produkt", "Design", "Support"],
  it: ["servizio", "prezzo", "prodotto", "design", "supporto"],
};

const SARCASM = [
  "Oh great, another {T} issue with {B}. Love that for me 🙄",
  "Thanks {B}, really needed my {T} to fail today. Amazing.",
  "{B} and their legendary {T}. Truly a masterpiece of disappointment.",
  "Five stars for {B}'s {T}, if you enjoy waiting. 👏",
];

const COMMENT = {
  agree: ["same here", "this 💯", "can confirm", "+1", "exactly this", "ha, relatable"],
  disagree: ["not my experience at all", "hard disagree", "that's not true", "worked fine for me"],
  neutral: ["interesting, thanks for sharing", "any link?", "when did this happen?", "following"],
};

const EMOJI: Record<Sentiment, string[]> = {
  positive: ["😍", "🔥", "👏", "✨", "🙌"],
  neutral: ["🤔", "👀", ""],
  negative: ["😡", "🤦", "👎", "😤"],
  mixed: ["😅", "🤷", ""],
};

export interface TextCtx {
  rng: Rng;
  lang: Lang;
  brand: string;
  short: string;
  handle: string;
  topic: string;
  sentiment: Sentiment;
  sarcastic: boolean;
  /** When false, the text avoids naming the brand (logo-only / generic comment). */
  mentionBrand: boolean;
  competitor?: string;
}

function typo(rng: Rng, s: string): string {
  if (s.length < 6) return s;
  const i = 1 + rng.int(s.length - 3);
  return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
}

function brandRef(c: TextCtx): string {
  const r = c.rng.float();
  if (r < 0.55) return c.brand;
  if (r < 0.75) return c.short;
  if (r < 0.85) return `@${c.handle}`;
  if (r < 0.92) return `#${c.short.replace(/\s+/g, "")}`;
  return typo(c.rng, c.brand);
}

export function postText(c: TextCtx): string {
  const { rng } = c;
  const topic = c.lang === "en" ? c.topic : rng.pick(GENERIC_TOPICS[c.lang]);
  let text: string;
  if (c.sarcastic) {
    text = rng.pick(SARCASM);
  } else {
    const open = rng.pick(OPEN[c.lang][c.sentiment]);
    text = rng.bool(0.7) ? `${open} ${rng.pick(BODY[c.lang][c.sentiment])}` : open;
  }
  text = text.replaceAll("{T}", topic);
  if (c.mentionBrand) {
    text = text.replaceAll("{B}", brandRef(c));
  } else {
    text = text.replaceAll("{B}", "this place");
  }
  if (c.competitor && rng.bool(0.5)) text += ` Still better than ${c.competitor}.`;
  if (rng.bool(0.5)) text += ` ${rng.pick(EMOJI[c.sentiment])}`.trimEnd();
  if (rng.bool(0.3) && c.mentionBrand) text += ` #${c.short.replace(/\s+/g, "").toLowerCase()}`;
  if (rng.bool(0.06)) text = text.toLowerCase();
  return text.trim();
}

export function commentText(
  rng: Rng,
  parentSentiment: Sentiment,
  sentiment: Sentiment,
  brand: string,
  mentionBrand: boolean,
): string {
  const pool =
    sentiment === "neutral"
      ? COMMENT.neutral
      : sentiment === parentSentiment
        ? COMMENT.agree
        : COMMENT.disagree;
  const base = rng.pick(pool);
  return mentionBrand ? `${base} ${brand}` : base;
}

export function repostText(handle: string, parentText: string): string {
  return `RT @${handle}: ${parentText.slice(0, 110)}`;
}

export function headline(
  rng: Rng,
  brand: string,
  kind: "crisis" | "launch" | "campaign" | "news",
  noun: string,
): { title: string; text: string } {
  const H = {
    crisis: [
      `${brand} faces backlash after viral complaint`,
      `Customers vent as ${brand} ${noun} problems spread`,
      `${brand} responds to growing criticism`,
      `What went wrong at ${brand}?`,
    ],
    launch: [
      `${brand} unveils new ${noun}`,
      `First look: ${brand}'s latest ${noun}`,
      `${brand} launches ${noun} to strong early interest`,
    ],
    campaign: [`${brand} campaign gets the internet talking`, `Inside ${brand}'s new ${noun} push`],
    news: [
      `${brand} announces partnership`,
      `${brand} reports quarterly results`,
      `Analysts weigh in on ${brand}'s ${noun} strategy`,
    ],
  }[kind];
  const title = rng.pick(H);
  return {
    title,
    text: `${title}. ${rng.pick(["Industry observers say the story is developing.", "The company declined to comment further.", "Reactions on social media have been mixed.", "More details are expected in the coming days."])}`,
  };
}

export type SpamKind = "job" | "giveaway" | "crypto" | "coupon";
export const SPAM_KINDS: SpamKind[] = ["job", "giveaway", "crypto", "coupon"];

export function spamText(
  rng: Rng,
  kind: SpamKind,
  brand: string,
  short: string,
  lang: Lang,
): string {
  if (lang === "es" || lang === "pt") {
    return rng.pick([
      `¡SORTEO! Gana un premio de ${brand} 🎁 sigue y comparte`,
      `Cupón ${short} 70% OFF solo hoy 👉 bit.ly/x${rng.int(9999)}`,
    ]);
  }
  switch (kind) {
    case "job":
      return `${brand} is hiring! Remote ${rng.pick(["data entry", "sales rep", "support agent"])} $${15 + rng.int(40)}/hr. Apply now: jobs-sim.ripplewise.test/${rng.int(99999)}`;
    case "giveaway":
      return `🎁 GIVEAWAY 🎁 Win a $${rng.pick([100, 250, 500, 1000])} ${brand} gift card! RT + follow + tag 3 friends #${short.replace(/\s+/g, "")}giveaway`;
    case "crypto":
      return `${short} to the moon 🚀 buy $${short.toUpperCase().replace(/\s+/g, "").slice(0, 4)}COIN now, 100x guaranteed. dm for signals`;
    case "coupon":
      return `${brand} promo code ${short.toUpperCase().replace(/\s+/g, "")}${rng.int(90)} → ${rng.pick([30, 50, 70])}% off. deals-sim.ripplewise.test/${rng.int(99999)}`;
  }
}

export function mediaAlt(rng: Rng, brand: string, vertical: string, withLogo: boolean): string {
  const scene = rng.pick([
    "a table with a drink",
    "a person smiling",
    "a street at dusk",
    "a close-up of a product",
    "a crowded queue",
    "a phone screen",
  ]);
  return withLogo
    ? `Photo of ${scene} with a ${brand} logo visible (${vertical})`
    : `Photo of ${scene}`;
}
