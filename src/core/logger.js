import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { paths, todayLogPath } from "../config/paths.js";

export async function logEvent(event, data = {}) {
  await mkdir(paths.logsDir, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...sanitize(data)
  });
  await appendFile(todayLogPath(), `${line}\n`, "utf8").catch(() => {});
}

export async function readRecentLogs(lines = 120) {
  try {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(todayLogPath(), "utf8"));
    return text.trim().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export async function gcLogs(days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let names = [];
  try {
    names = await readdir(paths.logsDir);
  } catch {
    return;
  }
  await Promise.all(names.map(async (name) => {
    const path = join(paths.logsDir, name);
    const st = await stat(path).catch(() => null);
    if (st?.isFile() && st.mtimeMs < cutoff) await rm(path).catch(() => {});
  }));
}

function sanitize(value) {
  if (!value || typeof value !== "object") return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|token|password/i.test(key)) out[key] = "[redacted]";
    else if (item && typeof item === "object") out[key] = sanitize(item);
    else out[key] = item;
  }
  return out;
}
