import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'SF Pro Display', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        "border-highlight": "hsl(var(--border-highlight))",
        input: "hsl(var(--input))",
        "input-bg": "hsl(var(--input-bg))",
        "track-soft": "hsl(var(--track-soft))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          soft: "hsl(var(--primary-soft))",
          glow: "hsl(var(--primary-glow))",
        },
        copper: {
          DEFAULT: "hsl(var(--copper))",
          foreground: "hsl(var(--copper-foreground))",
          hover: "hsl(var(--copper-hover))",
          active: "hsl(var(--copper-active))",
          soft: "hsl(var(--copper-soft))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          soft: "hsl(var(--destructive-soft))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          soft: "hsl(var(--success-soft))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          soft: "hsl(var(--warning-soft))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          soft: "hsl(var(--info-soft))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        "accent-blue": "hsl(var(--accent-blue))",
        "accent-blue-soft": "hsl(var(--accent-blue-soft))",
        "success-text": "hsl(var(--success-text))",
        "warning-text": "hsl(var(--warning-text))",
        "info-text": "hsl(var(--info-text))",
        "destructive-text": "hsl(var(--destructive-text))",
        chat: {
          bg: "hsl(var(--chat-bg))",
          surface: "hsl(var(--chat-surface))",
          "surface-2": "hsl(var(--chat-surface-2))",
          border: "hsl(var(--chat-border))",
          text: "hsl(var(--chat-text))",
          muted: "hsl(var(--chat-muted))",
          accent: "hsl(var(--chat-accent))",
          "accent-foreground": "hsl(var(--chat-accent-foreground))",
          "bubble-theirs": "hsl(var(--chat-bubble-theirs))",
          "bubble-theirs-foreground": "hsl(var(--chat-bubble-theirs-foreground))",
          "bubble-mine": "hsl(var(--chat-bubble-mine))",
          "bubble-mine-foreground": "hsl(var(--chat-bubble-mine-foreground))",
          "system-bg": "hsl(var(--chat-system-bg))",
          "system-foreground": "hsl(var(--chat-system-foreground))",
          unread: "hsl(var(--chat-unread))",
          "sla-ok": "hsl(var(--chat-sla-ok))",
          "sla-warn": "hsl(var(--chat-sla-warn))",
          "sla-bad": "hsl(var(--chat-sla-bad))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          "muted-foreground": "hsl(var(--sidebar-muted-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          hover: "hsl(var(--sidebar-hover))",
          "hover-foreground": "hsl(var(--sidebar-hover-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        "gradient-brand": "var(--gradient-brand)",
        "gradient-soft": "var(--gradient-soft)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // Flash sutil 2× para sinalizar "você foi navegado até aqui"
        // (uso: classe `row-flash`, aplicada via lib/uiSignals.flashHighlight)
        "row-flash": {
          "0%, 100%": { backgroundColor: "transparent" },
          "20%, 60%": { backgroundColor: "hsl(38 92% 50% / 0.28)" },
          "40%, 80%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "row-flash": "row-flash 1.6s ease-in-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
