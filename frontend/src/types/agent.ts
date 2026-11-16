/**
 * 智能体类型定义
 * 定义问数智能体前端使用的 SSE 事件、流程步骤和聊天消息类型
 */
export type ProgressStatus = "running" | "success" | "error";

export type ProgressEvent = {
  type: "progress";
  step: string;
  status: ProgressStatus;
};

export type ResultEvent = {
  type: "result";
  data: unknown;
};

export type ErrorEvent = {
  type: "error";
  message: string;
};

/** AG-UI 标准文本消息增量，来自 TEXT_MESSAGE_CONTENT 事件 */
export type TextEvent = {
  type: "text";
  delta: string;
};

/** AG-UI 状态快照事件，携带图执行到当前超步的累积状态 */
export type StateSnapshotAgentEvent = {
  type: "state";
  snapshot: unknown;
};

export type AgentEvent =
  | ProgressEvent
  | ResultEvent
  | ErrorEvent
  | TextEvent
  | StateSnapshotAgentEvent;

export type StepState = {
  step: string;
  status: ProgressStatus;
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  status?: "streaming" | "done" | "error";
  steps?: StepState[];
  result?: unknown;
  error?: string;
  // AG-UI 协议下最新一次 STATE_SNAPSHOT 的状态内容
  stateSnapshot?: unknown;
};
