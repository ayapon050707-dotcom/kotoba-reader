# 言间 Kotoba 2.0：iPad Safari 在线部署版

一个用 Vite + PDF.js + Tesseract.js + Vercel Serverless Functions 构建的轻量日语 PDF 阅读器。

## 新版功能

- iPad Safari、iPhone Safari 和桌面浏览器响应式阅读界面
- 本地打开 PDF，文字版支持选句，扫描版支持逐页日语 OCR 及识别后的文字选择
- 结合当前页与相邻页上下文进行中文翻译、整页翻译、GPT 文献问答
- 行标尺、聚焦线、页面背景与对比度、沉浸模式
- Vercel 原生 Serverless API，密钥只存在服务器环境变量中
- 额外的个人访问码 `KOTOBA_ACCESS_CODE` 保护 AI 请求（每次浏览器会话输入），可添加到 iPad 主屏幕

## 在线发布：使用 GitHub + Vercel，无需自己的电脑一直开机

1. 创建**私有** GitHub 仓库，上传解压后的项目全部文件（包括 `api/`、`lib/`、`src/`、`public/`、`package.json`、`vercel.json` 等）。不要上传 `.env`、`node_modules` 或 `dist`。
2. 访问 https://vercel.com/new ，连接 GitHub，选择仓库并导入。
3. 框架选择 `Vite`，Build Command 保持 `npm run build`，Output Directory 为 `dist`。
4. 在 Vercel > Project > Settings > Environment Variables 中新增以下变量，作用环境选 Production（预览也需要 AI 时一并选 Preview）：
   - `OPENAI_API_KEY`：自行在 OpenAI API 平台创建的 API Key
   - `OPENAI_MODEL`：`gpt-4.1-mini`（可选）
   - `KOTOBA_ACCESS_CODE`：自己设定的较长、随机、私密的访问码
5. 点击 Deploy，等状态变成 Ready 后用 Vercel 给出的 `https://...vercel.app` 地址在 iPad Safari 打开。如果是部署**后**才添加环境变量，记得在 Deployments 中 Redeploy。
6. 点击右上角「设置 AI 访问码」，输入第 4 步的 `KOTOBA_ACCESS_CODE`。导入 PDF 即可阅读。Safari 分享菜单 > 添加到主屏幕，方便下次进入。

> 不要把 OpenAI API Key 填入浏览器的访问码输入框！访问码和 API Key 是两种不同的秘密。不要把访问码与站点网址一起公开。访问码是一层简单的个人使用保护，并非企业级身份验证，不防暴力破解。建议在 Vercel 里额外启用 Deployment Protection / Authentication 或 WAF 速率限制、在 OpenAI 平台设置消费预算。不要处理特别敏感的文献。

## 本地运行

需要 Node.js 20.19+ / 22.12+。在项目目录：

```bash
npm install
cp .env.example .env
# 在 .env 里设置真实 OPENAI_API_KEY 和自定义 KOTOBA_ACCESS_CODE
npm run dev
```

本地网页在 http://localhost:5173 。

## 数据与限制

PDF 文件仅在你的浏览器内读取；OCR 也在浏览器本地进行（第一次需联网下载日语语言包）。主动调用 AI 时，会将本页文本及相邻页截取文本发送到网站后端，再转发给 OpenAI API。当前版本不存储 PDF 或聊天记录，刷新即消失。扫描 PDF 需要先 OCR，再在单独的文字视图选取句子。竖排日语、脚注、低分辨率图片可能识别不准；整页翻译当前最多处理约 11,500 字符。对 PDF 来说，页面的暖色背景/对比度是显示辅助，原始画面的颜色更改有限。请对照原文核查重要翻译。

## 安全建议

访问码保存在浏览器 sessionStorage 中，关闭浏览器会话后可能清除；同一浏览器会话中其他同源脚本理论上可访问。务必使用 HTTPS 的 Vercel 地址，不要将密钥写进 `src` 或 `public` 文件。项目没有服务端持久化或账户同步，暂未提供逐用户配额/日志审计。
