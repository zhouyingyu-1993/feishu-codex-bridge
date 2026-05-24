# feishu-codex-bridge

把飞书 / Lark 消息接到你本机的 Codex CLI。

这个项目的目标很直接：复刻
[`zarazhangrui/feishu-claude-code-bridge`](https://github.com/zarazhangrui/feishu-claude-code-bridge)
的使用体验，只是把原本在本地运行的 Claude Code 换成 Codex。

## 能做什么

- 飞书里不管是私聊、群里 @bot，还是发图片和文件，都能直接交给本机的 `codex` 命令。
- Codex 的进度可以通过飞书卡片、Markdown 流式消息，或最终文本形式返回。
- 每个聊天、话题和工作空间都有各自的 Codex 会话。
- 新消息一来就会打断当前 run，连着发得很快的消息会合并到下一次请求里。
- `/ws` 管理多个项目目录。
- 飞书图片和文件会下载到本地缓存，再把本地路径交给 Codex。
- `/help`、`/status`、`/ws list` 返回卡片。
- 支持前台运行和后台服务：`run/start/stop/restart/status/ps/kill/unregister`。
- 支持权限控制：用户白名单、群白名单、管理员。

## 前置条件

- Node.js 20+
- 已安装并登录 Codex CLI：

```bash
codex --version
codex login
```

- 一个飞书 / Lark PersonalAgent 应用。第一次运行时会尝试进入飞书 SDK 的扫码创建向导。

## 安装

```bash
npm install -g feishu-codex-bridge
```

本地开发：

```bash
git clone <your-repo-url>
cd feishu-codex-bridge
npm install
npm run check
npm test
```

## 第一次运行

```bash
feishu-codex-bridge run
```

如果没有配置文件，终端会显示二维码。用飞书扫码后，应用凭据会写入：

```text
~/.feishu-codex-bridge/config.json
```

也可以手动准备配置：

```bash
feishu-codex-bridge init
```

配置示例见 [`examples/config.example.json`](examples/config.example.json)。

更详细步骤见：

- [发布到 GitHub：一步一步来](docs/GITHUB_PUBLISH_STEPS.zh.md)
- [接入飞书：一步一步来](docs/FEISHU_SETUP.zh.md)
- [发布前检查清单](docs/RELEASE_CHECKLIST.zh.md)

## 飞书里的常用命令

| 命令 | 作用 |
| --- | --- |
| `/new`, `/reset` | 清空当前聊天的会话。 |
| `/cd <path>` | 切换当前工作目录，并重置会话。 |
| `/ws list` | 列出保存过的工作空间。 |
| `/ws save <name>` | 把当前目录保存成命名工作空间。 |
| `/ws use <name>` | 切换到命名工作空间，并重置会话。 |
| `/ws remove <name>` | 删除命名工作空间。 |
| `/status` | 查看 cwd、session、进程 id、偏好设置。 |
| `/config` | 查看配置和修改示例。 |
| `/config set <key> <value>` | 修改偏好。 |
| `/stop` | 停止当前 Codex run。 |
| `/timeout 10` | 当前会话 10 分钟无输出后自动停止。 |
| `/ps` | 列出本机 bridge 进程。 |
| `/exit <id|#>` | 停止指定 bridge 进程。 |
| `/reconnect` | 重新加载配置并重连飞书 WebSocket。 |
| `/doctor <描述>` | 把近期日志交给 Codex 诊断。 |
| `/help` | 帮助卡片。 |

其它 `/xxx` 会原样交给 Codex。

## 权限控制

默认是开放的：能找到 bot 的人都可能触发它。团队使用前建议先设置：

```text
/config set admins ou_xxxxxxxxx
/config set allowedUsers ou_xxx,ou_yyy
/config set allowedChats oc_xxx,oc_yyy
```

- `admins`：谁能改配置、切目录、停止进程、跑诊断。
- `allowedUsers`：哪些用户的消息会被接受。
- `allowedChats`：哪些群能触发 bot。私聊不受这个限制，方便你改错后救回来。

空列表表示不限制。

## 后台服务

```bash
feishu-codex-bridge start
feishu-codex-bridge status
feishu-codex-bridge stop
feishu-codex-bridge restart
feishu-codex-bridge unregister
```

映射关系：

- macOS：`~/Library/LaunchAgents/ai.feishu-codex-bridge.bot.plist`
- Linux：`~/.config/systemd/user/feishu-codex-bridge.bot.service`
- Windows：Task Scheduler 任务 `FeishuCodexBridge.Bot`

## 本地数据

```text
~/.feishu-codex-bridge/config.json       应用凭据和偏好
~/.feishu-codex-bridge/sessions.json     每个聊天的 Codex session
~/.feishu-codex-bridge/workspaces.json   工作空间和当前 cwd
~/.feishu-codex-bridge/processes.json    本机进程注册表
~/.feishu-codex-bridge/media/            下载的图片 / 文件，24 小时清理
~/.feishu-codex-bridge/logs/             JSONL 日志，7 天清理
```

## 安全提醒

这个桥会让飞书消息触发你本机的 Codex。Codex 可能读取或修改工作目录里的文件。
放进团队群之前，请先配置管理员和白名单。除非你很确定，不要把 sandbox 改成
`danger-full-access`。

## 当前状态

这是一个可开源的第一版实现：核心桥、Codex 适配器、会话/工作空间、命令、后台服务和文档都已搭好。正式发布前，建议用真实飞书租户跑一轮端到端测试，并根据租户卡片规则微调卡片 JSON。

## 许可

MIT

项目灵感来源见 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)。
