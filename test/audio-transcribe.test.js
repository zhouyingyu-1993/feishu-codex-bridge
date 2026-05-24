import test from "node:test";
import assert from "node:assert/strict";
import {
  audioTranscriptSection,
  audioTranscriptionFailureMessage,
  hasAudioOnlyWithoutTranscript,
  meaningfulMessageText
} from "../src/media/transcribe.js";

test("stops any audio message without transcript", () => {
  assert.equal(
    hasAudioOnlyWithoutTranscript(
      [{ content: "[语音]" }],
      [{ kind: "audio", path: "/tmp/a.ogg", transcriptionError: "missing permission" }]
    ),
    true
  );
  assert.equal(
    hasAudioOnlyWithoutTranscript(
      [{ content: "[语音]" }],
      [{ kind: "audio", path: "/tmp/a.ogg", transcript: "你好" }]
    ),
    false
  );
  assert.equal(
    hasAudioOnlyWithoutTranscript(
      [{ content: "请总结这段语音" }],
      [{ kind: "audio", path: "/tmp/a.ogg", transcriptionError: "missing permission" }]
    ),
    true
  );
});

test("renders audio transcript sections", () => {
  assert.equal(
    audioTranscriptSection([{ kind: "audio", transcript: "请继续测试" }]),
    "音频转写：请继续测试"
  );
});

test("filters placeholder-only audio message text", () => {
  assert.equal(meaningfulMessageText("[语音]"), "");
  assert.equal(meaningfulMessageText("<audio key=\"file_v3_x\" duration=\"2s\"/>"), "");
  assert.equal(meaningfulMessageText("请总结这段语音"), "请总结这段语音");
});

test("audio transcription failure message is explicit", () => {
  const message = audioTranscriptionFailureMessage([{ kind: "audio", transcriptionError: "权限不足" }]);
  assert.match(message, /语音没有转写成功/);
  assert.match(message, /权限不足/);
  assert.match(message, /speech_to_text/);
});
