"use client";

import { useRef } from "react";
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

function isDirection(value: string | null): value is Direction {
  return value === "UP" || value === "DOWN" || value === "LEFT" || value === "RIGHT";
}

/**
 * 触屏十字键：按下立刻排队方向（短按也能赶到下一 tick），按住则持续转向。
 * 指针捕获在整个十字键上，可在键与键之间滑动换向；松手后若没有其他手指再清空。
 * 仅在 (pointer: coarse) 下显示，桌面鼠标布局不出现。
 */
export function VirtualDPad({
  onHold,
  onRelease,
  className,
  size = "md",
  floating = false,
}: VirtualDPadProps) {
  const pointersRef = useRef(new Map<number, Direction>());

  const emit = () => {
    const held = [...pointersRef.current.values()];
    const last = held[held.length - 1];
    if (last) onHold(last);
    else onRelease();
  };

  const directionFromEvent = (e: PointerEvent<HTMLElement>): Direction | null => {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const attr = hit?.closest("[data-pad-dir]")?.getAttribute("data-pad-dir") ?? null;
    return isDirection(attr) ? attr : null;
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const dir = directionFromEvent(e);
    if (!dir) return;
    pointersRef.current.set(e.pointerId, dir);
    emit();
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dir = directionFromEvent(e);
    if (!dir || pointersRef.current.get(e.pointerId) === dir) return;
    pointersRef.current.set(e.pointerId, dir);
    emit();
  };

  const handlePointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!pointersRef.current.has(e.pointerId) && !e.currentTarget.hasPointerCapture(e.pointerId)) {
      return;
    }
    pointersRef.current.delete(e.pointerId);
    emit();
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
        "pointer-events-none hidden pointer-coarse:grid grid-cols-3 grid-rows-3 touch-none select-none bg-transparent",
        padGap,
        className
      )}
      aria-label="方向键"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {PAD_LAYOUT.flatMap((row, y) =>
        row.map((direction, x) => {
          if (!direction) {
            return <div key={`${y}-${x}`} aria-hidden="true" className="pointer-events-none" />;
          }
          return (
            <button
              key={direction}
              type="button"
              data-pad-dir={direction}
              aria-label={LABEL[direction]}
              className={cn(
                "pointer-events-auto flex items-center justify-center border-2 font-pixel text-neon-cyan",
                buttonSize,
                "border-neon-cyan/45 bg-transparent active:bg-neon-cyan/20"
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
