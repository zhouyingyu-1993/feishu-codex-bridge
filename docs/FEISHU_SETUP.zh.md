# 接入飞书：一步一步来

## 1. 确认本机环境

进入项目目录：

```bash
cd "/Users/zhouyingyu/Desktop/2025年之前的/视频素材 云南德宏盈江县/feishu-codex-bridge"
```

确认 Node.js 和 Codex 都能运行：

```bash
node --version
codex --version
codex login
```

如果 `codex login` 已经登录过，可以跳过。

## 2. 启动桥

先用本地源码方式运行：

```bash
npm start
```

第一次运行会尝试显示飞书扫码二维码。用飞书 App 扫码，按页面提示创建或选择 PersonalAgent 应用。

成功后，配置会写到：

```text
~/.feishu-codex-bridge/config.json
```

## 3. 在飞书里测试

私聊机器人，发送：

```text
/help
```

再发送：

```text
/status
```

如果能收到卡片，说明飞书通道已经连上。

## 4. 设置项目目录

在飞书里发送：

```text
/cd /Users/你的用户名/你的项目目录
```

然后发一个简单任务：

```text
请看一下这个项目结构，告诉我它是做什么的
```

## 5. 设置管理员和白名单

先用 `/status` 或飞书后台确认你的 `open_id`，然后在飞书里发送：

```text
/config set admins ou_xxxxxxxxx
```

如果要限制只有你能用：

```text
/config set allowedUsers ou_xxxxxxxxx
```

如果要限制只有某些群能用：

```text
/config set allowedChats oc_xxxxxxxxx
```

## 6. 后台运行

确认前台运行正常后，再安装后台服务：

```bash
npm link
feishu-codex-bridge start
feishu-codex-bridge status
```

停止后台服务：

```bash
feishu-codex-bridge stop
```

彻底移除后台服务：

```bash
feishu-codex-bridge unregister
```

## 7. 常见问题

### 机器人没反应

先发：

```text
/doctor 机器人没有回复
```

再看本机日志：

```bash
ls ~/.feishu-codex-bridge/logs
```

### 群聊没反应

默认群里需要 `@机器人` 才响应。

如果想关闭这个要求：

```text
/config set requireMentionInGroup off
```

### Codex 没法改文件

确认你已经用 `/cd` 切到正确项目目录，并且 Codex 的 sandbox 是：

```text
workspace-write
```

