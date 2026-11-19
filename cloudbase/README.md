# 用自己的 CloudBase 部署「只此我们」

需要一个腾讯云开发环境、Node.js 22.12 或更高版本，以及 CloudBase CLI。以下命令从仓库根目录运行。将 `YOUR_ENV_ID` 换成自己创建的环境 ID。网站首次使用时数据库为空，两位使用者在网页上注册和配对即可。

## 1. 创建空环境和数据库

在[云开发控制台](https://tcb.cloud.tencent.com/)开通**文档型数据库**、云函数、云存储和静态网站托管，在环境概览中记下环境 ID、地域和托管域名。在数据库中建立下列集合。每创建一个集合，就打开权限设置，选择自定义安全规则，从 [database-rules.json](database-rules.json) 复制该集合对应的 `read` 和 `write` 对象。

| 客户端访问 | 集合 |
| --- | --- |
| 仅空间成员可读，写入通过云函数 | `couples`、`couple_members`、`memories`、`wishes`、`anniversaries`、`couple_notes`、`partner_notes` |
| 仅云函数可读写 | `users`、`messages`、`message_receipts`、`trash`、`hotel_reviews` |

在 `couples` 上创建 `inviteCode` 升序**唯一索引**，在 `couple_members` 上创建 `userId` 升序**唯一索引**。它们保证一个邀请码只对应一个空间、一个账号只能加入一个空间。其他集合使用默认的文档 ID 索引即可起步。

云存储使用私有存储桶，在权限设置中应用 [storage-rules.json](storage-rules.json)。网页通过 `mediaAccess` 取得指定文件的上传凭据或短时读取链接。在 Web 安全域名中添加自己的托管域名。本地联调时也添加实际使用的开发域名。若浏览器直接上传到 COS 时遇到跨域错误，在该存储桶的 CORS 配置中允许自己网站的源使用 POST、GET 和 HEAD。

## 2. 部署云函数和配置登录

安装 CLI 后登录腾讯云账号，再指定上一步的环境部署。仓库根目录的 [cloudbaserc.json](../cloudbaserc.json) 声明了全部 10 个事件型云函数、运行时及云端依赖安装方式。[CLI 部署说明](https://docs.cloudbase.net/cli-v1/functions/deploy)

```sh
npm install -g @cloudbase/cli
tcb login
tcb fn deploy --all -e YOUR_ENV_ID
```

在云函数的「权限控制」中应用 [function-rules.json](function-rules.json)。`webAuth` 接受登录前的注册和密码验证请求，其余 9 个函数只能由已登录的非匿名用户调用。若环境另有网关策略，也需要允许网页通过 SDK 访问相应函数。[函数访问控制](https://docs.cloudbase.net/cloud-function/security-rules)

在「身份认证 → 登录方式」启用**自定义登录**，下载此环境的登录私钥 JSON，放在仓库外。在 `webAuth` 的服务端环境变量中添加 `TCB_CUSTOM_LOGIN_KEY`，值为整个 JSON 文件的 Base64 编码。下面的 Node.js 命令在本机生成该值，输出须保密，仅粘贴到函数配置中。保存配置并确保新配置已生效。网页使用邮箱和密码注册、登录，邮箱仅作为账号名。此流程不发送邮箱验证邮件。[自定义登录说明](https://docs.cloudbase.net/authentication-v2/method/custom-login)

```sh
node -e "process.stdout.write(require('node:fs').readFileSync(process.argv[1]).toString('base64'))" "/path/to/tcb_custom_login.json"
```

如需 AI 助手，在 `aiAccess` 的服务端环境变量中填写自己的 `DEEPSEEK_API_KEY`，并允许该函数对外访问 `api.deepseek.com`。网站开放注册，每个注册用户都能建立自己的空间。启用 AI 后，有权使用的空间成员会消耗部署者的模型额度。使用 AI 功能时，相应的提问、草稿或所选空间的回忆文字会发给 DeepSeek。留空时仍可使用相册、同步和其他手账功能。

## 3. 构建和发布网页

将根目录的 [.env.example](../.env.example) 复制为 `.env.local`，填写以下四项。地域须与环境一致。浏览器使用环境的 **Publishable Key**，函数私钥和 AI 密钥只填写在上一步的服务端配置中。[客户端密钥说明](https://docs.cloudbase.net/api-reference/webv3/api-key)

```dotenv
VITE_DATA_PROVIDER=cloudbase
VITE_CLOUDBASE_ENV_ID=YOUR_ENV_ID
VITE_CLOUDBASE_REGION=ap-shanghai
VITE_CLOUDBASE_PUBLISHABLE_KEY=YOUR_CLIENT_PUBLISHABLE_KEY
```

```sh
npm ci
npm run build
tcb hosting deploy ./dist -e YOUR_ENV_ID
```

打开该环境提供的 HTTPS 托管地址。也可以把同一次构建生成的 `dist/` 发布到自己的 HTTPS 域名，并将该域名加入 Web 安全域名。[静态托管发布命令](https://docs.cloudbase.net/cli-v1/hosting)

## 4. 验收自己的部署

1. 在两个独立浏览器配置中分别注册测试账号。第一个账号创建空间，第二个账号输入页面上的 8 位邀请码。退出再登录，两人都应回到同一空间。
2. 一方新建带测试图片的回忆，另一方打开相册确认图片可见。试建纪念日、更新昵称并刷新，确认数据仍在。
3. 创建一条未来揭晓的留言，确认接收方到期前看不到正文。删除并恢复一条回忆，确认其回到时间线。第三个测试账号无法用同一邀请码加入已满的空间。
4. 启用了 AI 时，在空间中发起一次回忆问答。如果注册失败，先核对 `webAuth` 的调用权限、自定义登录私钥和环境 ID。如果登录后列表读取失败，核对各集合的名称与读取规则。
