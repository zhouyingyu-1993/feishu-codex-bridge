import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["bin", "src", "scripts", "test"];
let failed = false;

for (const file of roots.flatMap((root) => listJs(root))) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);

function listJs(path) {
  try {
    const st = statSync(path);
    if (st.isFile()) return path.endsWith(".js") || path.endsWith(".mjs") ? [path] : [];
    return readdirSync(path).flatMap((name) => listJs(join(path, name)));
  } catch {
    return [];
  }
}
