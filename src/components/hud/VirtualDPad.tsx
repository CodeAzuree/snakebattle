"use client";

import type { PointerEvent } from "react";
import type { Direction } from "@/game/types";
import { cn } from "@/lib/utils";

interface VirtualDPadProps {
  onHold: (direction: Direction) => void;
  onRelease: () => void;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** 半透明样式；compact 对局走文档流分区，不再 overlay */
  floating?: boolean;
}

const PAD_LAYOUT: (Direction | null)[][] = [
  [null, "UP", null],
  ["LEFT", null, "RIGHT"],
  [null, "DOWN", null],
];

const ARROW: Record<Direction, string> = {
  UP: "▲",
  DOWN: "▼",
  LEFT: "◀",
  RIGHT: "▶",
};

const LABEL: Record<Direction, string> = {
  UP: "向上",
  DOWN: "向下",
  LEFT: "向左",
  RIGHT: "向右",
};

/**
 * 触屏十字键：pointerdown 写入按住方向，松手清空。
 * 仅在 (pointer: coarse) 下显示，桌面鼠标布局不出现。
 */
export function VirtualDPad({
  onHold,
  onRelease,
  className,
  size = "md",
  floating = false,
}: VirtualDPadProps) {
  const handlePointerDown = (direction: Direction) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    onHold(direction);
  };

  const handlePointerEnd = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    onRelease();
  };

  const buttonSize =
    size === "xs"
      ? "h-9 w-9 text-[10px]"
      : size === "sm"
        ? "h-11 w-11"
        : size === "lg"
          ? "h-14 w-14"
          : "h-12 w-12";
  const padGap = size === "lg" ? "gap-1.5" : "gap-1";

  return (
    <div
      className={cn(
        "hidden pointer-coarse:grid grid-cols-3 grid-rows-3 touch-manipulation select-none",
        padGap,
        className
      )}
      aria-label="方向键"
      onContextMenu={(e) => e.preventDefault()}
    >
      {PAD_LAYOUT.flatMap((row, y) =>
        row.map((direction, x) => {
          if (!direction) {
            return <div key={`${y}-${x}`} aria-hidden="true" />;
          }
          return (
            <button
              key={direction}
              type="button"
              aria-label={LABEL[direction]}
              onPointerDown={handlePointerDown(direction)}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              className={cn(
                "flex items-center justify-center border-2 font-pixel text-neon-cyan",
                buttonSize,
                floating
                  ? "border-neon-cyan/55 bg-background/35 backdrop-blur-[2px] active:bg-neon-cyan/25"
                  : "pixel-border pixel-press border-border bg-card active:bg-neon-cyan/20"
              )}
            >
              {ARROW[direction]}
            </button>
          );
        })
      )}
    </div>
  );
}
