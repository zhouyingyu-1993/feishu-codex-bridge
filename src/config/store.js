import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./paths.js";
import { defaultConfig, normalizeConfig } from "./schema.js";
import { runRegistrationWizard } from "./wizard.js";

export async function loadConfig(configPath = paths.configFile) {
  const text = await readFile(configPath, "utf8");
  return normalizeConfig(JSON.parse(text));
}

export async function saveConfig(cfg, configPath = paths.configFile) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(normalizeConfig(cfg), null, 2)}\n`, { mode: 0o600 });
}

export async function loadOrCreateConfig(configPath = paths.configFile) {
  try {
    return await loadConfig(configPath);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    const cfg = await runRegistrationWizard().catch(async (wizardErr) => {
      console.warn(`扫码创建向导未完成：${wizardErr?.message || wizardErr}`);
      console.warn("已生成空配置文件，你也可以手动填写 App ID / Secret 后重新运行。");
      return defaultConfig();
    });
    await saveConfig(cfg, configPath);
    console.log(`配置已写入：${configPath}`);
    return normalizeConfig(cfg);
  }
}
