# Supabase 初始化指南

此流程面向新建的 Supabase 项目。数据库负责限制每个账号可读写的双人空间，照片和视频保存在私有存储桶中。

## 建立数据库

1. 在自己的 Supabase 项目中启用 Data API，并将 `public` 加入暴露的 schema。保留 `private` 为非暴露 schema。
2. 在 SQL Editor 中按文件名升序执行 `migrations/` 下的全部 SQL 文件，每个文件在首次初始化时执行一次。遇到错误时先检查该文件的执行结果，再继续下一份。迁移会配置行级安全策略、私有存储桶 `couple-photos`、Realtime、邀请码和回收站。
3. 在 Authentication 中启用邮箱登录。将 Site URL 设为你的网站地址，把本地开发地址 `http://127.0.0.1:4173/**` 和计划使用的 HTTPS 回调地址加入允许列表。[数据 API 权限](https://supabase.com/docs/guides/api/securing-your-api) · [认证回调地址](https://supabase.com/docs/guides/auth/redirect-urls)

## 配置网页

复制仓库根目录的 `.env.example` 为 `.env.local`，填写自己的项目连接信息。浏览器只使用 Connect 面板提供的 Publishable Key。旧项目的客户端 anon key 同样可用。[Supabase API 密钥](https://supabase.com/docs/guides/api/api-keys)

```dotenv
VITE_DATA_PROVIDER=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_LAYOUT_PROVIDER=rules
```

重启 `npm run dev`，或使用这些变量重新构建静态网站。用两个独立的测试账号完成邮箱验证、创建空间和受邀加入。可用一篇测试回忆与一张测试照片检查两端同步，再用尚未加入的账号确认它只能看到自己的引导页。

## 可选的 AI 助手

`supabase/functions/aiAccess/` 包含后端函数。用户调用 AI 时，后端校验会话和空间成员身份，以该用户的权限读取本次任务所需的文字，然后调用 DeepSeek。使用前请让空间里的两个人了解这项数据处理。

在 Supabase 控制台的 Edge Function Secrets 中配置 `DEEPSEEK_API_KEY`。从仓库根目录使用已登录的 Supabase CLI 部署；将下面的项目引用替换为你自己的值。

```sh
npx supabase functions deploy aiAccess --project-ref YOUR_PROJECT_REF
```

部署时保留 `supabase/config.toml` 中的函数配置。函数在处理请求时通过 `auth.getUser(token)` 验证登录身份，并使用平台注入的连接信息。模型密钥与 Supabase 管理密钥都应留在服务端。[函数部署](https://supabase.com/docs/guides/functions/deploy) · [函数密钥](https://supabase.com/docs/guides/functions/secrets)
