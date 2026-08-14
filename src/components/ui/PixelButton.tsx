"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "solid" | "outline";
  /** 强调色，默认用主题青色 */
  accent?: string;
}

/**
 * 与选角页速度档位一致的像素按钮。
 *
 * 8bit 的 Button 用绝对定位的装饰块拼边框，多个按钮并排时会互相压边，
 * 在密集的面板里显得脏；这里回到项目自己的 pixel-border 风格保持一致。
 * 禁用态用斜纹锁住、不靠透明度，避免融进面板底。
 */
export function PixelButton({
  tone = "outline",
  accent = "var(--neon-cyan)",
  className,
  style,
  disabled,
  ...props
}: PixelButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "pixel-border px-4 py-2 font-pixel text-xs transition-colors",
        disabled ? "cursor-not-allowed" : "pixel-press",
        tone === "outline" && !disabled && "hover:text-foreground",
        className
      )}
      style={
        disabled
          ? {
              // 禁用不能靠透明度——会融进面板底，看起来像坏了而不是锁住。
              // 斜纹 + 压掉硬投影：还是一颗按钮，但明确按不下去。
              borderColor: "var(--muted-foreground)",
              color: "var(--muted-foreground)",
              backgroundColor: "var(--muted)",
              backgroundImage:
                "repeating-linear-gradient(-45deg, transparent, transparent 3px, color-mix(in srgb, var(--foreground) 10%, transparent) 3px, color-mix(in srgb, var(--foreground) 10%, transparent) 6px)",
              boxShadow: "none",
              ...style,
            }
          : {
              borderColor: accent,
              color: tone === "solid" ? "var(--primary-foreground)" : accent,
              backgroundColor:
                tone === "solid" ? accent : "color-mix(in srgb, var(--card) 92%, transparent)",
              ...style,
            }
      }
      {...props}
    />
  );
}
