import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "../config/paths.js";
import { logEvent } from "../core/logger.js";

export class MediaCache {
  constructor(channel) {
    this.channel = channel;
  }

  async resolve(chatId, items) {
    if (!items.length) return [];
    const dir = join(paths.mediaDir, sanitize(chatId));
    await mkdir(dir, { recursive: true });
    const files = [];
    for (const item of items) {
      const local = await this.resolveOne(dir, item).catch(async (err) => {
        await logEvent("media.error", {
          message: err?.message || String(err),
          code: err?.response?.data?.code || "",
          status: err?.response?.status || "",
          fileKey: item.resource?.fileKey,
          type: item.resource?.type
        });
        if (item.resource?.type === "audio") {
          return {
            path: "",
            kind: "audio",
            originalName: item.resource.fileName || "",
            durationMs: item.resource.durationMs || 0,
            transcriptionError: `语音文件下载失败：${mediaErrorMessage(err)}`
          };
        }
        return null;
      });
      if (local) files.push(local);
    }
    return files;
  }

  async resolveOne(dir, item) {
    const resource = item.resource;
    if (!resource?.fileKey || resource.type === "sticker") return null;
    const fileName = `${sanitize(resource.fileKey)}-${sanitize(resource.fileName || defaultName(resource.type))}`;
    const path = join(dir, fileName);
    try {
      await stat(path);
      return { path, kind: resource.type || "file", originalName: resource.fileName || "", durationMs: resource.durationMs || 0 };
    } catch {
      // Not cached yet.
    }
    const result = await this.channel.rawClient.im.v1.messageResource.get({
      params: { type: resourceDownloadType(resource.type) },
      path: { message_id: item.messageId, file_key: resource.fileKey }
    });
    await result.writeFile(path);
    return { path, kind: resource.type || "file", originalName: resource.fileName || "", durationMs: resource.durationMs || 0 };
  }
}

export function resourceDownloadType(type) {
  return type === "image" ? "image" : "file";
}

export async function gcMediaCache(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  const chats = await readdir(paths.mediaDir).catch(() => []);
  for (const chat of chats) {
    const dir = join(paths.mediaDir, chat);
    const names = await readdir(dir).catch(() => []);
    for (const name of names) {
      const file = join(dir, name);
      const st = await stat(file).catch(() => null);
      if (st?.isFile() && st.mtimeMs < cutoff) await rm(file).catch(() => {});
    }
  }
}

function sanitize(value) {
  return String(value || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96);
}

function defaultName(type) {
  if (type === "image") return "image.png";
  if (type === "audio") return "audio.ogg";
  if (type === "video") return "video.mp4";
  return "file.bin";
}

function mediaErrorMessage(err) {
  const code = err?.response?.data?.code;
  const msg = err?.response?.data?.msg || err?.message || String(err);
  return code ? `${code} ${msg}` : msg;
}
