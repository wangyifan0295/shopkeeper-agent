/**
 * 主题状态 Hook
 * 管理 4 套工作台配色（余烬 / 弈局 / 战术 / 手账），持久化到 localStorage，
 * 并实时同步 html[data-theme] 与浏览器 theme-color。
 */
import { useEffect, useState } from "react";

export type ThemeId = "ember" | "ink" | "obsidian" | "journal";

export type ThemeMeta = {
  id: ThemeId;
  label: string;
  description: string;
  mode: "dark" | "light";
  themeColor: string;
  swatchBg: string;
  swatchAccent: string;
};

export const THEMES: ThemeMeta[] = [
  {
    id: "ember",
    label: "余烬",
    description: "暖炭黑与余烬橙（暗色）",
    mode: "dark",
    themeColor: "#181311",
    swatchBg: "#1f1916",
    swatchAccent: "#e27834",
  },
  {
    id: "ink",
    label: "弈局",
    description: "玄青墨底与鎏金点阵（暗色）",
    mode: "dark",
    themeColor: "#141a1d",
    swatchBg: "#182126",
    swatchAccent: "#d4b46a",
  },
  {
    id: "obsidian",
    label: "战术",
    description: "冷曜石与赛场金青（暗色）",
    mode: "dark",
    themeColor: "#161920",
    swatchBg: "#1b202b",
    swatchAccent: "#6ec4db",
  },
  {
    id: "journal",
    label: "手账",
    description: "暖象牙纸白与钴蓝（浅色）",
    mode: "light",
    themeColor: "#f7f5f0",
    swatchBg: "#f5f2ea",
    swatchAccent: "#2e5cb8",
  },
];

const STORAGE_KEY = "workbench-theme";

function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((item) => item.id === value);
}

function readInitialTheme(): ThemeId {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.theme ?? null;
    if (isThemeId(attr)) return attr;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(saved)) return saved;
  } catch {
    // 隐私模式等场景忽略存储异常
  }
  return "ember";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = THEMES.find((item) => item.id === theme);
    if (meta) {
      const themeMetaTag = document.querySelector('meta[name="theme-color"]');
      themeMetaTag?.setAttribute("content", meta.themeColor);
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 忽略持久化异常
    }
  }, [theme]);

  return { theme, setTheme };
}
