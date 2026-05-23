# 发布到 GitHub：一步一步来

下面假设项目目录是：

```bash
cd "/Users/zhouyingyu/Desktop/2025年之前的/视频素材 云南德宏盈江县/feishu-codex-bridge"
```

## 1. 先修复 GitHub 登录

当前电脑上有 GitHub CLI，但登录令牌已经失效。运行：

```bash
gh auth login -h github.com
```

推荐选择：

1. `GitHub.com`
2. `HTTPS`
3. `Login with a web browser`
4. 按终端提示复制验证码，到浏览器里确认授权

完成后检查：

```bash
gh auth status
```

看到账号登录成功即可。

## 2. 创建远程仓库并推送

如果你想让仓库公开：

```bash
gh repo create feishu-codex-bridge --public --source=. --remote=origin --push
```

如果你想先设为私有：

```bash
gh repo create feishu-codex-bridge --private --source=. --remote=origin --push
```

推送成功后，GitHub 会显示仓库网址。

## 3. 在 GitHub 页面上检查

打开仓库页面，确认：

- README 能正常显示。
- `README.zh.md` 存在。
- GitHub Actions 里有 `CI` 工作流。
- `LICENSE` 显示为 MIT。

## 4. 如果你想改提交身份

刚才的本地提交使用了电脑自动推断的作者信息。如果你想改成 GitHub 邮箱：

```bash
git config user.name "你的 GitHub 昵称"
git config user.email "你的 GitHub 邮箱"
git commit --amend --reset-author
git push --force-with-lease
```

如果这是第一次推送，最后一行可以不用。

## 5. 后续更新怎么推

每次修改后：

```bash
git add .
git commit -m "Describe your change"
git push
```

