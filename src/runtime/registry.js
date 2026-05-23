import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "../config/paths.js";

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

export function readRegistry(path = paths.processesFile) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return (parsed.entries || []).filter((entry) => entry && isAlive(entry.pid));
  } catch {
    return [];
  }
}

export async function registerProcess({ appId, tenant, configPath, version }) {
  const entry = {
    id: randomBytes(2).toString("hex"),
    pid: process.pid,
    appId,
    tenant,
    configPath,
    version,
    startedAt: new Date().toISOString()
  };
  await writeRegistry([...readRegistry(), entry]);
  return entry;
}

export async function unregisterProcess(id) {
  await writeRegistry(readRegistry().filter((entry) => entry.id !== id));
}

export function unregisterProcessSync(id) {
  writeRegistrySync(readRegistry().filter((entry) => entry.id !== id));
}

export function resolveProcess(target) {
  const entries = readRegistry();
  const byId = entries.find((entry) => entry.id === target);
  if (byId) return byId;
  const index = Number.parseInt(target, 10);
  return Number.isFinite(index) ? entries[index - 1] : undefined;
}

async function writeRegistry(entries, path = paths.processesFile) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function writeRegistrySync(entries, path = paths.processesFile) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}
