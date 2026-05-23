# Contributing

Thanks for helping improve `feishu-codex-bridge`.

## Local Setup

```bash
npm install
npm run check
npm test
```

For end-to-end testing, use a dedicated Feishu/Lark PersonalAgent app and a
throwaway workspace.

## Design Notes

- Keep Feishu/Lark logic in `src/bot` and command handling in `src/commands`.
- Keep Codex-specific logic in `src/agent/codex.js`.
- Avoid logging App Secrets, tokens, or full private file contents.
- Prefer small, testable parsing helpers over tenant-specific special cases.

## Pull Requests

Please include:

- What changed.
- Which slash commands or CLI commands were tested.
- Any Feishu/Lark tenant-specific behavior you observed.
