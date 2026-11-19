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

**CloudBase** 支持从空环境部署整套网站。仓库包含网页版使用的全部 10 个云函数、文档数据库和云存储权限规则。两人用自己的邮箱注册，通过邀请码共享相册、愿望、纪念日和留言。AI 助手可按需启用。[CloudBase 自部署指南](cloudbase/README.md)

## 可选功能

- **AI 助手**可以根据空间内的回忆回答问题或起草文案。启用并使用该功能时，后端会把当前操作所需的文字发送给 DeepSeek。模型密钥只配置在服务端。规则排版与本地手账可独立使用。[AI 配置](supabase/README.md#可选的-ai-助手)
- **地图选点**使用高德地图 Web JS API，可在 `.env.local` 中配置地图参数。前端设置会随网页分发，请在高德控制台限制允许的域名。地点也可以直接填写。

## 构建与测试

```sh
npm test
npm ci --prefix cloudfunctions/webAuth
npm run test:cloudbase
npm run build
npm run preview
```

`npm run build` 生成 `dist/`。将其部署到 HTTPS 站点根路径即可使用 PWA。Vercel 可选择 Vite 预设，构建命令为 `npm run build`，输出目录为 `dist`。云端模式的前端变量在构建时读取，修改后请重新构建。

## 许可证

项目代码采用 MIT 许可证。第三方依赖沿用各自的许可证。[LICENSE](LICENSE) · [第三方许可声明](THIRD_PARTY_NOTICES)
