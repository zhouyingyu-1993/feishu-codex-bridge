import assert from "node:assert/strict";
import test from "node:test";
import { buildArgs } from "../src/agent/codex.js";

test("builds current codex exec args without deprecated approval flag", () => {
  const args = buildArgs(
    {
      model: "gpt-5.4-mini",
      sandbox: "workspace-write",
      askForApproval: "never",
      extraArgs: []
    },
    {
      cwd: "/tmp/project",
      images: []
    },
    "/tmp/last-message.txt"
  );

  assert.deepEqual(args, [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C",
    "/tmp/project",
    "-o",
    "/tmp/last-message.txt",
    "-m",
    "gpt-5.4-mini",
    "-s",
    "workspace-write",
    "-"
  ]);
  assert.equal(args.includes("-a"), false);
});
