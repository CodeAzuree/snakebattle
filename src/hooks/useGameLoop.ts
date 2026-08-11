"use client";

import { useEffect, useRef } from "react";

/**
 * 以固定频率驱动游戏 tick，对应 docs/DESIGN.md 2.1 节的固定速度设定。
 */
export function useGameLoop(callback: () => void, tickMs: number, enabled: boolean) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => savedCallback.current(), tickMs);
    return () => clearInterval(id);
  }, [enabled, tickMs]);
}
