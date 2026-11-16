# 07-metadata-base-overview 模块学习计划（详细版）

> 对应分支：`07-metadata-base-overview`（核心提交 `820d482` 建骨架 + `36d7714` 代码优化）
> 前置分支：`06-embedding-mysql-logging`（四个基础客户端 + 日志）
> 建议周期：4 天，每天 1.5~2 小时
> 分支性质：**骨架分支** —— 所有类、方法、配置全部就位，但 `build()` 只打印日志；真正的入库、向量索引、全文索引在 08/09 分支补齐

---

## 一、这个分支在项目中的位置

06 分支收尾了"基础设施客户端层"（MySQL×2 / Qdrant / ES / Embedding / 日志）。07 开始把这套基础设施**用起来**，第一次出现业务分层：

```
app/scripts/build_meta_knowledge.py        ← 组装层（controller）：解析命令行、创建一切、启动链路
        │
app/services/meta_knowledge_service.py     ← 业务编排层：读配置、判断走哪条构建链路
        │
app/repositories/mysql/meta/…  mysql/dw/…  ← 数据访问层：分别包住 meta / dw 两个 AsyncSession
        │
app/clients/mysql_client_manager.py        ← 连接层（06 已有）：engine + session 工厂

app/models/*.py                            ← ORM 模型（4 张 meta 表的映射，供 08 分支写入用）
conf/meta_config.yaml → MetaConfig         ← 声明"这次构建要同步哪些表、字段、指标"
```

两条构建链路（本分支只留了 `if` 占位）：

- **tables 链路**（08/09 分支实现）：dw 库读真实表结构 → 写 `table_info`/`column_info` → 字段说明向量化进 Qdrant → `sync: true` 字段的取值进 ES 全文索引
- **metrics 链路**（后续分支实现）：指标写 `metric_info`/`column_metric` → 指标说明向量化

## 二、学习目标（完成后你应能独立回答）

1. SQLAlchemy 2.0 的 `DeclarativeBase` / `Mapped` / `mapped_column` 各自干什么？`Mapped[str | None]` 为什么等价于可空列？
2. 四张元数据表的主键为什么不用自增 id，而是"表名"、"表名.字段名"、"指标编码"这种业务主键？
3. `examples`/`alias`/`relevant_columns` 为什么用 JSON 列而不是拆子表？表间为什么不用物理外键？
4. `ColumnConfig.sync` 这个布尔值控制的是什么？为什么只有维度列是 `true`？
5. Repository 模式下，为什么 Repository 只存 session、不管连接生命周期？
6. OmegaConf 四步法 `load → structured → merge → to_object` 每一步的输入输出是什么？为什么不直接 `OmegaConf.load` 完事？
7. 脚本入口的依赖注入链 `manager → session → repository → service` 是怎么一层层组装起来的？`async with (A, B)` 是什么语法？

## 三、逐文件逐方法精讲

### 3.1 `app/models/base.py` —— ORM 基类

```python
class Base(DeclarativeBase):
    pass
```

- **干什么用**：SQLAlchemy 2.0 的声明式基类。所有 ORM 模型继承它之后，SQLAlchemy 会自动把每个子类登记进 `Base.metadata`（一张"表名 → 表结构"的注册表）。
- **和 1.x 写法的区别**：老版本用 `Base = declarative_base()` 函数式创建；2.0 推荐继承 `DeclarativeBase` 类，类型提示更友好。
- **本项目注意点**：meta 库的表是 `docker/mysql/meta.sql` 手写 DDL 建的，**不是**用 `Base.metadata.create_all()` 生成的。ORM 模型只是"映射"到已存在的表，两边字段一一对应（可对照 DDL 看）。项目里没有 migration 的概念。

### 3.2 四个 ORM 模型 —— 逐字段逐参数

#### `table_info.py` → `TableInfoMySQL`（表级元数据）

| 字段 | 类型 | 参数 | 说明 |
|------|------|------|------|
| `id` | `Mapped[str]` | `String(64)`, `primary_key=True` | **直接用表名当主键**（如 `dim_region`） |
| `name` | `Mapped[str \| None]` | `String(128)` | 表名称 |
| `role` | `Mapped[str \| None]` | `String(32)` | `fact`（事实表）/ `dim`（维度表） |
| `description` | `Mapped[str \| None]` | `Text` | 表描述，给 LLM 和向量化用 |

#### `column_info.py` → `ColumnInfoMySQL`（字段级元数据）

| 字段 | 类型 | 参数 | 说明 |
|------|------|------|------|
| `id` | `Mapped[str]` | `String(64)`, PK | **"表名.字段名"**（如 `fact_order.order_amount`），全库唯一 |
| `name` | `Mapped[str \| None]` | `String(128)` | 列名 |
| `type` | `Mapped[str \| None]` | `String(64)` | 数据类型（08 分支从 dw 库 `information_schema` 查来） |
| `role` | `Mapped[str \| None]` | `String(32)` | `primary_key` / `foreign_key` / `measure` / `dimension` |
| `examples` | `Mapped[dict \| list \| None]` | `JSON` | 字段示例值（列表直接存 JSON，不拆子表） |
| `description` | `Mapped[str \| None]` | `Text` | 列描述 |
| `alias` | `Mapped[dict \| list \| None]` | `JSON` | 列别名（"销售额" ↔ `order_amount`） |
| `table_id` | `Mapped[str \| None]` | `String(64)` | 所属表编号 = `table_info.id`，**逻辑外键** |

#### `metric_info.py` → `MetricInfoMySQL`（指标元数据）

| 字段 | 类型 | 参数 | 说明 |
|------|------|------|------|
| `id` | `Mapped[str]` | `String(64)`, PK | 指标编码（如 `GMV`） |
| `name` | `Mapped[str \| None]` | `String(128)` | 指标名称 |
| `description` | `Mapped[str \| None]` | `Text` | 指标描述 |
| `relevant_columns` | `Mapped[dict \| list \| None]` | `JSON` | 关联字段列表，元素就是 `column_info.id`（`fact_order.order_amount`）—— **ID 体系打通的关键** |
| `alias` | `Mapped[dict \| list \| None]` | `JSON` | 指标别名 |

#### `column_metric.py` → `ColumnMetricMySQL`（字段↔指标关系表）

| 字段 | 参数 | 说明 |
|------|------|------|
| `column_id` | `String(64)`, `primary_key=True` | 列编号 |
| `metric_id` | `String(64)`, `primary_key=True` | 指标编号 |

- **联合主键**：两个字段都标 `primary_key=True`，SQLAlchemy 自动组成复合主键 —— 同一对（字段, 指标）关系只允许存一次，天然去重。
- 这张表就是"多对多"的中间表：一个指标关联多个字段，一个字段也可能被多个指标引用。

#### 横向重点（四个模型共通的设计决策）

1. **业务主键而非自增**：id 都是可预先确定的字符串。好处：
   - 重复构建幂等 —— 同样的配置跑多少遍，主键不变，可以无脑覆盖写；
   - 跨存储对齐 —— 08/09 分支里同一个 id 还会当 Qdrant 的 point id、ES 的 doc id，三边天然对得上；
   - 人可读，排查问题直接看得出是哪张表哪个字段。
2. **`Mapped[str | None]` = 可空列**：注解里带 `| None`，ORM 推断出 `nullable=True`；`Mapped[str]`（不带 None）且标了 `primary_key=True` 就是 NOT NULL。
3. **`mapped_column()` 常用参数**：第一个位置参数是列类型（`String(64)`=VARCHAR(64)、`Text` 长文本、`JSON` 自动把 list/dict 序列化成 JSON 存储）；`primary_key=True` 主键；`comment="…"` 写进 DDL 注释，纯文档作用，和 meta.sql 里的 COMMENT 一一对应。
4. **不用物理外键（ForeignKey）**：`table_id`/`column_id`/`metric_id` 只是字符串约定，不在数据库层建 FK 约束。元数据库的内容完全由构建脚本从 YAML 同步而来，一致性由**构建流程**保证而不是数据库；也避免写入时必须按依赖顺序、删数据被约束挡住的问题。

### 3.3 `app/conf/meta_config.py` —— 构建配置的 dataclass

这份配置和 `app_config.yaml`（描述基础设施）不同，它描述的是**一次构建任务要处理什么**。四个 dataclass：

```python
@dataclass
class ColumnConfig:      # 一个字段
    name: str            # 字段名（dw 库里的真实列名）
    role: str            # primary_key / foreign_key / measure / dimension
    description: str     # 业务说明 —— 将来向量化的原料
    alias: list[str]     # 别名列表 —— 扩展召回（"销售额"也能命中 order_amount）
    sync: bool           # 是否把该字段的真实取值同步进 ES 全文索引

@dataclass
class TableConfig:       # 一张表
    name: str            # 表名（同时就是 table_info.id）
    role: str            # fact / dim
    description: str
    columns: list[ColumnConfig]   # 嵌套结构，和 YAML 缩进对应

@dataclass
class MetricConfig:      # 一个指标
    name: str            # 指标编码（同时就是 metric_info.id）
    description: str
    relevant_columns: list[str]   # 元素是 "表名.字段名" = column_info.id
    alias: list[str]

@dataclass
class MetaConfig:        # 总配置
    tables: Optional[list[TableConfig]] = None   # 允许缺省 → 支持只构建指标
    metrics: Optional[list[MetricConfig]] = None # 允许缺省 → 支持只构建表
```

**重点**：
- `tables` / `metrics` 默认 `None` 是刻意设计：YAML 里可以只写一段，服务层用 `if meta_config.tables:` 判断走不走那条链路 —— 配置文件即"构建任务清单"。
- 和 `app_config` 的加载时机对比：`app_config` 在**模块导入时**一次性加载成全局单例（所有模块共享）；`MetaConfig` 在**每次运行 `build()` 时**根据命令行传入的路径现场加载 —— 配置是函数入参，不是全局状态。同一套 OmegaConf 四步法，两种用法。

### 3.4 `conf/meta_config.yaml` —— 星型模型的知识声明

结构：5 张表（4 张 dim + 1 张 fact，典型**星型模型**）+ 2 个指标。读的时候盯住三个规律：

1. **表 role**：维度表 `dim`（region/customer/product/date），事实表 `fact`（order，含外键和度量）。
2. **字段 role 与 sync 的搭配**（本文件最有信息量的设计）：

   | 字段 role | sync 取值 | 原因 |
   |-----------|-----------|------|
   | `primary_key` / `foreign_key` | 全部 `false` | id 值本身没有召回意义 |
   | `measure`（order_quantity/order_amount） | `false` | 数值度量，取值无限，进全文索引没意义 |
   | `dimension` 且取值可枚举（省份/大区/国家/品类/品牌/性别/会员等级/季度/customer_name/product_name） | `true` | **低基数字段**：真实取值（"华东"、“手机”）入 ES 后，用户问题里的具体词才能直接命中字段 |
   | `dimension` 但取值太细（year/month/day） | `false` | 基数过高（每一天一个值），同步不划算 |

   一句话：**sync 问的是"这个字段的值，值不值得被全文检索"**。
3. **alias 是召回桥**：用户不会说 `order_amount`，会说"销售额"；alias 列表在后续混合召回里把口语词接到字段上。GMV 的别名配了"成交总额、订单总额"同理。

**思考题**：AOV（平均订单价值 = 总金额 ÷ 订单数）的 `relevant_columns` 配的是 `fact_order.order_quantity`，严格来说更合理的是 `order_amount`（和订单计数）—— 你觉得这是教程笔误还是简化？如果配错，后续"从指标找依赖字段"的链路会出什么问题？

### 3.5 repositories —— Repository 模式

```python
class MetaMySQLRepository:
    def __init__(self, session: AsyncSession):
        self.session = session     # 外部创建、外部关闭，仓储只管用

class DWMySQLRepository:           # 结构完全同构
    def __init__(self, session: AsyncSession):
        self.session = session
```

- **`__init__(session: AsyncSession)`**：唯一参数是一个已经打开的异步会话。当前两个类都还没有别的方法 —— 本分支只占位。
- **为什么不管连接生命周期**：session 的创建/关闭权在脚本入口（`async with`），Repository 只是一个"数据访问方法的容器"。好处：
  1. 职责单一 —— 仓储里只有 SQL 逻辑，没有资源管理逻辑；
  2. 可测试 —— 测试时可以传入构造好的假 session；
  3. 事务边界由上层控制 —— 多个仓储操作可以共享同一个事务。
- **将来放什么**（对着分支路线图理解）：
  - `MetaMySQLRepository`（08）：`table_info`/`column_info`/`metric_info`/`column_metric` 的写入；
  - `DWMySQLRepository`（08）：查 `information_schema` 拿字段类型、抽样拿示例值；（14）执行/校验 Agent 生成的 SQL。

### 3.6 `app/services/meta_knowledge_service.py` —— 业务编排层

#### `__init__(meta_mysql_repository, dw_mysql_repository)`

构造器注入：两个仓储作为参数传进来存成属性。服务层不自己创建 session、不自己连数据库 —— 它拿到的永远是"装配好的"仓储。

#### `build(config_path: Path)` —— 唯一的业务方法，五步

```python
context = OmegaConf.load(config_path)                      # ①
schema = OmegaConf.structured(MetaConfig)                  # ②
meta_config: MetaConfig = OmegaConf.to_object(
    OmegaConf.merge(schema, context))                      # ③④
```

**OmegaConf 四步法**（和 `app_config.py` 一模一样的模板，第二次出现，必须吃透）：

| 步骤 | 函数 | 输入 → 输出 | 干什么 |
|------|------|------------|--------|
| ① | `OmegaConf.load(path)` | 文件路径（str/Path）→ `DictConfig` | 把 YAML 读成配置对象，此时**没有任何类型信息** |
| ② | `OmegaConf.structured(MetaConfig)` | dataclass 类 → `DictConfig` | 按 dataclass 生成一份"空壳 schema"，字段类型、默认值（`None`）都来自类定义；且开启 struct 模式 —— **YAML 里出现 dataclass 没定义的 key 会直接报错**（防手滑写错段落名） |
| ③ | `OmegaConf.merge(schema, context)` | 两个 DictConfig → 一个 | 值合并：YAML 有值的用 YAML，没写的段落回落到 schema 默认值（`tables=None`）。顺序不能反：**schema 在前、值在后** |
| ④ | `OmegaConf.to_object(…)` | 合并后的 DictConfig → 真正的 `MetaConfig` 实例 | 递归转成 dataclass 对象（嵌套的 `TableConfig`/`ColumnConfig` 也一并转好），之后 `meta_config.tables[0].columns[1].alias` 全程有类型提示 |

**为什么不 ①完事就完事**：只有 ① 的话，写错 key 不报错、没有默认值、IDE 无补全、访问方式还是字符串索引。四步法 = 校验 + 默认值 + 类型化，一气呵成。

```python
if meta_config.tables:   # ⑤ 表链路占位
    logger.info("检测到 tables 配置，表链路入口已准备就绪")
    …
if meta_config.metrics:  # ⑥ 指标链路占位
    logger.info("检测到 metrics 配置，指标链路入口已准备就绪")
    …
```

- ⑤⑥ 是**空壳分支**：本分支只证明"配置能被正确解析、链路入口能被正确触发"，真正的构建逻辑后续填。
- 注意判空技巧：`Optional[list] = None` 时用 `if meta_config.tables:`（None 和空列表都跳过），而不是 `is not None`。

### 3.7 `app/scripts/build_meta_knowledge.py` —— 脚本入口（组装根）

#### `async def build(config_path: Path)` —— 七步装配

```python
meta_mysql_client_manager.init()      # ①
dw_mysql_client_manager.init()        # ②
```
- 调 06 分支写好的 `init()`：创建 `AsyncEngine`（连接池）+ `async_sessionmaker`。注意 `init()` 不碰网络，只是把"连接能力"准备好。
- 两个单例连的是**同一个 MySQL 实例的不同 database**（meta / dw，见 `app_config.yaml`），连接池各自独立。

```python
async with (
    meta_mysql_client_manager.session_factory() as meta_session,   # ③
    dw_mysql_client_manager.session_factory() as dw_session,       # ④
):
```
- **括号形式的多上下文管理器**（Python 3.10+ 语法，PEP 617 系列）：`async with (A, B):` 等价于嵌套两层 `async with`，进入顺序 meta→dw，退出顺序 dw→meta。项目跑 Python 3.14，放心用。
- `session_factory()` 每次调用产生一个**新的** `AsyncSession`；`async with` 保证块结束自动 `close()`（把连接还回池子）。

```python
meta_mysql_repository = MetaMySQLRepository(meta_session)   # ⑤
dw_mysql_repository = DWMySQLRepository(dw_session)
meta_knowledge_service = MetaKnowledgeService(meta_mysql_repository, dw_mysql_repository)  # ⑥
await meta_knowledge_service.build(config_path)             # ⑦
```
- ⑤⑥⑦ 就是完整的**依赖注入链**：入口层组装 client → session → repository → service，再调用唯一的业务方法。每一层只通过构造函数参数认识下一层，没有任何全局查找。
- 这个文件因此被称为 **composition root（组装根）**：整个程序"谁创建谁"只在这一次说清，其余各层互不知晓构造细节 —— 也方便单测时逐层替换成假对象。

```python
await meta_mysql_client_manager.close()   # ⑧ 在 with 块之外
await dw_mysql_client_manager.close()
```
- `close()` 里是 `engine.dispose()`，释放整个连接池。**必须写在 `async with` 之后**：session 还没还回去就 dispose 连接池，等于拆了正在住的房。

#### `__main__` 部分

```python
parser = argparse.ArgumentParser()
parser.add_argument("-c", "--conf")     # 短选项 -c，长选项 --conf，解析后存进 args.conf
args = parser.parse_args()
asyncio.run(build(Path(args.conf)))     # 创建事件循环 → 运行协程 → 关闭循环
```
- `add_argument("-c", "--conf")`：短/长选项等价；没加 `required=True`，所以漏传 `-c` 时 `args.conf` 是 `None`，`Path(None)` 会抛 `TypeError`（见常见坑）。
- `asyncio.run(...)`：标准入口写法，自动建 loop、跑完清理。

**运行方式**（项目根目录）：

```bash
uv run python -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml
```

预期输出（本分支的正确结果就是这 7 条日志，库里不会有任何写入）：

```
INFO | 加载配置文件
INFO | 检测到 tables 配置，表链路入口已准备就绪
INFO | 表信息与字段信息构建流程后续继续补充
INFO | 字段向量索引与字段值全文索引逻辑后续继续补充
INFO | 检测到 metrics 配置，指标链路入口已准备就绪
INFO | 指标入库与指标向量索引逻辑后续继续补充
INFO | 当前阶段完成：配置加载与元数据知识库构建骨架准备
```

### 3.8 其余改动（了解即可）

- `app/clients/mysql_client_manager.py`：142 行 diff 全是**注释和 docstring 重写**，代码逻辑零变化（双实例 06 就有）。`__main__` 自测入口查的是 dw 库 `fact_order`：`uv run python -m app.clients.mysql_client_manager`。
- `qdrant` / `es` / `embedding` / `context` / `log` 各补了一段 docstring，**声明它们在元数据知识库里的角色**（Qdrant=字段/指标向量，ES=字段值全文索引，Embedding=说明文本向量化）—— 值得读，是理解全图的注释。
- `main.py`：占位入口，说明当前可执行逻辑都在 `app/scripts` 下。
- `pyproject.toml`：ruff 增加 `ignore = ["E501"]`（行超长），因为中文注释一行经常超过 88 字符。

## 四、每日计划

### Day 1 —— 分层全景 + ORM 模型（~2h）

**做什么**
- 先读 `README.md` 架构图和本文档第一节，画出五层结构图（scripts → services → repositories → clients ← models / meta_config）。
- 精读 `app/models/` 五个文件，同时开着 `docker/mysql/meta.sql` **逐字段对照**，确认 ORM 和 DDL 一一映射。
- 搞懂三个共通设计：业务主键、`Mapped[... | None]` 可空、JSON 列 + 无物理外键。

**检验**
- 能说出 `column_info.id`、`metric_info.relevant_columns` 的元素、`column_metric.column_id` 三者用的是同一个 ID 体系（`表名.字段名`），以及为什么这么设计。
- 能解释联合主键怎么实现"同一对关系只存一次"。

### Day 2 —— 配置体系（~2h）

**做什么**
- 精读 `app/conf/meta_config.py` 四个 dataclass，再通读 `conf/meta_config.yaml` 全文（176 行，逐表过）。
- 自己总结 `sync: true/false` 的规律表（见 3.4），验证每个字段的取值是否符合规律。
- 对照 `app/conf/app_config.py`：同样是 OmegaConf 四步法，一个模块级加载成单例、一个每次 build 现场加载，想清楚各自为什么。

**检验**
- 能回答：`app_config.yaml` 和 `meta_config.yaml` 一个描述"环境长什么样"、一个描述"任务要做什么"，为什么值得分成两份文件、两套加载时机。
- 思考题（AOV 的 relevant_columns）有自己的结论。

### Day 3 —— Repository + Service（~2h）

**做什么**
- 精读两个 repository（内容很少，重点是模式），思考"session 谁创建谁关闭"。
- 精读 `MetaKnowledgeService.build()`，把 OmegaConf 四步法的表格自己默写一遍。
- 动手小实验（在 REPL 或临时脚本里）：
  ```python
  from omegaconf import OmegaConf
  from app.conf.meta_config import MetaConfig
  ctx = OmegaConf.load("conf/meta_config.yaml")
  # 只 load 不 merge：访问 ctx.tabless（故意拼错）会怎样？
  # merge+to_object 之后：meta_config.tables[0].columns[1].alias 是什么？
  ```

**检验**
- 能说清 `structured` 带来的两个好处（struct 拦截未知 key + 默认值回落）。
- 能解释 `if meta_config.tables:` 和 `if meta_config.tables is not None:` 在这里的行为差异。

### Day 4 —— 脚本入口 + 全链路运行（~2h）

**做什么**
- 精读 `build_meta_knowledge.py` 的 `build()` 七步，重点是 `async with (A, B)` 语法和 ⑧ 为什么在 with 之外。
- 实际运行（MySQL 容器已在跑）：
  ```bash
  uv run python -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml
  uv run python -m app.clients.mysql_client_manager
  ```
- 实验矩阵：
  1. 把 yaml 复制一份删掉 `metrics:` 段 → 重跑，日志应少两条；
  2. 删掉 `tables:` 段 → 只剩指标链路日志；
  3. 故意把 `tables:` 拼成 `tabless:` → 观察报错（struct 拦截）；
  4. 不传 `-c` → 观察 `Path(None)` 的 TypeError；
  5. 用数据库客户端查 `meta` 库四张表 → 确认是空的（**空是正常的**，08 分支才写入）。
- 复盘：不看代码画出依赖注入链，标注每一步的产物（engine/session/repository/service）。

**通关标准**
- 能向别人讲清楚：一条命令从 `argparse` 进来，经过哪些对象、哪些方法，最后打印出那 7 条日志；
- 四张元数据表的每个字段、`meta_config.yaml` 的每个配置项，都能说出"它在后续哪个分支、哪条链路里被消费"。

## 五、常见坑（Windows / 本项目实测）

1. **忘传 `-c`**：`args.conf = None` → `Path(None)` 抛 `TypeError: argument should be a str or an os.PathLike object...`，看到这个错先检查命令行。
2. **工作目录不对**：`-c conf/meta_config.yaml` 是相对路径，必须在项目根目录运行；`python -m` 方式也要求根目录在 `sys.path`（`-m` 本身会处理好，但相对路径取决于 cwd）。
3. **YAML 缩进**：`alias: [a, b]` 流式写法和 `columns:` 下的 `- name:` 列表缩进极易错一格，错了要么解析失败要么 `to_object` 类型对不上。
4. **以为构建脚本坏了**：跑完发现 meta 库没数据 —— 本分支本来就只打印日志，写入是 08 的事。
5. **两个 manager 连"同一个 MySQL"**：meta 和 dw 是同一实例上的两个 database（`app_config.yaml` 里 host/port 相同、database 不同），不是两个数据库服务。
6. **中文乱码**：连接串里的 `charset=utf8mb4` 已经处理；但自己临时写 SQL 查询中文列时注意客户端编码。

## 六、自测题

1. `DeclarativeBase` 的 `Base.metadata` 在本项目里被用到过吗？（提示：表是 meta.sql 建的，ORM 只做映射 —— 但 08 分支写入时 SQLAlchemy 依然靠模型知道"类 ↔ 表"的对应）
2. 如果 `table_info` 用自增整数主键，重复执行构建脚本会发生什么？业务主键怎么避免这个问题？
3. `examples`、`alias` 为什么能直接存 Python list？（提示：`JSON` 列类型的序列化职责在谁）
4. `OmegaConf.merge(schema, context)` 把两个参数调换位置会发生什么？
5. `build()` 里如果第 ⑧ 步 `close()` 写在 `async with` 块里面，最坏会出什么错？
6. Repository 只存一个 session，那"一个 service 方法里同时读写 meta 和 dw"时，两个库各自有没有独立事务？谁负责提交？

## 七、与下一分支的衔接

`08-metadata-table-column-sync` 将填掉 tables 链路的第一个空壳：
- `DWMySQLRepository` 补查询方法：`information_schema` 拿字段类型、`SELECT DISTINCT ... LIMIT` 拿示例值；
- `MetaMySQLRepository` 补写入方法：`table_info` / `column_info` 的落库（届时会真正用到本分支的 ORM 模型）；
- `MetaKnowledgeService.build()` 的 `if meta_config.tables:` 分支里补上编排逻辑。

学完 07 的标志：看到 08 的新代码时，能立刻指出"这是往 07 留的哪个坑里填东西"。

---

*生成于 2026-11-02，对应分支 `07-metadata-base-overview`（HEAD: 8483bb8）*
