/**
 * AG-UI 终端客户端示例 —— "第二个前端"
 *
 * 这个脚本不是网页,没有任何 React 代码,只有 20 来行:
 * 它证明 /api/agui/query 输出的是标准事件流,
 * 任何 AG-UI 客户端(终端、桌面应用、别人写的看板...)都能直接消费,
 * 后端不需要为它写一行代码。
 *
 * 运行方式(frontend 目录下):
 *   node examples/agui-cli-demo.mjs "按日期统计每天的对局数"
 */
import { randomUUID } from "node:crypto";
import { HttpAgent } from "@ag-ui/client";

const BASE_URL = process.env.AGUI_URL ?? "http://127.0.0.1:8100";
const query = process.argv[2] ?? "按日期统计每天的对局数";

console.log(`[终端客户端] 向 ${BASE_URL}/api/agui/query 提问: ${query}\n`);

// 注意:这里没有任何 SSE 解析代码——解析由官方 SDK 完成,我们只声明"关心哪些事件"
const agent = new HttpAgent({ url: `${BASE_URL}/api/agui/query` });

agent.subscribe({
  onRunStartedEvent: ({ event }) => console.log(`-- 运行开始 (runId=${event.runId})`),
  onStepStartedEvent: ({ event }) => console.log(`   -> ${event.stepName} ...`),
  onStepFinishedEvent: ({ event }) => console.log(`   <- ${event.stepName} 完成`),
  onStateSnapshotEvent: ({ event }) => {
    const s = event.snapshot ?? {};
    const bits = [];
    if (s.keywords?.length) bits.push(`关键词x${s.keywords.length}`);
    if (s.retrieved_column_infos?.length) bits.push(`召回字段x${s.retrieved_column_infos.length}`);
    if (s.table_infos?.length) bits.push(`候选表x${s.table_infos.length}`);
    if (s.sql) bits.push("已生成SQL");
    if (bits.length) console.log(`   [状态快照] ${bits.join(", ")}`);
  },
  onTextMessageContentEvent: ({ event }) => console.log(`>> 助手说: ${event.delta}`),
  onCustomEvent: ({ event }) => {
    if (event.name === "result") {
      console.log(`>> 收到结果表格: ${event.value.length} 行(终端就不画表格了)`);
    }
  },
  onRunErrorEvent: ({ event }) => console.log(`!! 出错: ${event.message}`),
});

agent.addMessage({ id: randomUUID(), role: "user", content: query });
await agent.runAgent();
console.log("\n-- 运行结束(终端客户端完事,后端全程不知道对面是个终端)");
