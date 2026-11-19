/**
 * 应用视图类型定义
 * 不引入路由库，主区视图用 App 内部状态切换；player-detail 由选手榜点击进入
 */
export type AppView = "chat" | "players" | "player-detail" | "lords" | "matches";

/** 侧栏导航能直接到达的视图，选手详情只能从选手榜进入 */
export type NavView = Exclude<AppView, "player-detail">;
