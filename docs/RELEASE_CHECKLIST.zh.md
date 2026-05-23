# 发布前检查清单

## 本地检查

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

## 真实飞书检查

- 私聊 `/help` 能收到卡片。
- 私聊 `/status` 能显示 cwd 和 session。
- 群聊里 `@机器人 /help` 能响应。
- 群聊里不 @ 时默认不响应。
- `/cd <path>` 能切换目录。
- `/ws save demo`、`/ws list`、`/ws use demo` 能工作。
- 发图片后，Codex 能收到本地图片路径。
- `/stop` 能停止正在运行的 Codex。
- `/doctor` 能读取近期日志并给出建议。

## 安全检查

- `~/.feishu-codex-bridge/config.json` 没有被提交到 Git。
- 已设置 `/config set admins ...`。
- 团队群使用前已设置 `allowedUsers` 或 `allowedChats`。
- 没有把 sandbox 改成 `danger-full-access`，除非你非常确定。

## GitHub 检查

- README 首页显示正常。
- `README.zh.md` 中文说明可读。
- MIT License 识别正常。
- GitHub Actions 通过。
- `ACKNOWLEDGEMENTS.md` 保留了原项目致谢。

