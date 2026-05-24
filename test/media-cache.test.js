import test from "node:test";
import assert from "node:assert/strict";
import { resourceDownloadType } from "../src/media/cache.js";

test("downloads message resources with Feishu-supported type values", () => {
  assert.equal(resourceDownloadType("image"), "image");
  assert.equal(resourceDownloadType("audio"), "file");
  assert.equal(resourceDownloadType("video"), "file");
  assert.equal(resourceDownloadType("file"), "file");
});
