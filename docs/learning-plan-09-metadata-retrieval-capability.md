# 09-metadata-retrieval-capability 模块学习计划（详细版）

> 对应分支：`09-metadata-retrieval-capability`（本地未建，需从 `origin/09-metadata-retrieval-capability` 建；核心提交 `2bc259a`，另含两个环境修复提交 `9b65a8f` asyncmy 升级、`4732753` 本地 TEI 兼容——所以这个分支在你机器上可以直接跑）
> 前置分支：`08-metadata-table-column-sync`（表字段元数据同步入库）
> 建议周期：6 天，每天 1.5~2 小时
> 分支性质：**检索能力构建分支** —— 08 把元数据写进 MySQL（给人看），09 把同一份元数据加工成 Qdrant 向量索引 + ES 全文索引（给 Agent 查）

---

## 一、这个分支在项目中的位置

08 完成后，元数据库里有表、有字段、有描述——但 Agent 没法"查"它们：用户问"销售额是多少"，谁来判断"销售额"对应 `fact_order.order_amount`？09 回答的就是这个问题。核心思路是**把一份元数据加工成三种可检索的形态**：

| 知识形态 | 存储 | 解决什么问题 | 举例 |
|---|---|---|---|
| 结构化元数据 | MySQL meta 库（08 已有，09 补指标） | 程序精确读取 | `fact_order` 有哪些字段 |
| **语义检索（09 新增）** | Qdrant 向量库 | 用户说法 ≠ 字段名 | 问"销售额" → 召回 `order_amount` |
| **精确值检索（09 新增）** | ES 全文索引 | 查询条件里的具体值 | 问"华东地区" → 命中 `region_name` 的取值 |

一句话记住分工：**向量管"模糊的语义"，ES 管"精确的值"**。这是 11/12 分支"多路召回合并"的地基。

### 1.1 主数据流图（一个字段的三次旅行）

```
conf/meta_config.yaml（业务语义：role / description / alias / sync）
        │ OmegaConf 四步法（07 学过）
        ▼
   MetaKnowledgeService.build()
        │
        ├─ tables 链路（3 步）
        │    ① _save_tables_to_meta_db ──────► meta 库 table_info / column_info（08 复习）
        │    │      └ 返回 column_infos（数据在步骤间靠返回值流动）
        │    ② _save_column_info_to_qdrant ─► Qdrant column_info_collection
        │    │      一个字段拆 2+N 个向量点（name + description + 每个 alias）
        │    ③ _save_value_info_to_es ──────► ES value_index
        │           sync: true 的维度字段，取值全集写入（IK 分词）
        │
        └─ metrics 链路（2 步）
             ④ _save_metrics_to_meta_db ────► meta 库 metric_info / column_metric（多对多）
             │      └ 返回 metric_infos
             ⑤ _save_metrics_to_qdrant ────► Qdrant metric_info_collection（和字段分开）
```

### 1.2 和 08 的两个重要呼应

1. **08 的 NameError 问题在 09 被结构性修复**：`build()` 拆成了 5 个私有方法，变量定义和使用回到同一个作用域（正是当初讨论的"方案 B"——链路变多后抽私有方法）。
2. **08 的 SQL 拼接问题在 09 依然存在**：`dw_mysql_repository.py` 一行没改，而且 `limit` 从 10 变成了 100000（全量取值）。之前讨论的修复方案（information_schema 参数化 / 白名单校验）依然适用，可以在本分支顺手练。

---

## 二、看代码的顺序（本分支的学习导航，最重要的一节）

**总原则：跟着一条数据走。** 先看编排（Service 决定"做什么"），再看实现（Repository 决定"怎么落"）；tables 链路走完再走 metrics 链路（因为 metrics 和 tables 完全同构，看 metrics 时你会发现是"复习"）。每个文件**先读模块 docstring**——本项目注释质量很高，docstring 就是脉络图。

| 步骤 | 看什么 | 回答的核心问题 | 建议时长 |
|---|---|---|---|
| **Step 0** | 建分支 + 变化地图 + README | 本分支改了哪些文件？和 08 的边界在哪？ | 20 min |
| **Step 1** | `scripts/build_meta_knowledge.py` | 新增了哪 4 个依赖？分别从哪来？ | 20 min |
| **Step 2** | `meta_knowledge_service.py` 的 `__init__` + `build()`（**只看骨架，不进私有方法**） | 两条链路五步怎么编排？数据怎么在步骤间流动？ | 30 min |
| **Step 3** | tables 第①段：`_save_tables_to_meta_db` | 和 08 比变了什么？为什么返回 `column_infos`？ | 30 min |
| **Step 4** | tables 第②段 Service 侧：`_save_column_info_to_qdrant` | 一个字段为什么拆成 2+N 个向量点？ | 45 min ★ |
| **Step 5** | tables 第②段 Repository 侧：`column_qdrant_repository.py` | collection / point / payload / COSINE 各是什么？ | 45 min |
| **Step 6** | tables 第③段：`_save_value_info_to_es` + `value_es_repository.py` | `sync` 开关怎么兑现？为什么必须 IK 分词？ | 45 min |
| **Step 7** | metrics 链路：`_save_metrics_to_meta_db` → `_save_metrics_to_qdrant` → `metric_qdrant_repository.py` | 多对多关系怎么落库？为什么指标单独一个 collection？ | 45 min |
| **Step 8** | 横向复盘：三个 repository 并排对比 + 幂等性实验 | 三种存储的批量写入、幂等性、事务有什么差异？ | 45 min ★ |

带 ★ 的是本分支的重头戏。这个顺序的内在逻辑：

1. **先总后分**：Step 2 只看 `build()` 骨架，拿到"全景地图"再深入，随时知道自己在哪一步；
2. **先 Service 后 Repository**：每一段都先看"决定做什么"的编排代码，再看"决定怎么落"的数据访问代码，正好对应代码的写作顺序；
3. **tables 在前 metrics 在后**：metrics 的向量化代码和字段几乎逐行相同，先吃透字段再看指标，你会体验一次"秒懂"——这也是检验 Step 4 是否真学懂的方法；
4. **最后横向对比**：单看每个 repository 都简单，并排看才能看出"批量、幂等、事务"三种维度的设计差异（Step 8）。

---

## 三、逐文件逐方法精讲

### 3.1 `app/scripts/build_meta_knowledge.py` —— 组装层增量（Step 1）

对照 08 版本看 diff，变化只有三类：

**① 初始化的 manager 从 2 个变 5 个**：

```python
meta_mysql_client_manager.init()   # 08 已有
dw_mysql_client_manager.init()     # 08 已有
qdrant_client_manager.init()       # 新：Qdrant 异步客户端
embedding_client_manager.init()    # 新：LangChain HuggingFaceEndpointEmbeddings（指向本地 TEI）
es_client_manager.init()           # 新：AsyncElasticsearch
```

五个 init 都不真正碰网络（连接是惰性的），只是把"连接能力"准备好。注意 `embedding_client_manager` **没有 close**——HTTP 客户端无需显式释放，而 MySQL engine / Qdrant / ES 客户端持有连接资源，必须显式关闭。

**② repository 从 2 个变 5 个**：

```python
meta_mysql_repository = MetaMySQLRepository(meta_session)          # 要 session
dw_mysql_repository = DWMySQLRepository(dw_session)                # 要 session
column_qdrant_repository = ColumnQdrantRepository(qdrant_client_manager.client)   # 要 client
value_es_repository = ValueESRepository(es_client_manager.client)                 # 要 client
metric_qdrant_repository = MetricQdrantRepository(qdrant_client_manager.client)   # 要 client
```

注意注入的差别：**MySQL 仓储吃 session（有事务概念），Qdrant/ES 仓储吃 client（无事务概念）**——这个差别在 Step 8 横向对比时还会回来。

**③ Service 构造参数从 2 个变 6 个**（多了 qdrant ×2、embedding、es），另外 `parser.add_argument("-c", "--conf", required=True)` 加了 `required=True`——07 学习计划"常见坑"里"忘传 -c 会 `Path(None)`"的问题，教程作者在这一分支悄悄修掉了。

### 3.2 `app/services/meta_knowledge_service.py` —— 本分支主战场（Step 2~4、7）

#### `__init__`：6 个依赖，注意注释里的角色声明

每个依赖都有注释说明职责。其中 `embedding_client` 的注释值得细品：**"向量化动作放在 Service 层"**——Qdrant 仓储只接收"已经算好的向量"，自己不知道怎么算。这是一个刻意的职责切分：Embedding 是业务决策（哪些文本要向量化）的一部分，不是存储细节。

#### `build()`：纯编排（Step 2）

```python
meta_config = OmegaConf 四步法           # 07 学过，第三次出现，应已形成肌肉记忆
if meta_config.tables:
    column_infos = await self._save_tables_to_meta_db(meta_config)   # ①
    await self._save_column_info_to_qdrant(column_infos)             # ②
    await self._save_value_info_to_es(meta_config, column_infos)     # ③
if meta_config.metrics:
    metric_infos = await self._save_metrics_to_meta_db(meta_config)  # ④
    await self._save_metrics_to_qdrant(metric_infos)                 # ⑤
```

看三点：
- `build()` 里**没有任何具体业务逻辑**，只有流程和日志——这就是"编排层"该有的样子；
- ① 的返回值 `column_infos` 是 ②③ 的输入，④ 的返回值是 ⑤ 的输入——**步骤间靠返回值传递，不靠实例变量**。好处：数据流一眼可见、方法可独立测试；
- ②③ 还需要 `meta_config`（比如 ③ 要读 `sync` 开关），所以参数是"上一步产物 + 原始配置"的组合。

#### ① `_save_tables_to_meta_db`：08 的复习 + 一个新设计（Step 3）

和 08 的 `build()` 主体几乎一样：遍历 tables → 组装 `TableInfo` → 查 dw 拿字段类型 → 抽样 10 条示例值 → 组装 `ColumnInfo` → 一个事务写入两张表。三个变化：

1. 整段逻辑搬进私有方法，`build()` 里只剩一行调用；
2. **新增 `return column_infos`**——MySQL 落库的产出（字段实体列表）成了下游向量索引和 ES 索引的原料。想一想：为什么不直接把 `table_infos` 也返回？（提示：谁会消费它？向量化的是字段的 name/description/alias，表的 description 其实没被向量化——这可以是你的一个改进点想法）；
3. 08 里的两个 `print()` 调试残留已删除，换成 `build()` 里的 `logger.info`。

#### ② `_save_column_info_to_qdrant`：本分支最核心的 40 行（Step 4 ★）

分三段读：

**第一段：拼 points（多语义入口）**

```python
for column_info in column_infos:
    points.append({"id": uuid.uuid4(), "embedding_text": column_info.name,  "payload": asdict(column_info)})
    points.append({"id": uuid.uuid4(), "embedding_text": column_info.description, "payload": asdict(column_info)})
    for alia in column_info.alias:
        points.append({"id": uuid.uuid4(), "embedding_text": alia, "payload": asdict(column_info)})
```

- 一个字段 = **2 + len(alias) 个点**。比如 `order_amount`（别名：销售额/订单金额/收入）= 2+3 = 5 个点；
- 为什么：用户说"销售额"，和字段名 `order_amount` 字面毫无关系，但和 alias"销售额"一字不差 → 向量几乎重合 → 稳定召回。**本质是拿存储空间换召回率**：入口越多，被问中的概率越大；
- 每个点的 `payload` 都存**完整的 ColumnInfo**（`asdict` 转 dict）——从任何一个入口召回，都能还原出完整字段信息。代价：同一份 payload 重复存 N 份；
- `uuid.uuid4()` 做点 id：每次构建生成新 id。记住这个细节，Step 8 的幂等性实验会回来找它。

**第二段：批量向量化**

```python
embedding_texts = [point["embedding_text"] for point in points]
embedding_batch_size = 20
for i in range(0, len(embedding_texts), embedding_batch_size):
    batch = await self.embedding_client.aembed_documents(embedding_texts[i : i + 20])
    embeddings.extend(batch)
```

- `aembed_documents` 一次算一批（20 条），比逐条 `aembed_query` 少 20 倍 HTTP 往返；
- 分批是为了控制单次请求大小——embedding 服务（本地 TEI）有单请求 token 上限；
- **脆弱点**：`ids / embeddings / payloads` 三个平行列表，全靠下标对齐。`extend` 保序所以当前没问题，但如果哪天有人改成并发 `asyncio.gather` 且收集结果时乱了顺序，向量和元数据就会张冠李戴——看源码时要能看出这种"约定式对齐"的风险。

**第三段：落库**

```python
ids = [point["id"] for point in points]
payloads = [point["payload"] for point in points]
await self.column_qdrant_repository.upsert(ids, embeddings, payloads)
```

Service 把三列数据准备好，交给 Repository（下一节）。

#### ③ `_save_value_info_to_es`：sync 开关的兑现（Step 6 前半）

```python
column2sync: dict[str, bool] = {}
for table in meta_config.tables:
    for column in table.columns:
        column2sync[f"{table.name}.{column.name}"] = column.sync
```

先把配置拍平成 `{column_id: sync}` 的字典，再逐个字段判断。两个关键点：

- **07 埋的伏笔 `sync: true` 在这里兑现**——只有维度字段（省份/大区/性别/会员等级这类低基数字段）的取值才进 ES。为什么主键、外键、度量值不进？id 没有召回意义，数值度量取值无限进全文索引无意义。`sync` 问的是"这个字段的**值**，值不值得被全文检索"；
- 取值用的是 `get_column_values(table_id, name, 100000)`——**全集**，不再是 ① 里的 10 条抽样。目的：用户查询条件里出现的任何具体值（"华东""黄金会员""上海市"）都要能在 ES 里精确命中，从而反查出"它属于哪个字段"。

每个值变成一个 `ValueInfo(id="表.字段.值", value=值, column_id=表.字段)`，批量交给 ES 仓储。

#### ④ `_save_metrics_to_meta_db`：多对多关系落库（Step 7 前半）

```python
for metric in meta_config.metrics:
    metric_infos.append(MetricInfo(id=metric.name, ..., relevant_columns=metric.relevant_columns, ...))
    for column in metric.relevant_columns:
        column_metrics.append(ColumnMetric(column_id=column, metric_id=metric.name))

async with self.meta_mysql_repository.session.begin():   # 同一笔事务
    self.meta_mysql_repository.save_metric_infos(metric_infos)
    self.meta_mysql_repository.save_column_metrics(column_metrics)
```

- `MetricInfo` 存指标本身（`relevant_columns` 以 JSON 列冗余存一份）；`ColumnMetric` 是**多对多中间表**（联合主键 `column_id + metric_id`，同一对关系天然去重）——07 学的四张元数据表至此全部用上；
- "指标本身"和"依赖关系"放同一笔事务：避免只写了一半。和 08 的表/字段同事务是同一个原则——**业务上成对出现的数据，事务上绑定**；
- 注意 `ColumnMetric(column_id=column, ...)` 里的 `column` 来自配置里的 `relevant_columns`，元素是 `"fact_order.order_amount"` 这种字符串 = `column_info.id`——**三张表靠同一套 ID 体系打通**（07 讲过的设计）。

顺带一个教程留的思考点（07 也提过）：AOV 的 `relevant_columns` 配的是 `order_quantity`，严格说应该是 `order_amount`——如果配错，"从指标找依赖字段"的召回链路会拿错字段。

#### ⑤ `_save_metrics_to_qdrant`：同构复用（Step 7 后半）

逐行对照 ②：拼 points（name + description + alias）→ 批量 embedding → upsert。唯一差别是目标换成 `metric_qdrant_repository`。**如果你读这段觉得"和字段一模一样"，说明 Step 4 学懂了**；同时也该注意到：这段代码和 ② 有大量复制粘贴，是一个明显的重构候选项（抽一个通用的 `_build_points_and_upsert`）。

### 3.3 `app/repositories/qdrant/column_qdrant_repository.py`（Step 5）

Qdrant 五个核心概念一次讲清：

| 概念 | 代码 | 类比 MySQL |
|---|---|---|
| collection | `collection_name = "column_info_collection"` | table |
| point | `PointStruct(id=..., vector=..., payload=...)` | row |
| payload | point 携带的原始元数据 dict | 其余列 |
| 距离度量 | `Distance.COSINE` | ——（MySQL 没有） |
| 维度 | `VectorParams(size=1024, ...)` | 列类型 |

三个方法：

- **`ensure_collection()`**：幂等模式——`collection_exists` 检查后再 create。脚本可以反复跑而不炸。`size` 取自 `app_config.qdrant.embedding_size`（1024），**必须和 TEI 模型（bge-large-zh-v1.5）输出维度严格一致**，否则写入时报维度不匹配错误。为什么选 COSINE：文本语义相似度关心方向夹角，不关心向量长度，余弦距离正是量“方向一致程度”；
- **`upsert(ids, embeddings, payloads, batch_size=10)`**：`zip` 三个平行列表组装成 `PointStruct`，每 10 条一批提交。upsert 语义 = "存在则更新，不存在则插入"——但因为 id 是 uuid4，实际每次都是插入新点（幂等性实验的伏笔）；
- **`search(embedding, score_threshold=0.6, limit=20)`**：拿一个查询向量召回最相似的 points，`score_threshold` 过滤低分，结果从 `point.payload` 还原成 `ColumnInfo` 实体返回。**注意：这个方法在本分支没有任何调用方**——它是给 11 分支（Agent 关键词多路召回）预留的。看源码要习惯识别这种"超前埋点"。

### 3.4 `app/repositories/es/value_es_repository.py`（Step 6 后半）

**类属性即建索引的"图纸"**：

```python
index_name = "value_index"        # 注意：硬编码，没用 app_config.es.index_name（见观察点）
index_mappings = {
    "dynamic": False,             # 禁止 ES 自动猜字段类型
    "properties": {
        "id":       {"type": "keyword"},
        "value":    {"type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_max_word"},
        "column_id": {"type": "keyword"},
    },
}
```

- **`keyword` vs `text`**：keyword 不分词、整串精确匹配（`column_id` 要按 `fact_order.region_name` 精确过滤）；text 要分词后倒排（`value` 要能按"华东"检索）；
- **为什么必须 IK**：ES 默认分词器对中文基本是按"字"切，`华东地区` 切成 `华`/`东`/`地`/`区`，用户搜"华东"时按词匹配就废了。IK 按中文语意切词，`华东地区` 能切出 `华东`/`地区`。**本项目 ES 镜像已装好 IK 8.19.10**（见 `docker/elasticsearch/Dockerfile`，装 IK 的自定义镜像），所以能直接跑——如果换官方镜像，`create index` 会报 `unknown analyzer [ik_max_word]`；
- `ensure_index()`：和 Qdrant 的 `ensure_collection` 同一个幂等模式；
- **`index(value_infos, batch_size=20)`**：ES bulk API 的标准用法——操作列表里**奇数位是动作行**（`{"index": {"_index": ..., "_id": ...}}`），**偶数位是文档本体**，两两成对。最关键的设计：**`_id` 用业务 id（`表.字段.值`）**——重复构建时同一文档被覆盖而不是追加，ES 是三种存储里唯一天然幂等的（Step 8 伏笔之三）。

### 3.5 `app/repositories/qdrant/metric_qdrant_repository.py`（Step 7）

和 3.3 逐行同构，只有两处差别：`collection_name = "metric_info_collection"`；**没有 `search` 方法**（当前还没有指标召回需求）。为什么字段和指标分两个 collection 而不共用一个：召回时"给我字段"和"给我指标"是两类请求，分开存才能按类型独立检索，不会互相混入对方的结果。

### 3.6 `app/repositories/mysql/meta/meta_mysql_repository.py` 增量（Step 7 顺带）

新增 `save_metric_infos` / `save_column_metrics`，模式和 08 的两个 save 完全一致：实体列表 → Mapper.to_model → `add_all`。Mapper（`metric_info_mapper` / `column_metric_mapper`）08 就建好了，09 只是终于用上。注意 Repository 依旧不管事务——`begin()` 仍在 Service 层。

### 3.7 entities 与配置的变化（了解即可）

- `value_info.py`：08 已建（`id / value / column_id` 三个字段），09 是它第一次被真正使用；
- `metric_info.py` / `column_metric.py`：只有 docstring 措辞变化 + 一行注释，无逻辑变化；
- `conf/meta_config.yaml` 的 `metrics:` 段（GMV / AOV）08 就有了，09 第一次被消费。

---

## 四、三个横向主题（Step 8，把知识串起来）

### 4.1 多语义入口：存储换召回

| 设计选择 | 代价 | 收益 |
|---|---|---|
| 一个字段拆 name/description/每个 alias 共 2+N 个点 | 存储翻 N 倍；同一 payload 重复存 | 用户无论说字段名、业务含义还是任何一个别名，都能召回 |
| 只存 name 一个点 | 存储最小 | "销售额"永远召不回 `order_amount`（字面零重叠，向量相似度低） |

这是典型的**检索系统权衡**：元数据知识库规模小（几十个字段），重复存储的代价可以忽略，召回率的收益是决定性的。

### 4.2 向量检索 vs 全文检索：为什么需要两个引擎

| | Qdrant（向量） | ES（全文） |
|---|---|---|
| 擅长 | 语义近似："销售额"≈"收入"≈order_amount | 精确/分词匹配："华东"=华东 |
| 索引对象 | 字段/指标的 name、description、alias | 字段的**真实取值** |
| 回答的问题 | "用户在说哪个字段/指标？" | "用户提到的这个值，属于哪个字段？" |
| 失效场景 | 生僻专名、编码类词 | 换个说法就匹配不上 |

Agent 生成 SQL 时两类信息缺一不可：`select sum(order_amount) from fact_order where region_name = '华东'`——`order_amount` 靠向量召回，`'华东'` 靠 ES 确认它是 `region_name` 的合法取值。11/12 分支会把这两路召回合并。

### 4.3 三种存储的写入对比（本分支最值得做的总结）

| | MySQL | Qdrant | ES |
|---|---|---|---|
| 注入的东西 | session（有事务） | client（无事务） | client（无事务） |
| 批量方式 | `add_all`（一个事务内） | 每 10 条一批 upsert | 每 20 条一批 bulk |
| id 策略 | 业务主键（表名/表名.字段名） | **uuid4 随机** | 业务 id（表.字段.值） |
| 重复跑 build | **主键冲突报错（IntegrityError）** | **新增重复点** | **覆盖同 id 文档（幂等）** |
| 幂等修复思路 | upsert（merge）或先删后插 | point id 改用业务 id | 已经是了 |

这张表是实验三的"预言"——先自己推理一遍，再用实验验证。

---

## 五、每日计划

### Day 1 —— 总览 + Service 重构 + MySQL 段（Step 0~3，~2h）

**做什么**
- Step 0：`git checkout -b 09-metadata-retrieval-capability origin/09-metadata-retrieval-capability`；`git diff --stat 08 09` 对照本文 1.1 的数据流图；浏览 README 新增的架构说明。
- Step 1：精读 `build_meta_knowledge.py`，对照 08 版本，标出 5 个 init、5 个 repository、6 个 Service 依赖。
- Step 2：只读 `__init__` 和 `build()`，不看私有方法；自己白纸画出两条链路五步图。
- Step 3：精读 `_save_tables_to_meta_db`，对照 08 的旧 `build()`，列出三处变化（搬移/返回值/print 删除）。

**检验**
- 不看文档说出：5 个依赖分别是谁、注入给谁；
- 能回答：为什么 ① 的返回值是 `column_infos` 而不是 `table_infos`？

### Day 2 —— 字段向量化链路（Step 4~5，~2h）

**做什么**
- Step 4：精读 `_save_column_info_to_qdrant`，手算 `meta_config.yaml` 里 `fact_order.order_amount`（3 个别名）会生成几个点；全文数一数 5 张表总共会生成多少个点。
- Step 5：精读 `column_qdrant_repository.py`，对照 4.2 表格吃透 collection/point/payload/COSINE。

**检验**
- 能解释"2+N 个点"各自解决什么召回场景；
- 能说出 `search()` 为什么现在没人调用（为 11 分支预留）。

### Day 3 —— Embedding 批处理 + 横向主题（~1.5h）

**做什么**
- 画出 point 生成的完整流程图：column_infos → points → embedding_texts（分批 20）→ embeddings → upsert（分批 10），标注两次分批发生在哪一侧（Service / Repository）。
- 读横向主题 4.1、4.2，思考"如果 embedding 维度配成 768 会发生什么"（Qdrant 建的 collection 是 1024，写入时报维度不匹配）。
- 思考脆弱点：平行列表靠下标对齐，如果改成 `asyncio.gather` 并发批量请求，怎么保证顺序？

**检验**
- 能说清 `aembed_documents` 和 `aembed_query` 的使用场景差异；
- 能讲出"存储换召回"的权衡逻辑。

### Day 4 —— 字段值全文索引链路（Step 6，~2h）

**做什么**
- 精读 `_save_value_info_to_es`：`column2sync` 字典怎么构建、为什么 limit=100000；
- 精读 `value_es_repository.py`：mappings 每个字段定义、bulk 操作列表奇偶行的含义、`_id` 用业务 id 的好处；
- 动手验证 IK（实验四）。

**检验**
- 能解释 keyword 和 text 的区别、以及为什么 `column_id` 必须是 keyword；
- 能说出哪些字段 `sync: true`、判断依据是什么（低基数维度值）。

### Day 5 —— metrics 链路 + 横向复盘（Step 7~8，~2h）

**做什么**
- Step 7：精读两个 metrics 私有方法 + `metric_qdrant_repository`，对照字段版本找不同（应该只有 collection 名和缺 search）；
- Step 8：不看文档自己填 4.3 的对比表，再对照订正；
- 完成实验一（全链路跑通）+ 实验二（语义召回体验）。

**检验**
- 能解释 MetricInfo/ColumnMetric 为什么同事务、联合主键怎么去重；
- 能说出三张表靠什么 ID 体系打通（`表名.字段名`）。

### Day 6 —— 幂等性实验 + 自测 + 复刻（~2h）

**做什么**
- 实验三（幂等性）：先推理再验证 4.3 表的最后一行；
- 过一遍第六节自测题；
- （可选）在 `D:\Demo\data-agent` 里复刻最小版字段向量索引：一张表、三个字段、一个 collection，跑通"配置 → 实体 → 向量 → Qdrant"链路。

**通关标准**
- 能向别人讲清楚：从 `-c conf/meta_config.yaml` 开始，一个字段的 description 经过了哪些对象、哪些方法，最终变成 Qdrant 里的一个 point；
- 4.3 对比表能默写；三种存储谁的构建幂等、为什么，能脱口而出。

---

## 六、动手实验

> 前置：`docker ps` 确认 mysql / qdrant / elasticsearch / embedding(TEI) 四个容器在跑（`docker compose up -d`）。工作目录必须在项目根。

### 实验一：全链路跑通 + 三处验收（Day 5）

```bash
uv run python -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml
```

预期日志依次出现：`保存表信息和字段信息到 Meta MySQL` → `为字段信息建立向量索引` → `为字段取值建立全文索引` → `保存指标信息到数据库成功` → `为指标信息建立向量索引成功`。然后三处验收：

```bash
# ① Qdrant：浏览器打开 Dashboard，看 column_info_collection / metric_info_collection 的 point 数
#    http://localhost:6333/dashboard

# ② ES：查"华东"能命中 region_name 的取值文档
curl "localhost:9200/value_index/_search?q=value:华东&pretty"

# ③ MySQL：指标和关系表
docker exec mysql mysql --default-character-set=utf8mb4 -udidilili -pdili123 meta \
  -e "select * from metric_info; select * from column_metric;"
```

### 实验二：亲手体验语义召回（Day 5，强烈推荐）

新建临时脚本（体会 11 分支将发生的召回，也验证 `search()` 方法）：

```python
# examples/try_column_recall.py
import asyncio
from app.clients.embedding_client_manager import embedding_client_manager
from app.clients.qdrant_client_manager import qdrant_client_manager
from app.repositories.qdrant.column_qdrant_repository import ColumnQdrantRepository

async def main():
    embedding_client_manager.init()
    qdrant_client_manager.init()
    repo = ColumnQdrantRepository(qdrant_client_manager.client)
    query = await embedding_client_manager.client.aembed_query("销售额")
    for hit in (await repo.search(query))[:5]:
        print(hit.id, "|", hit.description)

asyncio.run(main())
```

`uv run python examples/try_column_recall.py`——第一名应该稳稳是 `fact_order.order_amount`（通过别名"销售额"这个入口召回）。再换"成交总额"试试（GMV 的别名，会从指标 collection 里……等等，这个脚本查的是字段 collection——顺带思考：指标的召回需要谁来做？）。

### 实验三：幂等性对比（Day 6）

1. **先推理**：第二次运行 build，MySQL / Qdrant / ES 各会发生什么？
2. **再验证**：重跑一次 build，观察在哪一步报错（预期：MySQL `IntegrityError: Duplicate entry`，且因为它是第一步，Qdrant/ES 根本没执行到）；
3. **清理后重跑**：
   ```bash
   docker exec mysql mysql -udidilili -pdili123 meta \
     -e "truncate table_info; truncate column_info; truncate metric_info; truncate column_metric;"
   # Qdrant 删集合（dashboard 里删，或 curl -X DELETE localhost:6333/collections/column_info_collection）
   ```
   然后想：如果要让脚本真正可重复运行，三处分别该怎么改？（MySQL 改 upsert / Qdrant point id 改业务 id / ES 不用改）

### 实验四（可选）：亲眼看 IK 分词效果（Day 4）

```bash
curl -X POST "localhost:9200/value_index/_analyze" -H "Content-Type: application/json" \
  -d '{"analyzer": "ik_max_word", "text": "华东地区黄金会员"}'
# 把 analyzer 换成 "standard" 再跑一遍，对比 tokens，直观理解为什么必须 IK
```

---

## 七、常见坑（Windows / 本项目实测）

1. **四个容器没全起**：MySQL 在跑不代表 Qdrant/ES/TEI 在跑。先 `docker ps`，缺谁 `docker compose up -d` 补谁。embedding 服务（TEI，8081 端口）挂了会在批量向量化一步报连接错误。
2. **换官方 ES 镜像会炸**：`unknown analyzer [ik_max_word]`——IK 是本项目自定义镜像装的（`docker/elasticsearch/Dockerfile`），必须用 compose 里 build 的那个。
3. **重复跑 build 报 `Duplicate entry`**：不是 bug，是 MySQL 侧不幂等（实验三就是专门研究它的）。报错后按实验三清理再跑。
4. **向量维度不匹配**：`app_config.yaml` 里 `embedding_size: 1024` 对应 bge-large-zh-v1.5。如果改了 embedding 模型但没改这个值，建出来的 collection 维度和实际向量对不上，写入时报错——而且旧 collection 不会自动重建，要手动删掉重跑。
5. **配置漂移的迷惑**：`app_config.yaml` 里 `es.index_name: data_agent` 声明了但**没有任何代码使用**——`ValueESRepository` 硬编码了 `value_index`（grep 可验证）。看到配置不要默认它生效，要以代码为准。
6. **工作目录/相对路径**：`-c conf/meta_config.yaml` 是相对路径，必须在项目根目录跑（07 的老坑，09 已把 `-c` 设为 required，漏传会直接报 argparse 错误而不是 `Path(None)`）。
7. **`meta_config.tables` 里某字段在 dw 库不存在**：`column_types[column.name]` 直接 KeyError——教程假设配置和数仓一致，实际项目里要考虑防御。

---

## 八、自测题

1. `order_amount`（别名：销售额/订单金额/收入）会生成几个向量点？分别覆盖哪类问法？
2. 用户问"销售额"，向量检索为什么能召回 `order_amount`？靠的是哪个点？如果配置里没写 alias，还能靠什么入口召回（弱一些的）？
3. `sync: true/false` 的判断依据是什么？`year`/`month` 这类维度字段为什么是 false？
4. Qdrant collection 的 `size` 参数和谁必须一致？不一致在哪一步报错？
5. 距离度量选 COSINE 而不是欧氏距离，语义检索场景下的理由是什么？
6. ES 的 `value` 字段用 `ik_max_word`，`column_id` 用 keyword——两个选择各自的原因？
7. `MetricInfo` 和 `ColumnMetric` 为什么放同一笔事务？`ColumnMetric` 的联合主键起到什么作用？
8. 字段和指标为什么分两个 collection？共用一个会出什么问题？
9. 三种存储（MySQL/Qdrant/ES）重复构建时行为分别是什么？根因分别出在哪个设计选择上？
10. `ids/embeddings/payloads` 三个平行列表的对齐依赖什么约定？这个约定在什么改动下会脆弱？
11. （扩展）`_save_column_info_to_qdrant` 和 `_save_metrics_to_qdrant` 有大段重复代码，你会怎么重构？重构后 embedding 批量逻辑放在哪一层？

---

## 九、与下一分支的衔接

`10-agent-overview-workflow` 起进入"用知识库"的阶段：09 建好的三路检索能力（MySQL 精确读 / Qdrant 语义召回 / ES 值匹配）将在 11（关键词多路召回）、12（召回合并）被 Agent 工作流真正消费——`ColumnQdrantRepository.search()` 这个"本分支无人调用"的方法就是为此预留的。

学完 09 的标志：看到 11 分支的召回代码时，能立刻说出"它调的是 09 建的哪个 collection、召回回来的 payload 是哪个 dataclass、这个 dataclass 是在哪一步被 asdict 进去的"。

---

*生成于 2026-11-13，对应分支 `origin/09-metadata-retrieval-capability`（HEAD: 4732753）*
