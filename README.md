# 奶了个奶（NaiLeGeNai）

《面向对象设计与分析》课程大作业：一个用 AI 编程代理分阶段协作开发的**三消堆叠消除**小游戏。

点一张没被压住的牌，它飞进底部槽位；同一种奶家角色凑满三张立即消除；槽位攒满 7 张而这一次没凑成三张就输了。

## 怎么玩

GitHub 网页上点开 `.html` 只会看到源码，**在线玩要先开 Pages，离线玩要先把仓库下载下来**。三种方式任选：

| 方式 | 操作 | 适合 |
|---|---|---|
| **① 在线玩** | 打开 <https://ytxz999.github.io/nailegenai/> | 什么都不想下载 |
| **② 下载整个仓库** | 仓库页右上 `Code → Download ZIP` → 解压 → 双击 `nailegenai/index.html` | 想看源码、交作业 |
| **③ 只要一个文件** | 下载 [`nailegenai-standalone.html`](nailegenai-standalone.html)（2.6 MB）→ 双击即玩 | 只想玩，不想解压 |

方式 ① 需要仓库管理员开一次 Pages（只做一次，之后永久有效）：

> `Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save`
> 约 1 分钟后 <https://ytxz999.github.io/nailegenai/> 生效。根目录的 `index.html` 只是把访问者转到 `nailegenai/index.html`。

三种方式都是纯前端：无构建、无依赖、无网络请求（`nailegenai-standalone.html` 把 CSS、JS、16 张牌面与背景图全部内联成了 data URI）。

- **项目说明**：[`nailegenai/README.md`](nailegenai/README.md)（玩法 / 三关难度 / 道具 / 存档 / 演示脚本 / 已知限制）
- **课程报告**：[`docs/06-项目报告.md`](docs/06-项目报告.md)

## 目录

| 路径 | 内容 |
|---|---|
| `nailegenai/` | 程序源码与素材（`src/model`、`src/engine`、`src/data`、`src/view`、`src/audio`、`styles`、`assets`） |
| `docs/01-项目提示词.md` | 驱动整个开发过程的提示词集（P00～P10） |
| `docs/02-需求分析.md` | 需求分析（26 FR / 13 BR / 9 NFR / 15 UC / 34 AC） |
| `docs/03-系统分析.md` | 系统分析（对象识别、职责、关系、用例协作、不变量） |
| `docs/04-系统设计.md` | 系统设计（四层架构、类设计、五大模式、数据与流程） |
| `docs/05-开发计划.md` | 六轮迭代计划、依赖、风险表、验收节奏 |
| `docs/06-项目报告.md` | **课程报告全文** |
| `docs/07-AI交互记录.md` | 21 条交互记录（提示词 / 输出摘要 / 人工反馈 / 后续动作） |
| `docs/diagrams/` | 6 个 PlantUML 源文件与导出的 PNG |
| `docs/images/` | 各阶段运行截图 |

## 运行环境

Chrome / Edge 最新版；`localStorage` 可用。无需 Node、无需服务器（想换浏览器或调试时可用 `python -m http.server`）。

## 说明

本项目的代码全部由 AI 编程代理按 `docs/01-项目提示词.md` 分阶段生成，人工只做三件事：提出约束、验收、反馈缺陷。
完整过程见报告第 3 章，缺陷与返工见第 4 章。
