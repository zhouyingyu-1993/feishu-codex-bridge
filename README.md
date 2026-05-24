# feishu-codex-bridge

Bridge Feishu/Lark messages to your local Codex CLI.

This project is a Codex-oriented sibling of the idea behind
[`zarazhangrui/feishu-claude-code-bridge`](https://github.com/zarazhangrui/feishu-claude-code-bridge):
keep the Feishu/Lark bot experience, but run `codex exec` locally instead of
Claude Code.

## What It Does

- Forwards Feishu/Lark direct messages, group mentions, files, and images to a local `codex` CLI process.
- Streams Codex progress back to Feishu cards, markdown, or final text replies.
- Keeps one Codex session per chat/topic/workspace.
- Interrupts an active run when a new message arrives, then batches rapid messages into the next run.
- Supports named workspaces with `/ws`.
- Downloads Feishu images/files to local cache and passes local paths to Codex.
- Handles cloud-doc comment mentions and replies in the same comment thread.
- Can create Feishu/Lark cloud documents from chat requests and post the created document link back to the current conversation.
- Provides interactive cards for `/help`, `/status`, `/ws list`, and stop/status buttons.
- Supports host process commands: `run`, `start`, `stop`, `restart`, `status`, `ps`, `kill`, `unregister`, `migrate`.
- Supports Feishu slash commands: `/new`, `/reset`, `/cd`, `/ws`, `/status`, `/config`, `/stop`, `/timeout`, `/ps`, `/exit`, `/reconnect`, `/doctor`, `/help`.
- Includes optional access control for allowed users, allowed chats, and admins.

## Requirements

- Node.js 20+
- Codex CLI installed and logged in:

```bash
codex --version
codex login
```

- A Feishu/Lark PersonalAgent app. On first run, the bridge tries to open the Feishu SDK QR-code registration wizard.
- For cloud-doc comments, document creation, parent document search, or wiki-node creation, enable the relevant Feishu/Lark cloud-document, search, and comment permissions, and add the bot to the target document or wiki space.
- Optional: install `lark-cli` so Codex can call deeper Feishu/Lark commands when it needs more cloud-context.

## Install

```bash
npm install -g feishu-codex-bridge
```

For local development:

```bash
git clone <your-repo-url>
cd feishu-codex-bridge
npm install
npm run check
npm test
```

## First Run

```bash
feishu-codex-bridge run
```

If no config exists, a QR code is shown in the terminal. Scan it with Feishu/Lark,
create or select a PersonalAgent app, then the credentials are saved to:

```text
~/.feishu-codex-bridge/config.json
```

You can also create a config manually:

```bash
feishu-codex-bridge init
```

See [`examples/config.example.json`](examples/config.example.json).

Chinese step-by-step guides:

- [Publish to GitHub](docs/GITHUB_PUBLISH_STEPS.zh.md)
- [Feishu setup](docs/FEISHU_SETUP.zh.md)
- [Release checklist](docs/RELEASE_CHECKLIST.zh.md)

## Run As A Background Service

Install globally before using service commands, so the generated service points
to a stable CLI path.

```bash
feishu-codex-bridge start
feishu-codex-bridge status
feishu-codex-bridge stop
feishu-codex-bridge restart
feishu-codex-bridge unregister
```

Platform mapping:

- macOS: `~/Library/LaunchAgents/ai.feishu-codex-bridge.bot.plist`
- Linux: `~/.config/systemd/user/feishu-codex-bridge.bot.service`
- Windows: Task Scheduler task `FeishuCodexBridge.Bot`

## Slash Commands

| Command | Effect |
| --- | --- |
| `/new`, `/reset` | Clear the current chat session. |
| `/cd <path>` | Switch the current working directory and reset the session. |
| `/ws list` | List saved workspaces. |
| `/ws save <name>` | Save current cwd as a named workspace. |
| `/ws use <name>` | Switch to a named workspace and reset the session. |
| `/ws remove <name>` | Remove a named workspace. |
| `/status` | Show current cwd, session, process id, and preferences. |
| `/config` | Show preferences and examples. |
| `/config set <key> <value>` | Update preferences. |
| `/stop` | Stop the active Codex run. |
| `/timeout 10` | Stop a silent run after 10 minutes for this session. |
| `/timeout off` | Disable timeout for this session. |
| `/timeout default` | Return this session to the global default. |
| `/ps` | List running bridge processes on this host. |
| `/exit <id|#>` | Stop a bridge process. |
| `/reconnect` | Reload config and reconnect the Feishu WebSocket. |
| `/doctor <description>` | Feed recent bridge logs to Codex for diagnosis. |
| `/help` | Show help. |

Unknown `/xxx` commands are forwarded to Codex as normal prompts.

## Access Control

By default, the bot is open to anyone who can message it. For shared teams,
configure allowlists:

```text
/config set admins ou_xxxxxxxxx
/config set allowedUsers ou_xxx,ou_yyy
/config set allowedChats oc_xxx,oc_yyy
```

Meanings:

- `admins`: users allowed to run sensitive commands such as `/config`, `/cd`, `/ws`, `/exit`, `/doctor`.
- `allowedUsers`: users whose messages are accepted.
- `allowedChats`: group chats where the bot responds. Direct messages remain available so you can recover from a bad group allowlist.

Empty lists mean unrestricted.

## Data Files

```text
~/.feishu-codex-bridge/config.json       App credentials and preferences
~/.feishu-codex-bridge/sessions.json     Codex session id per chat/topic
~/.feishu-codex-bridge/workspaces.json   Named workspaces and per-chat cwd
~/.feishu-codex-bridge/processes.json    Local process registry
~/.feishu-codex-bridge/media/            Downloaded images/files, cleaned after 24h
~/.feishu-codex-bridge/logs/             JSONL runtime logs, cleaned after 7 days
```

## Codex Behavior

Fresh runs call:

```bash
codex exec --json --skip-git-repo-check -C <cwd> -o <last-message-file> -
```

Resumed runs call:

```bash
codex exec resume --json --skip-git-repo-check -o <last-message-file> <session-id> -
```

Images from Feishu are passed with `-i <local-image-path>` on fresh runs. Other
files are listed in the prompt as local paths.

## Security Notes

This bridge lets chat messages trigger a local coding agent that can read and
edit files in the configured workspace. Use allowlists before adding it to a
large group. Keep the default sandbox at `workspace-write` unless you have a
good reason to change it.

## Project Status

This is an open-source starter implementation. The core bridge, command model,
Codex adapter, workspace/session stores, daemon files, and documentation are in
place. Before a public release, test it with a real Feishu/Lark app in your
tenant and adjust card rendering if your tenant uses stricter card schema rules.

## License

MIT

See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for project inspiration.
