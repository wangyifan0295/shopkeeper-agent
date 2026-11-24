/**
 * 应用视图类型定义
 * 主区 4 个常驻视图（对话 / 选手榜 / 棋手榜 / 对局记录）；
 * 选手详情改为右侧抽屉浮层展示，不卸载背后列表与筛选状态。
 */
export type NavView = "chat" | "players" | "lords" | "matches";

export type AppView = NavView;
