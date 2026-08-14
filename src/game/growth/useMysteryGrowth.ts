"use client";

import { useCallback, useMemo, useState } from "react";
import type { MatchSummary } from "@/game/replay";
import type { DynamicPersona } from "@/game/persona/useAIState";
import {
  appendMatchSummary,
  evolutionReadiness,
  type EvolutionReadiness,
} from "@/lib/growthStorage";
import { commitGrowthState, readGrowthState, useGrowthState } from "@/lib/growthStore";

/**
 * 自学习 AI 的对局侧逻辑：加载存档、把基因同步给决策器、局末把摘要计入存档。
 *
 * 这里刻意不再触发任何大模型调用——进化改为攒够数据后由玩家在选角页手动发起，
 * 一局的数据既不够看，每局都调用也太费。
 *
 * 存档只在浏览器 mount 之后读取，避免服务端渲染时读到不存在的 localStorage
 * 而产生 hydration mismatch。
 */
export function useMysteryGrowth(enabled: boolean) {
  const stored = useGrowthState();
  const growth = enabled ? stored : null;
  const [readiness, setReadiness] = useState<EvolutionReadiness | null>(null);

  const persona = useMemo<DynamicPersona | undefined>(
    () => (growth ? { tagline: growth.tagline, lines: growth.lines } : undefined),
    [growth]
  );

  const clearReadiness = useCallback(() => setReadiness(null), []);

  const handleMatchEnd = useCallback(
    (summary: MatchSummary) => {
      if (!enabled) return;
      const next = appendMatchSummary(growth ?? readGrowthState(), summary);
      commitGrowthState(next);
      setReadiness(evolutionReadiness(next));
    },
    [enabled, growth]
  );

  return { growth, persona, readiness, handleMatchEnd, clearReadiness };
}
