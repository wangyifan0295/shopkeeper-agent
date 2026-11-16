SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS dw DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
GRANT ALL PRIVILEGES ON dw.* TO 'didilili'@'%';
USE dw;


-- 阵营维表：王牌对决中可被禁用的阵营（阵营隶属于英雄牌，主公不隶属阵营）
DROP TABLE IF EXISTS dim_faction;
CREATE TABLE dim_faction
(
    faction_name VARCHAR(20) PRIMARY KEY COMMENT '阵营名称，如：大河流域、逐鹿、日落海',
    is_enabled   TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用：1=现役，0=已下架'
);

INSERT INTO dim_faction (faction_name, is_enabled)
VALUES ('大河流域', 1),
       ('逐鹿', 1),
       ('河洛', 1),
       ('日落海', 1),
       ('三分之地', 1),
       ('大河沧海', 0);


-- 主公维表：王牌对决中玩家选择的棋手（主公），完整目录含未登场主公
DROP TABLE IF EXISTS dim_lord;
CREATE TABLE dim_lord
(
    lord_name  VARCHAR(20) PRIMARY KEY COMMENT '主公（棋手）名称，如：阿离、乔汐、常小娥',
    is_enabled TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用：1=现役可选，0=已下架'
);

INSERT INTO dim_lord (lord_name, is_enabled)
VALUES ('阿离', 1),
       ('乔汐', 1),
       ('常小娥', 1),
       ('庄小鱼', 1),
       ('马可', 1),
       ('白歌', 1),
       ('闹闹', 1),
       ('姜导', 1),
       ('香香', 1),
       ('瑶妹', 1),
       ('小妲己', 1),
       ('弈星', 1),
       ('武凤', 1),
       ('镜', 1),
       ('玉环', 1),
       ('昭君', 1),
       ('班叔', 1),
       ('孙小宾', 1),
       ('明先生', 1),
       ('安琪拉', 1),
       ('嬴律', 1),
       ('鸢', 1),
       ('姜奇', 1);


-- 对局事实表：一局王牌对决（6 人同场，赛前禁用一个阵营）
DROP TABLE IF EXISTS fact_match;
CREATE TABLE fact_match
(
    match_id       VARCHAR(20) PRIMARY KEY COMMENT '对局编号，格式：日期-时间，如 20261019-1700',
    match_date     DATE        NOT NULL COMMENT '对局日期（本地时区）',
    banned_faction VARCHAR(20) NULL COMMENT '本场禁用的阵营，关联 dim_faction.faction_name；未禁用为 NULL'
);


-- 对局玩家明细事实表：每局每位玩家的主公选择与最终名次
DROP TABLE IF EXISTS fact_match_player;
CREATE TABLE fact_match_player
(
    match_id        VARCHAR(20) NOT NULL COMMENT '对局编号，关联 fact_match.match_id',
    seat            TINYINT     NOT NULL COMMENT '座位号 1-6',
    player_name     VARCHAR(50) NOT NULL COMMENT '玩家昵称，如：小祥、世薄情',
    lord_name       VARCHAR(20) NOT NULL COMMENT '本局使用的主公，关联 dim_lord.lord_name',
    final_place     TINYINT     NOT NULL COMMENT '最终名次 1-6，1=冠军（吃鸡），前 3 名算上分',
    PRIMARY KEY (match_id, seat)
);
