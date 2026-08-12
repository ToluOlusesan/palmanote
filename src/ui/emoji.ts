/**
 * A curated emoji set for document icons.
 *
 * The full Unicode set with search keywords is about 1.5 MB of JSON — most of
 * this application. These are the ones a writer actually reaches for when
 * labelling parts, chapters, characters, places and notes, each with the words
 * they would search by. Roughly 15 KB, no dependency, and it renders in Segoe
 * UI Emoji, which is native on Windows.
 *
 * Add to it freely. It is a list, not a system.
 */

export interface EmojiGroup {
  name: string;
  emoji: [glyph: string, keywords: string][];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: 'Structure',
    emoji: [
      ['📕', 'book part volume closed'],
      ['📖', 'book open reading chapter'],
      ['📗', 'book green part'],
      ['📘', 'book blue part'],
      ['📙', 'book orange part'],
      ['📚', 'books series shelf'],
      ['📓', 'notebook journal'],
      ['📔', 'notebook decorated diary'],
      ['📒', 'ledger notebook'],
      ['🗂️', 'folder divider section'],
      ['📁', 'folder file'],
      ['📄', 'page document scene'],
      ['📃', 'page curl draft'],
      ['🗒️', 'notepad notes'],
      ['🔖', 'bookmark tag'],
      ['📑', 'tabs bookmarks index'],
      ['🧾', 'receipt invoice client'],
      ['📰', 'newspaper article press'],
    ],
  },
  {
    name: 'Writing',
    emoji: [
      ['✍️', 'writing hand draft'],
      ['✏️', 'pencil edit revise'],
      ['🖊️', 'pen ink'],
      ['🖋️', 'fountain pen ink'],
      ['🖌️', 'brush style'],
      ['📝', 'memo note draft'],
      ['⌨️', 'keyboard typing'],
      ['📌', 'pin important'],
      ['📎', 'clip attached'],
      ['✂️', 'cut trim'],
      ['🗑️', 'bin cut discard'],
      ['💡', 'idea thought'],
      ['❓', 'question unresolved'],
      ['❗', 'important urgent'],
      ['⭐', 'star favourite good'],
      ['🔥', 'hot strong burning'],
      ['✅', 'done finished complete'],
      ['🚧', 'wip unfinished rough'],
    ],
  },
  {
    name: 'People',
    emoji: [
      ['👤', 'character person figure'],
      ['👥', 'characters people cast'],
      ['🧑', 'person character'],
      ['👩', 'woman character she'],
      ['👨', 'man character he'],
      ['🧒', 'child kid'],
      ['🧓', 'elder old'],
      ['👑', 'king queen crown royal'],
      ['🕵️', 'detective investigator'],
      ['👻', 'ghost haunting'],
      ['💀', 'death skull dead'],
      ['🫀', 'heart love romance'],
      ['💬', 'dialogue speech talk'],
      ['🗣️', 'voice speaking narrator'],
      ['🤝', 'meeting deal alliance'],
      ['⚔️', 'conflict fight battle'],
    ],
  },
  {
    name: 'Places',
    emoji: [
      ['🏠', 'house home'],
      ['🏚️', 'derelict ruin abandoned'],
      ['🏰', 'castle keep'],
      ['⛪', 'church chapel'],
      ['🏙️', 'city town urban'],
      ['🌆', 'dusk city evening'],
      ['🏞️', 'country park landscape'],
      ['⛰️', 'mountain hill'],
      ['🌲', 'forest wood tree'],
      ['🏝️', 'island shore'],
      ['🌊', 'sea water estuary wave'],
      ['⚓', 'harbour port anchor ship'],
      ['🚢', 'ship boat voyage'],
      ['🚂', 'train railway'],
      ['🛣️', 'road journey travel'],
      ['🗺️', 'map geography world'],
    ],
  },
  {
    name: 'Weather and time',
    emoji: [
      ['☀️', 'sun day summer'],
      ['🌙', 'moon night'],
      ['⭐', 'star night sky'],
      ['🌧️', 'rain wet weather'],
      ['⛈️', 'storm thunder'],
      ['❄️', 'snow winter cold'],
      ['🌫️', 'fog mist'],
      ['🍂', 'autumn fall leaves'],
      ['🌱', 'spring growth beginning'],
      ['⏳', 'time passing hourglass'],
      ['⏰', 'deadline alarm clock'],
      ['📅', 'date calendar when'],
    ],
  },
  {
    name: 'Objects',
    emoji: [
      ['🔑', 'key clue unlock'],
      ['🗝️', 'old key secret'],
      ['🕯️', 'candle light'],
      ['🔒', 'locked secret closed'],
      ['💌', 'letter correspondence'],
      ['📞', 'call telephone'],
      ['📷', 'photograph camera'],
      ['🎭', 'theatre drama mask'],
      ['🎼', 'music score song'],
      ['🍷', 'wine drink'],
      ['☕', 'coffee tea morning'],
      ['🚬', 'cigarette smoke'],
      ['💰', 'money payment client'],
      ['⚖️', 'law justice trial'],
      ['🧭', 'compass direction'],
      ['🔍', 'search find detail'],
    ],
  },
];

/** Flat list, for searching. */
const ALL: [string, string][] = EMOJI_GROUPS.flatMap((group) =>
  group.emoji.map(([glyph, keywords]) => [glyph, `${keywords} ${group.name.toLowerCase()}`] as [string, string]),
);

export function searchEmoji(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const words = needle.split(/\s+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [glyph, keywords] of ALL) {
    if (seen.has(glyph)) continue;
    if (words.every((word) => keywords.includes(word))) {
      seen.add(glyph);
      out.push(glyph);
    }
  }
  return out;
}
