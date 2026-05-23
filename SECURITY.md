# Security Policy

## Supported Versions

Security fixes target the latest `0.x` release until the project reaches a
stable `1.0`.

## Reporting A Vulnerability

Please open a private security advisory on GitHub, or email the maintainer if
you publish this under your own GitHub account.

Do not include real App Secrets, OpenAI credentials, Codex session files, or
private workspace paths in public issues.

## Operator Checklist

- Set `/config set admins ...` before inviting the bot into shared groups.
- Use `allowedUsers` and `allowedChats` for team deployments.
- Keep Codex sandbox set to `workspace-write` by default.
- Do not run the bridge from a sensitive directory such as `/`, `$HOME`, or a
  secrets folder.
- Rotate the Feishu/Lark App Secret if it is ever committed or pasted into a
  public channel.
