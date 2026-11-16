/**
 * 智能体执行流程图组件
 * 把 LangGraph 的细粒度节点归并成三个主阶段，横向紧凑展示
 */
import { Check, ChevronRight, Circle, LoaderCircle, X } from "lucide-react";
import { Fragment } from "react";
import { cn } from "../lib/format";
import type { ProgressStatus, StepState } from "../types/agent";

type PhaseStatus = ProgressStatus | "pending";

type Phase = {
  name: string;
  // 该阶段聚合的全部底层节点，用于错误检测和进行中判断
  members: string[];
  // 标志该阶段完成的节点；生成SQL 以校验通过为准，校正SQL 成功同样视为完成
  finalSteps: string[];
};

// 三个主阶段覆盖原来的十二个节点：检索分析（抽取+三路召回+合并+双过滤+补上下文）
// 生成SQL（生成+校验+校正）执行查询（执行SQL）
const phases: Phase[] = [
  {
    name: "检索分析",
    members: [
      "抽取关键词",
      "召回字段信息",
      "召回指标信息",
      "召回字段取值",
      "合并召回信息",
      "过滤指标信息",
      "过滤表信息",
      "添加额外上下文",
    ],
    finalSteps: ["添加额外上下文"],
  },
  {
    name: "生成SQL",
    members: ["生成SQL", "校验SQL", "校正SQL"],
    finalSteps: ["校验SQL", "校正SQL"],
  },
  {
    name: "执行查询",
    members: ["执行SQL"],
    finalSteps: ["执行SQL"],
  },
];

function getStatusMap(steps: StepState[]) {
  return steps.reduce<Record<string, StepState>>((map, item) => {
    map[item.step] = item;
    return map;
  }, {});
}

function phaseStatus(phase: Phase, map: Record<string, StepState>): PhaseStatus {
  // 校验SQL 的 error 是可恢复的：校验失败会转给校正SQL 兜底，
  // 所以只有校正SQL 也失败时才判定阶段失败
  const failedMember = phase.members.find((step) => {
    if (map[step]?.status !== "error") return false;
    return !(step === "校验SQL" && map["校正SQL"]?.status === "success");
  });
  if (failedMember) return "error";

  // 标志节点任一成功即视为阶段完成（生成SQL 走校正分支时以校正成功为准）
  if (phase.finalSteps.some((step) => map[step]?.status === "success")) {
    return "success";
  }

  // 有成员在跑或已有事件到达，说明阶段进行中
  const started = phase.members.some((step) => map[step] !== undefined);
  return started ? "running" : "pending";
}

function NodeIcon({ status }: { status: PhaseStatus }) {
  if (status === "running") {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />;
  }

  if (status === "success") {
    return <Check className="h-3.5 w-3.5" aria-hidden="true" />;
  }

  if (status === "error") {
    return <X className="h-3.5 w-3.5" aria-hidden="true" />;
  }

  return <Circle className="h-3.5 w-3.5" aria-hidden="true" />;
}

function PhaseCard({ name, status }: { name: string; status: PhaseStatus }) {
  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 border px-3 text-sm font-semibold shadow-line transition",
        status === "pending" && "border-ink/10 bg-white/55 text-ink/45",
        status === "running" && "border-brass/45 bg-brass/15 text-ink",
        status === "success" && "border-moss/25 bg-moss/10 text-ink",
        status === "error" && "border-tomato/35 bg-tomato/10 text-tomato",
      )}
    >
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full",
          status === "pending" && "bg-ink/5 text-ink/35",
          status === "running" && "bg-brass/20 text-brass",
          status === "success" && "bg-moss/15 text-moss",
          status === "error" && "bg-tomato/15 text-tomato",
        )}
      >
        <NodeIcon status={status} />
      </span>
      <span className="whitespace-nowrap">{name}</span>
    </div>
  );
}

export function StepRail({ steps = [] }: { steps?: StepState[] }) {
  if (steps.length === 0) return null;

  const statusMap = getStatusMap(steps);

  return (
    <section className="mt-4 border border-ink/10 bg-white/40 px-3 py-4 shadow-line">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="text-sm font-semibold text-ink">执行流程</div>
        <div className="text-xs text-ink/45">LangGraph</div>
      </div>

      {/* 主阶段横向排列，窄屏时可以横向滚动，不再占用整屏高度 */}
      <div className="flex items-center gap-2 overflow-x-auto px-1 py-1">
        {phases.map((phase, index) => (
          <Fragment key={phase.name}>
            {index > 0 && (
              <ChevronRight
                className="h-4 w-4 shrink-0 text-ink/35"
                aria-hidden="true"
              />
            )}
            <PhaseCard name={phase.name} status={phaseStatus(phase, statusMap)} />
          </Fragment>
        ))}
      </div>
    </section>
  );
}
