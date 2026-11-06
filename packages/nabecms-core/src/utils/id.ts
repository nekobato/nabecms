import { customAlphabet } from "nanoid";

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 12;

const nanoid = customAlphabet(ID_ALPHABET, ID_LENGTH);

export function generateId(): string {
  return nanoid();
}

export function generateIdWithPrefix(_prefix?: string): string {
  return generateId();
}

export const idGeneratorConfig = {
  alphabet: ID_ALPHABET,
  length: ID_LENGTH,
} as const;
