[English](./README.md) | 简体中文

# Forsaken Mail API

Forsaken Mail API 是基于 Forsaken-Mail 改造的临时邮箱项目，重点增强了 API 能力与自部署可用性。项目新增了 TempMail/MoeMail 兼容的收件接口、SQLite 持久化存储、多域名支持，以及更适合实际使用的 Web 界面，便于将其作为可自托管的临时邮箱服务来部署和二次开发。

## 项目截图

![Forsaken Mail API screenshot](./demo.png)

[在线演示](http://disposable.dhc-app.com)

## 安装

### 运行环境要求

- 推荐 Node.js 运行时：`22.x`
- Docker 镜像目标：`node:22-alpine`

项目依赖内置的 `node:sqlite` 模块，并包含一个 `postinstall` 兼容补丁，用于修复旧版 `mailin` / `smtp-server` 收件链路在较新 Node 运行时上的兼容问题。

### 正确配置 DNS

为了正常接收邮件，你需要让 SMTP 服务地址在 DNS 中可解析。假设你希望接收 `*@subdomain.domain.com` 的邮件：

- 首先添加 MX 记录：`subdomain.domain.com MX 10 mxsubdomain.domain.com`
- 然后添加 A 记录：`mxsubdomain.domain.com A 你的 mailin 服务器 IP`

你可以使用 [SMTP server tester](http://mxtoolbox.com/diagnostic.aspx) 来验证配置是否正确。

### 快速开始

普通方式：

```bash
npm install && npm start
```

如果你希望通过 Docker 运行：

```bash
docker build -t forsaken-mail-api .
docker run --name forsaken-mail-api -d -p 25:25 -p 3000:3000 forsaken-mail-api
```

然后在浏览器打开：

```text
http://localhost:3000
```

## MoeMail 兼容 API

这个 fork 新增了基于 SQLite 的收件端 API，目标是兼容 `moemail` 的核心收件箱接口。

### 已兼容的接口

- `GET /api/health`
- `POST /api/emails/generate`
- `GET /api/emails`
- `GET /api/emails/:id`
- `GET /api/emails/:id/:messageId`
- `DELETE /api/emails/:id`
- `DELETE /api/emails/:id/:messageId`

这个兼容层目前只覆盖收件箱 / 邮件查询流程，不包含 MoeMail 的用户体系、API Key、分享、配置管理和发信接口。

### 存储

收到的邮件会被保存到 SQLite 中，因此即使网页未连接，API 仍然可以查询历史邮件。

- 默认数据库路径：`./main.db`
- 可通过 `FORSAKEN_MAIL_DB_PATH` 覆盖
- 过期邮箱会在启动时和后台定时任务中自动清理
- 清理间隔可通过 `FORSAKEN_MAIL_CLEANUP_INTERVAL_MS` 设置，默认 `300000`

### 部署模板

复制 `./.env.example` 并按你的环境修改。

如果是服务器部署，建议从 `./.env.production.example` 开始。

推荐的起步配置：

```bash
PORT=3000
FORSAKEN_MAIL_DB_PATH=/data/main.db
FORSAKEN_MAIL_DOMAINS=temp.example.com
FORSAKEN_MAIL_CLEANUP_INTERVAL_MS=300000
FORSAKEN_MAIL_ADMIN_PASSWORD=
```

生产环境建议：

- 把 `FORSAKEN_MAIL_DB_PATH` 放到持久化存储路径
- 将 `FORSAKEN_MAIL_DOMAINS` 设置为你允许创建邮箱的准确域名
- `FORSAKEN_MAIL_CLEANUP_INTERVAL_MS` 建议保持在 `60000` 到 `300000` 之间
- 如果你希望保护 `temp_mail` 兼容管理接口，请设置 `FORSAKEN_MAIL_ADMIN_PASSWORD`；留空则跳过管理鉴权
- 如果公网暴露 Web/API 端口，建议放到反向代理或防火墙后面

### Docker Compose

仓库内提供了 `docker-compose.yml`，会直接构建当前 fork，而不是去下载上游源码。

快速启动：

```bash
cp .env.example .env
docker compose up -d --build
```

它会：

- 暴露 `3000` 用于 Web UI 和 API
- 暴露 `25` 用于 SMTP 收件
- 将 `./data` 挂载到容器内，保证 SQLite 可持久化
- 遵循 `.env` 中设置的 `FORSAKEN_MAIL_DB_PATH`
- 内置健康检查：`http://127.0.0.1:3000/api/health`

首次运行前建议：

- 在 `.env` 中设置 `FORSAKEN_MAIL_DOMAINS`
- 确保宿主机 `25` 端口可用
- 如果不想公开 Web UI，请将 `3000` 放到反向代理或防火墙之后

重要说明：

- `docker compose` 会自动读取项目目录下的 `.env` 文件
- 直接使用 `docker run` 时，不会自动读取项目目录中的 `.env`
- 使用 `docker run` 时，必须通过 `-e` 或 `--env-file` 显式传入环境变量

`docker run` 示例：

```bash
mkdir forsaken-mail-api && cd forsaken-mail-api
::copy source code in here

docker build --no-cache -t forsaken-mail-api .
docker run --name forsaken-mail-api -d \
  -p 25:25 -p 3000:3000 \
  -e FORSAKEN_MAIL_DOMAINS=sfz234.com,test.cc.cd \
  -e FORSAKEN_MAIL_DB_PATH=/data/mail.db \
  -v $(pwd)/data:/data \
  forsaken-mail-api
```

### 域名配置

API 会校验请求中的邮箱域名。默认情况下，它使用 `config-default.json` 中的 `host` 值。

默认情况下，`POST /api/emails/generate` 和 `POST /admin/new_address` 在 `domain` 不传或为空字符串时，会从当前已配置的可用域名里随机选择一个域名创建邮箱。如果你仍然需要旧的严格模式，可以在 `config-default.json` 中将 `randomDomainOnEmpty` 设为 `false`。

你也可以通过下面的环境变量覆盖：

```bash
FORSAKEN_MAIL_DOMAINS=mail.example.com,node.example.com
```

默认配置示例：

```json
{
  "randomDomainOnEmpty": true
}
```

### 支持的有效期

兼容层当前支持的 `expiryTime`：

- `3600000`（1 小时）
- `86400000`（24 小时）
- `259200000`（3 天）
- `0`（永不过期）

如果不传 `expiryTime`，默认值为 `86400000`（24 小时）。

### 邮箱名称行为

- `POST /api/emails/generate` 中的 `name` 是可选参数
- 如果传了 `name`，它必须匹配 `^[a-z0-9._-]+$`
- 如果 `name` 为空字符串、空白字符串或完全不传，服务端会自动生成合法的邮箱前缀

### 可选的 API Key 保护

为了兼容会发送 API Key 请求头的 MoeMail 风格客户端，本服务支持可选的 API Key 校验。

- 默认请求头：`X-API-Key`
- 通过 `FORSAKEN_MAIL_API_KEY` 配置密钥
- 如需自定义请求头名称，可通过 `FORSAKEN_MAIL_API_KEY_HEADER` 覆盖

如果 `FORSAKEN_MAIL_API_KEY` 未设置或为空，则 API 保持开放访问。

### temp_mail 兼容管理接口

本服务还提供了一组适配 `temp_mail` 协议的轻量管理接口，方便 Python 客户端通过管理接口创建邮箱并直接读取收到的邮件内容。

- `POST /admin/new_address`
- `GET /admin/mails`

管理鉴权规则：

- 请求头名称：`x-admin-auth`
- 通过 `FORSAKEN_MAIL_ADMIN_PASSWORD` 配置
- 如果 `FORSAKEN_MAIL_ADMIN_PASSWORD` 为空或未设置，则跳过鉴权

`POST /admin/new_address` 示例：

```bash
curl -X POST http://127.0.0.1:3000/admin/new_address \
  -H "x-admin-auth: YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "enablePrefix": true,
    "name": "demo1",
    "domain": "example.com"
  }'
```

响应示例：

```json
{
  "address": "demo1@example.com",
  "jwt": "some-user-token"
}
```

`GET /admin/mails` 示例：

```bash
curl "http://127.0.0.1:3000/admin/mails?limit=1&offset=0" \
  -H "x-admin-auth: YOUR_ADMIN_PASSWORD"
```

按邮箱过滤：

```bash
curl "http://127.0.0.1:3000/admin/mails?limit=20&offset=0&address=test@example.com" \
  -H "x-admin-auth: YOUR_ADMIN_PASSWORD"
```

响应示例：

```json
{
  "results": [
    {
      "id": "msg_1",
      "address": "test@example.com",
      "source": "OpenAI <noreply@tm.openai.com>",
      "subject": "Your OpenAI verification code",
      "text": "Your verification code is 123456",
      "html": "<p>Your verification code is <b>123456</b></p>",
      "raw": "Your verification code is 123456",
      "createdAt": 1710000000000,
      "created_at": 1710000000000
    }
  ],
  "total": 1
}
```

这个返回结构的目标是让 Python 客户端可以直接从 `text`、`html` 或 `raw` 中提取 OpenAI 的 6 位验证码。

## API 示例

### 创建邮箱

```bash
curl -X POST http://localhost:3000/api/emails/generate \
  -H "Content-Type: application/json" \
  -d '{
    "name": "demo123",
    "domain": "disposable.dhc-app.com",
    "expiryTime": 86400000
  }'
```

不指定 `name` 直接创建邮箱：

```bash
curl -X POST http://localhost:3000/api/emails/generate \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "disposable.dhc-app.com",
    "expiryTime": 86400000
  }'
```

响应示例：

```json
{
  "id": "email_1234567890abcdef",
  "email": "demo123@disposable.dhc-app.com"
}
```

### 查询邮箱列表

```bash
curl http://localhost:3000/api/emails
```

响应示例：

```json
{
  "emails": [
    {
      "id": "email_1234567890abcdef",
      "address": "demo123@disposable.dhc-app.com",
      "createdAt": 1774520000000,
      "expiresAt": 1774606400000
    }
  ],
  "nextCursor": null,
  "total": 1
}
```

### 查询单个邮箱的邮件

```bash
curl http://localhost:3000/api/emails/email_1234567890abcdef
```

响应示例：

```json
{
  "messages": [
    {
      "id": "msg_abcdef1234567890",
      "from_address": "sender@example.com",
      "to_address": "demo123@disposable.dhc-app.com",
      "subject": "Hello",
      "content": "plain body",
      "html": "<p>plain body</p>",
      "sent_at": null,
      "received_at": 1774520100000,
      "type": "received"
    }
  ],
  "nextCursor": null,
  "total": 1
}
```

### 查询单封邮件

```bash
curl http://localhost:3000/api/emails/email_1234567890abcdef/msg_abcdef1234567890
```

### 删除单封邮件

```bash
curl -X DELETE http://localhost:3000/api/emails/email_1234567890abcdef/msg_abcdef1234567890
```

### 删除整个邮箱

```bash
curl -X DELETE http://localhost:3000/api/emails/email_1234567890abcdef
```

## 替代 MoeMail

如果你的客户端只依赖 MoeMail 的收件端 API，这个项目可以作为替代方案，但需要注意几点：

- 继续使用 `/api/emails` 这组路径结构
- 使用上面列出的受支持 `expiryTime` 值
- 当前 `nextCursor` 可能仍为 `null`
- 不要调用 MoeMail 特有的 config、auth、API Key、share、send 等接口

实际迁移时，最简单的方式通常是：

1. 把客户端基础 URL 改到这个服务
2. 继续使用 `/api/emails/generate`、`/api/emails`、`/api/emails/:id`、`/api/emails/:id/:messageId`
3. 将 MoeMail 之外的接口做禁用或替换

## 健康检查与分页

### 健康检查

```bash
curl http://localhost:3000/api/health
```

响应示例：

```json
{
  "status": "ok",
  "storage": "sqlite"
}
```

### Cursor 分页

`GET /api/emails` 与 `GET /api/emails/:id` 支持：

- `limit`：分页大小，最大 `100`
- `cursor`：上一页返回的游标

示例：

```bash
curl "http://localhost:3000/api/emails?limit=10"
curl "http://localhost:3000/api/emails?limit=10&cursor=<cursor-from-previous-response>"
```

邮件列表同理：

```bash
curl "http://localhost:3000/api/emails/email_1234567890abcdef?limit=10"
curl "http://localhost:3000/api/emails/email_1234567890abcdef?limit=10&cursor=<cursor-from-previous-response>"
```

## 验证

运行测试：

```bash
npm test
```
