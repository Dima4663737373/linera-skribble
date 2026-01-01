import {
  accessoryMap,
  clothingMap,
  eyebrowsMap,
  eyesMap,
  facialHairMap,
  graphicsMap,
  hairMap,
  hatMap,
  mouthsMap,
  theme,
} from "@bigheads/core";
import type { AvatarProps } from "@bigheads/core";

export const CHARACTER_STORAGE_KEY = "skribbl_character_id";
export const CUSTOM_CHARACTER_ID = "custom";
export const CUSTOM_CHARACTER_PROPS_STORAGE_KEY = "skribbl_character_custom_props";

export type CharacterPreset = {
  id: string;
  props: AvatarProps;
};

const keysOf = <T extends object>(obj: T) => Object.keys(obj) as Array<keyof T>;

const stableHash = (value: string) => {
  const s = String(value || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const pick = <T>(arr: T[], seed: string, salt: string) => {
  if (!arr.length) return arr[0];
  const idx = stableHash(`${seed}::${salt}`) % arr.length;
  return arr[idx];
};

const buildAvatarProps = (seed: string, isWoman: boolean): AvatarProps => {
  const accessoryKeys = keysOf(accessoryMap) as unknown as string[];
  const clothingKeys = keysOf(clothingMap) as unknown as string[];
  const eyebrowsKeys = keysOf(eyebrowsMap) as unknown as string[];
  const eyesKeys = keysOf(eyesMap) as unknown as string[];
  const facialHairKeys = keysOf(facialHairMap) as unknown as string[];
  const hairKeys = keysOf(hairMap) as unknown as string[];
  const mouthKeys = keysOf(mouthsMap) as unknown as string[];
  const skinKeys = Object.keys(theme.colors.skin);
  const hairColorKeys = Object.keys(theme.colors.hair);
  const clothingColorKeys = Object.keys(theme.colors.clothing);
  const lipColorKeys = Object.keys(theme.colors.lipColors);

  return {
    body: isWoman ? "breasts" : "chest",
    lashes: isWoman,
    graphic: "none",
    hat: "none",
    faceMask: pick([false, true], seed, "faceMask"),
    mask: true,
    accessory: pick(accessoryKeys, seed, "accessory") as any,
    clothing: pick(clothingKeys, seed, "clothing") as any,
    eyebrows: pick(eyebrowsKeys, seed, "eyebrows") as any,
    eyes: pick(eyesKeys, seed, "eyes") as any,
    facialHair: (isWoman ? "none" : pick(facialHairKeys, seed, "facialHair")) as any,
    hair: pick(hairKeys, seed, "hair") as any,
    mouth: pick(mouthKeys, seed, "mouth") as any,
    skinTone: pick(skinKeys, seed, "skinTone") as any,
    hairColor: pick(hairColorKeys, seed, "hairColor") as any,
    clothingColor: pick(clothingColorKeys, seed, "clothingColor") as any,
    lipColor: pick(lipColorKeys, seed, "lipColor") as any,
  };
};

const PRESET_IDS = ["astro", "punk", "ninja", "artist", "captain", "cyber", "wizard", "robot"];

export const CHARACTER_PRESETS: CharacterPreset[] = PRESET_IDS.map((id, idx) => ({
  id,
  props: buildAvatarProps(id, idx % 2 === 1),
}));

export const getDefaultCharacterId = () => CHARACTER_PRESETS[0]?.id || "astro";

const randomU32 = () => {
  try {
    const g = globalThis as any;
    if (g?.crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      g.crypto.getRandomValues(buf);
      return buf[0] >>> 0;
    }
  } catch {}
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
};

const pickRandom = <T>(arr: readonly T[]) => {
  if (!arr.length) return undefined as unknown as T;
  return arr[randomU32() % arr.length] as T;
};

export const generateRandomCharacterProps = (): AvatarProps => {
  const skinToneKeys = Object.keys(theme.colors.skin);
  const hairColorKeys = Object.keys(theme.colors.hair);
  const clothingColorKeys = Object.keys(theme.colors.clothing);
  const lipColorKeys = Object.keys(theme.colors.lipColors);
  const circleColorKeys = Object.keys((theme as any)?.colors?.bgColors || {});

  return {
    skinTone: pickRandom(skinToneKeys) as any,
    eyes: pickRandom(keysOf(eyesMap) as unknown as string[]) as any,
    eyebrows: pickRandom(keysOf(eyebrowsMap) as unknown as string[]) as any,
    mouth: pickRandom(keysOf(mouthsMap) as unknown as string[]) as any,
    hair: pickRandom(keysOf(hairMap) as unknown as string[]) as any,
    facialHair: pickRandom(keysOf(facialHairMap) as unknown as string[]) as any,
    clothing: pickRandom(keysOf(clothingMap) as unknown as string[]) as any,
    accessory: pickRandom(keysOf(accessoryMap) as unknown as string[]) as any,
    graphic: pickRandom(keysOf(graphicsMap) as unknown as string[]) as any,
    hat: pickRandom(keysOf(hatMap) as unknown as string[]) as any,
    body: pickRandom(["chest", "breasts"] as const) as any,
    hairColor: pickRandom(hairColorKeys) as any,
    clothingColor: pickRandom(clothingColorKeys) as any,
    circleColor: pickRandom(circleColorKeys.length ? circleColorKeys : clothingColorKeys) as any,
    lipColor: pickRandom(lipColorKeys) as any,
    hatColor: pickRandom(clothingColorKeys) as any,
    faceMaskColor: pickRandom(clothingColorKeys) as any,
    mask: true,
    faceMask: (randomU32() & 1) === 1,
    lashes: (randomU32() & 1) === 1,
  };
};

const sanitizeAvatarProps = (input: any): AvatarProps | null => {
  if (!input || typeof input !== "object") return null;

  const result: AvatarProps = {};

  const setIfKey = (prop: keyof AvatarProps, value: any, allowed: readonly string[]) => {
    if (typeof value !== "string") return;
    if (!allowed.includes(value)) return;
    (result as any)[prop] = value;
  };

  setIfKey("skinTone", input.skinTone, Object.keys(theme.colors.skin));
  setIfKey("eyes", input.eyes, keysOf(eyesMap) as unknown as string[]);
  setIfKey("eyebrows", input.eyebrows, keysOf(eyebrowsMap) as unknown as string[]);
  setIfKey("mouth", input.mouth, keysOf(mouthsMap) as unknown as string[]);
  setIfKey("hair", input.hair, keysOf(hairMap) as unknown as string[]);
  setIfKey("facialHair", input.facialHair, keysOf(facialHairMap) as unknown as string[]);
  setIfKey("clothing", input.clothing, keysOf(clothingMap) as unknown as string[]);
  setIfKey("accessory", input.accessory, keysOf(accessoryMap) as unknown as string[]);
  setIfKey("graphic", input.graphic, keysOf(graphicsMap) as unknown as string[]);
  setIfKey("hat", input.hat, keysOf(hatMap) as unknown as string[]);
  setIfKey("body", input.body, ["chest", "breasts"] as const);

  setIfKey("hairColor", input.hairColor, Object.keys(theme.colors.hair));
  setIfKey("clothingColor", input.clothingColor, Object.keys(theme.colors.clothing));
  setIfKey("circleColor", input.circleColor, Object.keys((theme as any)?.colors?.bgColors || theme.colors.clothing));
  setIfKey("lipColor", input.lipColor, Object.keys(theme.colors.lipColors));
  setIfKey("hatColor", input.hatColor, Object.keys(theme.colors.clothing));
  setIfKey("faceMaskColor", input.faceMaskColor, Object.keys(theme.colors.clothing));

  if (typeof input.mask === "boolean") result.mask = input.mask;
  if (typeof input.faceMask === "boolean") result.faceMask = input.faceMask;
  if (typeof input.lashes === "boolean") result.lashes = input.lashes;

  return result;
};

export const parseAvatarJson = (raw: string): AvatarProps | null => {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return sanitizeAvatarProps(parsed);
  } catch {
    return null;
  }
};

export const stringifyAvatarProps = (props: AvatarProps): string => {
  try {
    const sanitized = sanitizeAvatarProps(props) || {};
    return JSON.stringify(sanitized);
  } catch {
    return "{}";
  }
};

export const getSelectedAvatarProps = (): AvatarProps => {
  const id = loadSelectedCharacterId();
  if (id === CUSTOM_CHARACTER_ID) {
    const custom = loadCustomCharacterProps();
    if (custom) return custom;
  }
  return getCharacterPropsById(id);
};

export const getSelectedAvatarJson = (): string => {
  return stringifyAvatarProps(getSelectedAvatarProps());
};

export const loadCustomCharacterProps = (): AvatarProps | null => {
  try {
    const raw = localStorage.getItem(CUSTOM_CHARACTER_PROPS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeAvatarProps(parsed);
    if (!sanitized) return null;
    try {
      localStorage.setItem(CUSTOM_CHARACTER_PROPS_STORAGE_KEY, JSON.stringify(sanitized));
    } catch {}
    return sanitized;
  } catch {
    return null;
  }
};

export const saveCustomCharacterProps = (props: AvatarProps) => {
  try {
    const sanitized = sanitizeAvatarProps(props) || {};
    localStorage.setItem(CUSTOM_CHARACTER_PROPS_STORAGE_KEY, JSON.stringify(sanitized));
    localStorage.setItem(CHARACTER_STORAGE_KEY, CUSTOM_CHARACTER_ID);
  } catch {}
};

export const loadSelectedCharacterId = () => {
  const raw = localStorage.getItem(CHARACTER_STORAGE_KEY);
  const id = String(raw || "").trim();
  if (id === CUSTOM_CHARACTER_ID) {
    return loadCustomCharacterProps() ? CUSTOM_CHARACTER_ID : getDefaultCharacterId();
  }
  return CHARACTER_PRESETS.some((p) => p.id === id) ? id : getDefaultCharacterId();
};

export const saveSelectedCharacterId = (id: string) => {
  const next = String(id || "").trim();
  if (next === CUSTOM_CHARACTER_ID) {
    localStorage.setItem(CHARACTER_STORAGE_KEY, next);
    return;
  }
  if (!CHARACTER_PRESETS.some((p) => p.id === next)) return;
  localStorage.setItem(CHARACTER_STORAGE_KEY, next);
};

export const getCharacterPropsById = (id: string): AvatarProps => {
  if (id === CUSTOM_CHARACTER_ID) {
    const custom = loadCustomCharacterProps();
    if (custom) return custom;
  }
  const found = CHARACTER_PRESETS.find((p) => p.id === id);
  return found?.props || CHARACTER_PRESETS[0].props;
};

export const stableIndexFromString = (value: string, mod: number) => {
  const hash = stableHash(String(value || ""));
  return mod > 0 ? hash % mod : 0;
};

export const getCharacterIdForPlayer = (playerId: string, localPlayerId: string) => {
  if (playerId && localPlayerId && playerId === localPlayerId) return loadSelectedCharacterId();
  const idx = stableIndexFromString(playerId || "", CHARACTER_PRESETS.length);
  return CHARACTER_PRESETS[idx]?.id || getDefaultCharacterId();
};
