"use client";

import { useSyncExternalStore } from "react";
import { setActiveSpec } from "@/game/ai/mysteryRuntime";
import { loadGrowthState, saveGrowthState, type GrowthState } from "./growthStorage";

/**
 * 成长存档的进程内缓存 + 订阅通知。
 *
 * 用 useSyncExternalStore 而不是"mount 后 useEffect 里 setState"来读取存档：
 * localStorage 本质上就是一个外部存储，服务端渲染阶段固定返回 null，
 * 由 React 在 hydrate 之后自动切换到客户端快照，天然避开 hydration mismatch。
 */
let cache: GrowthState | null = null;
const listeners = new Set<() => void>();

function ensureLoaded(): GrowthState {
  if (!cache) {
    cache = loadGrowthState();
    // 决策器每 tick 都要读基因，这里同步一份到内存，避免对局中反复读存储
    setActiveSpec(cache.spec);
  }
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): GrowthState | null {
  if (typeof window === "undefined") return null;
  return ensureLoaded();
}

function getServerSnapshot(): GrowthState | null {
  return null;
}

/** 写入新存档：同时落盘、同步基因、通知所有订阅者 */
export function commitGrowthState(next: GrowthState) {
  cache = next;
  saveGrowthState(next);
  setActiveSpec(next.spec);
  for (const listener of listeners) listener();
}

/** 读取当前存档；SSR 与 hydration 首帧返回 null，调用方需要处理"还没读到"的状态 */
export function useGrowthState(): GrowthState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** 非组件环境读取当前存档（例如事件回调里） */
export function readGrowthState(): GrowthState {
  return ensureLoaded();
}
