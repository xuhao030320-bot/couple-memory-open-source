# messageAccess 部署前置

该云函数是定时留言原文的唯一客户端出口，支持 `list` / `create` / `reply` / `delete` 四个动作。

安全上线顺序：

1. 先部署 `messageAccess`。
2. 确认 Web 和小程序新版都已调用该函数。
3. 将 CloudBase `messages` 集合的客户端规则设为：

```json
{
  "read": false,
  "write": false
}
```

第 3 步不可省略。如果仍允许客户端直接读取 `messages`，接收方可以绕过页面过滤，通过 SDK/抓包在 `revealAt` 前拿到 `text`。
