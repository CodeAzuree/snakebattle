"use client";

import { useEffect, useState } from "react";

export const DEFAULT_CELL_SIZE = 22;
export const MIN_CELL_SIZE = 8;
const MD_BREAKPOINT_PX = 768;

interface BoardCellSizeOptions {
  /** 横屏右栏占用的宽度，从槽位里扣掉再算格子 */
  insetRight?: number;
  /** 竖屏底栏最小高度，从槽位里扣掉再算格子 */
  insetBottom?: number;
  /**
   * 布局切换时槽位 DOM 会换节点。传 compact/landscape 等，确保重新观察新槽。
   */
  layoutKey?: string;
}

/**
 * 按 flex 槽位宽高取整缩放格子。必须观察「分配出来的空槽」，不能观察棋盘自身。
 * 桌面视口始终 22px；compact 按槽位铺满正方形，可大于 22px，下限 8px 以保证整板可见。
 */
export function useBoardCellSize(gridSize: number, options: BoardCellSizeOptions = {}) {
  const { insetRight = 0, insetBottom = 0, layoutKey = "" } = options;
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [cellSize, setCellSize] = useState(DEFAULT_CELL_SIZE);

  useEffect(() => {
    if (!el) return;

    const update = () => {
      const preferDesktopSize = window.matchMedia(
        `(min-width: ${MD_BREAKPOINT_PX}px) and (min-height: 501px)`
      ).matches;
      if (preferDesktopSize) {
        setCellSize(DEFAULT_CELL_SIZE);
        return;
      }
      const available = Math.min(
        Math.max(0, el.clientWidth - insetRight),
        Math.max(0, el.clientHeight - insetBottom)
      );
      // 卸载旧槽或 flex 尚未撑开时会量到 0；写成 8px 会把棋盘钉死在巴掌大
      if (available < MIN_CELL_SIZE * gridSize) return;
      setCellSize(Math.floor(available / gridSize));
    };

    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [el, gridSize, insetRight, insetBottom, layoutKey]);

  return { containerRef: setEl, cellSize };
}
