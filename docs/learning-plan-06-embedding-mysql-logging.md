# 06-embedding-mysql-logging 模块学习计划

> 对应分支：`06-embedding-mysql-logging`（核心提交 `cf958cc`，外加两个环境修复提交）
> 前置分支：`03-env-services`（Docker 基础服务）、`04-structure-config`（配置管理）、`05-qdrant-es`（Qdrant / ES 接入）
> 建议周期：5 天，每天 1.5~2 小时

---

## 一、这个模块在项目中的位置

`掌柜问数` 是一个 NL2SQL 智能问答后端，整个教程用 03~17 号分支串起来。本分支是**基础设施客户端层的收尾**：

| 组件 | 角色 | 对应文件 |
|------|------|----------|
| MySQL × 2 | `meta` 元数据库（权威结构化元数据）+ `dw` 数仓模拟库（真正被查询的业务数据） | `app/clients/mysql_client_manager.py` |
| Embedding | 本地 TEI 推理服务，把文本转成 1024 维向量，供 Qdrant 语义召回 | `app/clients/embedding_client_manager.py` |
| Logging | loguru + contextvars，带 request_id 的结构化日志 | `app/core/log.py`、`app/core/context.py` |

后续 07+ 分支的元数据同步、混合召回、Agent 工作流，全都建立在这三个客户端之上。

## 二、学习目标（完成后你应能独立回答）

1. SQLAlchemy 2.0 异步栈里 Engine、连接池、Session 各自管什么？`pool_pre_ping`、`autoflush`、`expire_on_commit` 分别解决什么问题？
2. Embedding 是什么？为什么问数系统需要它？`bge-large-zh-v1.5` 的 1024 维和 Qdrant 配置里的 `embedding_size: 1024` 是什么关系？
3. `HuggingFaceEndpointEmbeddings` 为什么要手动替换 `client` / `async_client`？
4. `contextvars.ContextVar` 是怎么让每条日志自动带上 request_id 的？在 asyncio 并发下为什么它不会串？
5. 什么是 Client Manager 模式？为什么客户端不在模块导入时创建，而要延迟到 `init()`？

## 三、每日计划

### Day 1 —— 全景与配置回顾（~1.5h）

**做什么**
- 读 `README.md` 和架构图，弄清两条主线：知识构建链路（元数据 → MySQL+Qdrant+ES）与查询执行链路（召回 → 生成 SQL → 执行 → 流式返回）。
- 打开 `docker/mysql/meta.sql` 和 `dw.sql`，只看表结构：
  - `meta` 库：`table_info` / `column_info` / `metric_info` / `column_metric` —— 元数据知识库。
  - `dw` 库：`dim_region` / `dim_customer` / `dim_product` / `dim_date` / `fact_order` —— 典型星型模型数仓。
- 回顾 `app/conf/app_config.py`：OmegaConf `structured` schema + YAML 合并 → `to_object`，本分支所有客户端都是这份配置的消费方。

**检验**
- 能用一句话说清 `meta` 和 `dw` 两库的分工，以及为什么问数系统需要一个独立的元数据库。
- 能指出 `EmbeddingConfig` 里 `model: BAAI/bge-large-zh-v1.5` 和 `qdrant.embedding_size: 1024` 必须保持一致的原因。

### Day 2 —— MySQL 接入（~2h）

**知识点**
- SQLAlchemy 2.0 异步架构：`create_async_engine`（连接层，内含连接池）→ `async_sessionmaker`（会话工厂）→ `AsyncSession`（事务工作单元）。
- 连接串 `mysql+asyncmy://...`：方言 + 异步驱动；`charset=utf8mb4` 防中文乱码。
- 关键参数：`pool_size=10`（连接池大小）、`pool_pre_ping=True`（取连接前探活，防"MySQL server has gone away"）、`autoflush=True`、`expire_on_commit=False`（提交后对象不过期，避免异步下二次查询报错）。
- 原生 SQL 执行：`session.execute(text(sql))` → `result.mappings().fetchall()` 得到可按列名访问的行。

**动手**
1. `docker compose up -d mysql`，用客户端连上确认 `meta` / `dw` 两库已初始化。
2. 手写一遍 `mysql_client_manager.py`（不抄，对着理解写）。
3. 跑模块自测入口：`python -m app.clients.mysql_client_manager`，观察打印的类型。
4. 改造练习：把 SQL 换成 `select * from dim_product limit 5`；再试一次不加 `.mappings()`，对比结果结构差异。
5. 思考并验证：为什么模块底部要创建 `meta_mysql_client_manager` 和 `dw_mysql_client_manager` **两个**实例，而不是一个带切换能力的？

**自测**
- `close()` 里的 `engine.dispose()` 释放的是什么资源？
- `expire_on_commit=False` 如果改成默认值，提交后再访问对象属性会发生什么？

### Day 3 —— Embedding 接入（~2h）

**知识点**
- Embedding 的作用：把中文表注释/字段注释转成向量，才能做"语义相近"的召回（关键词匹配做不到"销售额≈GMV"）。
- TEI（Text Embeddings Inference）：HuggingFace 官方高性能推理服务，`docker-compose.yaml` 里 CPU 版监听容器 80 端口，映射宿主机 8081，模型走本地目录挂载（不联网下载）。
- `bge-large-zh-v1.5`：中文 embedding 模型，输出 1024 维 —— 这就是向量库集合维度必须配 1024 的原因。
- LangChain 统一接口：`embed_query`（查询单条）/ `embed_documents`（批量入库），以及 `aembed_*` 异步版本。
- 本地 TEI 兼容点（提交 `2e3e868`）：`HuggingFaceEndpointEmbeddings(model=...)` 默认把 `model` 当成 HF 云端模型 ID；这里先构造对象，再手动把底层 `client` / `async_client` 替换成指向 `http://host:port/embed` 的 `InferenceClient` —— 因为 `InferenceClient` 允许 `model` 参数直接传完整 URL。

**动手**
1. `docker compose up -d embedding`，然后 `curl -X POST http://localhost:8081/embed -H "Content-Type: application/json" -d '{"inputs":"销售额"}'` 确认服务可用（返回长度 1024 的数组）。
2. 跑 `python -m app.clients.embedding_client_manager`。
3. 小实验：用 `aembed_documents` 向量化 `["销售额", "GMV", "退款金额", "订单编号"]`，手写余弦相似度，验证"销售额"和"GMV"的相似度显著高于"销售额"和"订单编号"——这就是后面语义召回的物理基础。

**自测**
- `embed_query` 和 `embed_documents` 在 bge 这类模型里为什么不是同一个接口？（提示：非对称检索，查询侧与文档侧指令不同）
- 如果把 `qdrant.embedding_size` 配成 768 会发生什么？

### Day 4 —— 日志管理（~2h）

**知识点**
- loguru 相比标准 logging：零配置、`add()` 多 sink、格式即字符串模板、原生 rotation/retention。
- `logger.patch(inject_request_id)`：每条日志产生时执行钩子，从 `ContextVar` 取当前上下文的 request_id 写进 `record["extra"]`。
- `contextvars.ContextVar`（PEP 567）：Python 官方的"协程安全局部变量"。asyncio 每个任务有自己的上下文副本，并发请求各自 set 各自的值，互不干扰——这是后续多用户并发 API 不串日志的关键。
- 双 sink：控制台（开发/容器 stdout 采集）+ 文件（`rotation: 10 MB`、`retention: 7 days`、utf-8）。
- 默认值 `"1"` 是占位：真实 request_id 要等 15~17 分支的 API 层（中间件生成并 `set`）才有。

**动手**
1. 新建一个临时脚本：`request_id_ctx_var.set("test-42")` 后用 `from app.core.log import logger` 打几条日志，观察输出里的 request_id 变化。
2. 把 `conf/app_config.yaml` 里 console 的 `level` 改成 `DEBUG`，重启脚本观察差异。
3. 并发实验：用 `asyncio.gather` 起两个协程，各自 set 不同的 request_id 再打日志，验证互不覆盖。
4. 在 Day 2 的 MySQL 测试脚本里加两条 `logger.info`，体会"业务代码只管用 logger，request_id 自动注入"。

**自测**
- 为什么用 `ContextVar` 而不是全局变量或 `functools.local`？
- `logger.remove()` 那行不加会怎样？

### Day 5 —— 模式提炼与复盘（~1.5h）

**做什么**
- 横向对比三个 manager（MySQL / Qdrant / ES / Embedding），提炼 Client Manager 模式四要素：
  1. **配置注入**：`__init__` 只存 config，不碰网络；
  2. **延迟初始化**：真正的 `init()` 由应用启动阶段显式调用，避免 import 副作用、控制启动顺序；
  3. **模块级单例**：文件底部创建全局实例，全项目共享同一连接池/客户端；
  4. **自带 `__main__` 自测入口**：每个客户端模块可以独立运行验证，这是教程项目"每步可跑"的关键。
- 手画一张本分支模块图：`app_config.yaml → app_config → 4 个 Manager 单例 → (后续) Repository 层`。
- 复盘三个思考题：
  1. 为什么客户端不能在 `import` 时就创建？（配置加载时机、循环依赖、测试不友好、启动顺序）
  2. FastAPI 生产环境里 `init()` / `close()` 应该挂在哪？（lifespan 事件——17 分支会看到）
  3. `EmbeddingClientManager` 没有 `close()`，其它两个有，这算不算问题？HTTP 客户端与长连接客户端的资源语义差别是什么？
- 预习 `07-metadata-base-overview`：元数据基类与总览，开始把客户端"用起来"。

**通关标准**
- 不看代码，能画出本分支 4 个文件的类图与依赖关系；
- 能向别人讲清楚"一次问数请求"未来会如何穿过：API（生成 request_id）→ 日志贯穿 → 混合召回（Qdrant 向量 + ES 全文）→ MySQL 取权威元数据 → 查 dw 库执行 SQL。

## 四、常见坑（Windows / 本项目实测）

| 坑 | 现象 | 解法 |
|----|------|------|
| asyncmy 与 Python 3.14 不兼容 | 导入报错 / 编译失败 | 已升级 `asyncmy>=0.2.14`（提交 `66424a0`） |
| TEI 容器起不来 | 模型目录挂载不存在 | 需先准备 `docker/embedding/bge-large-zh-v1.5` 本地模型目录 |
| MySQL 中文乱码 | 注释/数据变问号 | compose 已加 `--character-set-server=utf8mb4`，连接串带 `charset=utf8mb4` |
| 日志文件乱码 | Windows 默认 GBK | `logger.add(..., encoding="utf-8")` 已处理 |
| 重复刷日志 | 同一条打两遍 | `logger.remove()` 移除默认 sink，本项目已处理 |

## 五、延伸阅读（按需）

- SQLAlchemy 2.0 —— Asyncio 支持（官方文档 "Using async with SQLAlchemy" 一节）
- PEP 567 —— Context Variables（理解 ContextVar 在 asyncio 中的传播规则）
- loguru README —— patch / bind / contextualize（`contextualize` 是另一种实现 request_id 的思路，可对比）
- BAAI/bge-large-zh-v1.5 model card —— 查询侧加指令的前缀约定
- HuggingFace TEI —— `/embed` 与 `/embed_all` 接口差异
