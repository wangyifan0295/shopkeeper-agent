/**
 * Tailwind CSS 主题配置
 * Hallmark Kiln 系统：utilities 全部映射到 tokens.css 的令牌（export-formats v3 规则），
 * 组件类（.well/.btn/.data-table 等）定义在 styles.css 的 components 层
 */
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: "var(--font-display)",
        body: "var(--font-body)",
        mono: "var(--font-outlier)",
      },
      colors: {
        sidebar: "var(--color-sidebar)",
        paper: {
          DEFAULT: "var(--color-paper)",
          2: "var(--color-paper-2)",
          3: "var(--color-paper-3)",
        },
        ink: {
          DEFAULT: "var(--color-ink)",
          2: "var(--color-ink-2)",
        },
        muted: "var(--color-muted)",
        rule: "var(--color-rule)",
        accent: {
          DEFAULT: "var(--color-accent)",
          ink: "var(--color-accent-ink)",
        },
        focus: "var(--color-focus)",
        error: "var(--color-error)",
        success: "var(--color-success)",
        rank: {
          1: "var(--color-rank-1)",
          2: "var(--color-rank-2)",
          3: "var(--color-rank-3)",
        },
        badge: "var(--color-badge-bg)",
        heat: {
          1: "var(--heat-1)",
          2: "var(--heat-2)",
          3: "var(--heat-3)",
          4: "var(--heat-4)",
          5: "var(--heat-5)",
          6: "var(--heat-6)",
        },
      },
      fontSize: {
        xs: "var(--text-xs)",
        sm: "var(--text-sm)",
        base: "var(--text-md)",
        lg: "var(--text-lg)",
        xl: "var(--text-xl)",
        "2xl": "var(--text-2xl)",
        "3xl": "var(--text-3xl)",
        figure: "var(--text-figure)",
      },
      borderRadius: {
        well: "var(--radius-well)",
        card: "var(--radius-card)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
} satisfies Config;
