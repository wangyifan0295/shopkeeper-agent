/**
 * 应用视图类型定义
 * 主区 6 个常驻视图（对话 / 数据大盘 / 胜率预测 / 选手榜 / 棋手榜 / 对局记录）；
 * 选手详情与棋手详情均以右侧抽屉浮层展示，不卸载背后列表与筛选状态。
 */
export type NavView = "chat" | "dashboard" | "predict" | "players" | "lords" | "matches";

export type AppView = NavView;
