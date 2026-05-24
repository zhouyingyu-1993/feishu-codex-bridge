import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { logEvent } from "../core/logger.js";

const MAX_FILE_RECOGNIZE_MS = 60_000;

export async function transcribeAudioAttachments({ channel, attachments }) {
  const audio = attachments.filter((file) => file.kind === "audio");
  if (!audio.length) return attachments;

  for (const file of audio) {
    if (file.durationMs && file.durationMs > MAX_FILE_RECOGNIZE_MS) {
      file.transcriptionError = `这条语音约 ${formatDuration(file.durationMs)}，飞书文件语音识别接口更适合 60 秒以内音频。`;
      continue;
    }

    try {
      file.transcript = await transcribeAudioFile(channel, file.path);
      await logEvent("audio.transcribed", {
        path: file.path,
        durationMs: file.durationMs || 0,
        preview: file.transcript.slice(0, 120)
      });
    } catch (err) {
      file.transcriptionError = explainTranscriptionError(err);
      await logEvent("audio.transcribe.error", { path: file.path, message: err?.message || String(err) });
    }
  }
  return attachments;
}

export async function transcribeAudioFile(channel, sourcePath) {
  const errors = [];
  try {
    return await transcribeWithFeishu(channel, sourcePath);
  } catch (err) {
    errors.push(`飞书 ASR：${explainTranscriptionError(err)}`);
    await logEvent("audio.feishu_asr.error", { path: sourcePath, message: explainTranscriptionError(err) });
  }

  try {
    return await transcribeWithFasterWhisper(sourcePath);
  } catch (err) {
    errors.push(`本机 faster-whisper：${err?.message || String(err)}`);
  }

  throw new Error(errors.join("；"));
}

async function transcribeWithFeishu(channel, sourcePath) {
  const pcmPath = await convertToPcm(sourcePath);
  try {
    const pcm = await readFile(pcmPath);
    const response = await channel.rawClient.speech_to_text.v1.speech.fileRecognize({
      data: {
        speech: { speech: pcm.toString("base64") },
        config: {
          file_id: makeSpeechFileId(),
          format: "pcm",
          engine_type: "16k_auto"
        }
      }
    });
    const text = response?.data?.recognition_text || "";
    if (!text.trim()) throw new Error("飞书语音识别没有返回文字");
    return text.trim();
  } finally {
    await rm(pcmPath, { force: true }).catch(() => {});
    await rm(dirname(pcmPath), { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeWithFasterWhisper(sourcePath) {
  const script = [
    "import sys",
    "from faster_whisper import WhisperModel",
    "path = sys.argv[1]",
    "models = [item.strip() for item in sys.argv[2].split(',') if item.strip()]",
    "last_error = None",
    "for model_name in models:",
    "    try:",
    "        model = WhisperModel(model_name, device='cpu', compute_type='int8', local_files_only=True)",
    "        segments, info = model.transcribe(path, language='zh', beam_size=1, vad_filter=False)",
    "        text = ''.join(segment.text for segment in segments).strip()",
    "        if text:",
    "            print(text)",
    "            sys.exit(0)",
    "        last_error = Exception('empty transcript')",
    "    except Exception as exc:",
    "        last_error = exc",
    "raise RuntimeError(str(last_error or 'no local whisper model worked'))"
  ].join("\n");
  const output = await runCommandCapture("python3", [
    "-c",
    script,
    sourcePath,
    process.env.FEISHU_CODEX_BRIDGE_WHISPER_MODEL || "base,tiny"
  ], 120_000);
  const text = output.trim();
  if (!text) throw new Error("没有识别出文字");
  return text;
}

async function convertToPcm(sourcePath) {
  const dir = await mkdtemp(join(tmpdir(), "feishu-audio-"));
  const outputPath = join(dir, "audio.pcm");
  try {
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      outputPath
    ], 30_000);
    return outputPath;
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

function runCommand(command, args, timeoutMs) {
  return runCommandCapture(command, args, timeoutMs).then(() => undefined);
}

function runCommandCapture(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

export function makeSpeechFileId() {
  return randomBytes(8).toString("hex");
}

export function audioTranscriptSection(attachments) {
  const audio = attachments.filter((file) => file.kind === "audio");
  if (!audio.length) return "";
  const lines = [];
  for (const [index, file] of audio.entries()) {
    const label = audio.length === 1 ? "音频转写" : `音频 ${index + 1} 转写`;
    if (file.transcript) lines.push(`${label}：${file.transcript}`);
    else if (file.transcriptionError) lines.push(`${label}失败：${file.transcriptionError}`);
  }
  return lines.join("\n");
}

export function hasAudioOnlyWithoutTranscript(batch, attachments) {
  const hasAudio = attachments.some((file) => file.kind === "audio");
  if (!hasAudio) return false;
  const hasTranscript = attachments.some((file) => file.kind === "audio" && file.transcript);
  return !hasTranscript;
}

export function audioTranscriptionFailureMessage(attachments) {
  const reason = attachments
    .filter((file) => file.kind === "audio" && file.transcriptionError)
    .map((file) => file.transcriptionError)
    .find(Boolean);
  return [
    "这条语音没有转写成功，所以我没有继续让 Codex 猜内容。",
    "",
    reason ? `原因：${reason}` : "原因：没有拿到语音识别结果。",
    "",
    "请确认飞书应用已开通“语音识别 / speech_to_text”权限；如果权限已开，重发这条语音我再读。"
  ].join("\n");
}

export function meaningfulMessageText(content) {
  return String(content || "")
    .replace(/^\[(语音|音频|图片|文件|视频|voice|audio|image|file|video)\]$/i, "")
    .replace(/<audio\b[^>]*\/?>/gi, "")
    .trim();
}

function explainTranscriptionError(err) {
  const message = err?.message || String(err);
  const code = err?.response?.data?.code;
  const msg = err?.response?.data?.msg;
  if (code || msg) return `${code || "unknown"} ${msg || message}`;
  if (/ENOENT/.test(message) && /ffmpeg/.test(message)) return "本机没有安装 ffmpeg，无法把飞书语音转成语音识别需要的 PCM 格式。";
  if (/1040101/.test(message) || /invalid param/i.test(message)) return "飞书语音识别参数被拒绝，可能是音频格式或应用权限不满足要求。";
  if (/permission|scope|forbidden|unauthorized|999916/i.test(message)) return "飞书应用可能还没有开通语音识别权限。";
  return message;
}

function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes && seconds) return `${minutes} 分 ${seconds} 秒`;
  if (minutes) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}
