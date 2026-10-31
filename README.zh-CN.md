# Yuque CLI

一个面向[语雀](https://www.yuque.com)的命令行客户端，提供两种使用方式：

- 面向人的交互式 REPL：浏览、搜索、打开和编辑文档
- 面向脚本与 Agent 的资源化 CLI：用标准 REST 语义管理知识库和文档

English: [`README.md`](README.md)

## 功能

- `repos`、`docs` 和通用 `api request` 资源命令
- 文档完整 CRUD：列表、读取、创建、更新、删除和搜索
- `--json` 输出，方便脚本和 Agent 消费
- Markdown 可直接传参、读文件或从 stdin 输入
- 统一错误类型和可预测的退出码
- 请求超时、GET 自动重试和分页参数
- 保留原交互式 REPL 与旧版命令

## 环境要求

- Node.js >= 18
- 语雀个人 Token

创建 Token：<https://www.yuque.com/settings/tokens>

## 安装

直接安装这个 fork：

```bash
npm install -g github:hi-unc1e/yuque-cli#main
```

或在本地开发：

```bash
git clone git@github.com:hi-unc1e/yuque-cli.git
cd yuque-cli
npm install
npm link
```

## 鉴权

推荐使用环境变量：

```bash
export YUQUE_TOKEN="your-token"
yuque auth status
```

CLI 也会读取 `~/.yuque/settings.json`。REPL 中仍可使用
`auth login` 和 `auth logout`。

## 快速开始

```bash
# 知识库
yuque repos list
yuque repos list --quiet
yuque repos get owner/repo

# 文档
yuque docs list owner/repo
yuque docs list owner/repo --offset 20 --limit 10
yuque docs get owner/repo doc-slug
yuque docs get owner/repo doc-slug --meta
```

从 Markdown 文件创建或更新：

```bash
yuque docs create owner/repo \
  --title "部署记录" \
  --slug deployment-notes \
  --body-file draft.md

yuque docs update owner/repo deployment-notes \
  --body-file draft.md \
  --json

cat draft.md | yuque docs update owner/repo deployment-notes --body-file -
```

删除文档时默认要求确认；在脚本中使用 `--yes`：

```bash
yuque docs delete owner/repo deployment-notes
yuque docs delete owner/repo deployment-notes --yes
```

搜索文档或直接调用 API：

```bash
yuque docs search "HID" --repo owner/repo
yuque api request GET /user
yuque api request GET /search \
  --query q=HID \
  --query type=doc \
  --query scope=owner/repo
```

`api request` 的路径相对于 `/api/v2`。

## REST 映射

| 语雀 API | CLI |
| --- | --- |
| `GET /user` | `yuque whoami` 或 `yuque auth status` |
| `GET /user/repos` | `yuque repos list` |
| `GET /repos/:namespace` | `yuque repos get <repo>` |
| `GET /repos/:namespace/docs` | `yuque docs list <repo>` |
| `GET /repos/:namespace/docs/:slug` | `yuque docs get <repo> <doc>` |
| `POST /repos/:namespace/docs` | `yuque docs create <repo>` |
| `PUT /repos/:namespace/docs/:id` | `yuque docs update <repo> <doc>` |
| `DELETE /repos/:namespace/docs/:id` | `yuque docs delete <repo> <doc>` |
| 任意接口 | `yuque api request <method> <path>` |

语雀读取文档时接受 slug 或 ID，但修改和删除接口要求数字 ID。
`docs update` 与 `docs delete` 会自动把 slug 解析成 ID；直接传数字 ID
则会跳过这次额外查询。

## JSON 与退出码

JSON 结果写入 stdout；错误写入 stderr。增加 `--json` 后会输出结构化错误：

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Not Found",
    "status": 404
  }
}
```

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | API、网络或一般错误 |
| `2` | 命令用法错误 |
| `3` | Token 缺失或无效 |
| `4` | 资源不存在 |
| `5` | 触发限流 |

## 交互模式

不传子命令时进入 REPL：

```bash
yuque
```

原有浏览、Markdown 分页、命令补全和文档编辑流程保持不变。

## 兼容命令

旧版单次命令继续可用：

```bash
yuque list repos
yuque list docs owner/repo
yuque open owner/repo/doc-slug
yuque show owner/repo/doc-slug
yuque search "HID" owner/repo
```

新脚本建议使用资源化命令。

## 环境变量

- `YUQUE_TOKEN`：语雀 API Token
- `YUQUE_ENDPOINT`：API 地址，默认 `https://www.yuque.com`
- `YUQUE_TIMEOUT_MS`：请求超时，默认 `30000`
- `YUQUE_RETRIES`：GET 重试次数，默认 `2`

## 开发

```bash
npm install
npm test
node src/index.js --help
```

## License

MIT
