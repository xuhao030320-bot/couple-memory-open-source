# 只此我们 · Couple Memory

为两个人做的私人手账。可以把照片、短视频和文字排成双页相册，在时间线上回看，也可以记录纪念日、共同愿望、备忘，以及约定某天才揭晓的留言。界面适配手机和桌面。

## 本地体验

安装 Node.js 22.12 或更高版本。在下载或克隆的源码根目录运行以下命令。

```sh
npm ci
npm run dev
```

打开 <http://127.0.0.1:4173>。首次打开会显示两篇带有“示例内容”标记的手账。点导航里的“记录”即可试写，文字和媒体保存在当前浏览器。清理站点数据会删除本地记录，可先在应用内导出含媒体的 ZIP 备份。

## 两个人跨设备使用

**Supabase** 提供邮箱登录、双人空间、私有媒体存储和实时同步。新建自己的项目，按初始化指南执行数据库迁移，再将项目 URL 与客户端 Publishable Key 写进本地 `.env.local`。两人分别注册，第一个账号创建空间，第二个账号通过邀请码加入。[Supabase 初始化指南](supabase/README.md)

**CloudBase** 适用于已有兼容后端的部署。这里包含 Web 适配器和 `dataAccess`、`messageAccess`、`trashAccess` 三个云函数。登录、配对、读取空间、更新资料和媒体访问还需要自行提供 `webAuth`、`invitePair`、`joinCouple`、`getMyWorkspace`、`updateMyProfile`、`mediaAccess` 与配套的数据库、存储权限规则。启用 AI 时还需要 `aiAccess`。已有这些服务时，在 `.env.local` 里设置 `VITE_DATA_PROVIDER=cloudbase`、自己的环境 ID 和客户端 Publishable Key。[配置示例](.env.example) · [留言读取规则](cloudfunctions/messageAccess/README.md) · [CloudBase 密钥类型](https://docs.cloudbase.net/api-reference/webv3/api-key)

部署这三个云函数时使用 Node.js 22.12 或更高版本，在各函数目录运行 `npm ci`。独立锁文件固定 SDK 及其 HTTP 客户端版本。

## 可选功能

- **AI 助手**可以根据空间内的回忆回答问题或起草文案。启用并使用该功能时，后端会把当前操作所需的文字发送给 DeepSeek。模型密钥只配置在服务端。规则排版与本地手账可独立使用。[AI 配置](supabase/README.md#可选的-ai-助手)
- **地图选点**使用高德地图 Web JS API，可在 `.env.local` 中配置地图参数。前端设置会随网页分发，请在高德控制台限制允许的域名。地点也可以直接填写。

## 构建与测试

```sh
npm test
npm run test:cloudbase
npm run build
npm run preview
```

`npm run build` 生成 `dist/`。将其部署到 HTTPS 站点根路径即可使用 PWA。Vercel 可选择 Vite 预设，构建命令为 `npm run build`，输出目录为 `dist`。云端模式的前端变量在构建时读取，修改后请重新构建。

## 许可证

项目代码采用 MIT 许可证。第三方依赖沿用各自的许可证。[LICENSE](LICENSE) · [第三方许可声明](THIRD_PARTY_NOTICES)
