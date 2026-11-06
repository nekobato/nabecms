import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.join(repoRoot, "packages", "nabecms-admin", "dist");
const destination = path.join(repoRoot, "packages", "nabecms", "admin", "dist");

await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });

console.log(`Synchronized Admin assets to ${destination}.`);
