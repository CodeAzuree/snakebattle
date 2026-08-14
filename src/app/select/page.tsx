"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AI_CHARACTER_IDS, AI_ROSTER } from "@/game/ai/roster";
import type { AICharacterId } from "@/game/types";
import { CharacterCard } from "@/components/character/CharacterCard";
import { EvolutionPanel } from "@/components/character/EvolutionPanel";
import { Button } from "@/components/ui/8bit/button";
import { resetEvolutionRun, useEvolutionRun } from "@/game/growth/evolutionStore";
import { DEFAULT_GAME_SPEED_ID, GAME_SPEED_PRESETS } from "@/lib/constants";
import type { GameSpeedId } from "@/lib/constants";
import { estimateChallengeLevel, evolutionReadiness, type GrowthState } from "@/lib/growthStorage";
import { commitGrowthState, useGrowthState } from "@/lib/growthStore";
import { cn } from "@/lib/utils";

export default function SelectPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<AICharacterId | null>(null);
  const [speedId, setSpeedId] = useState<GameSpeedId>(DEFAULT_GAME_SPEED_ID);

  // 存档来自 localStorage，服务端渲染阶段为 null，hydrate 之后才有值
  const growth = useGrowthState();
  const evolutionRun = useEvolutionRun();

  const readiness = growth ? evolutionReadiness(growth) : null;
  // 攒够数据未进化、或正在进化时都不允许挑战它：
  // 前者是"先让它复盘完再打"的成长节奏，后者是避免拿一份正在被改写的基因对战
  const mysteryLocked =
    (readiness?.ready ?? false) || evolutionRun.phase === "running";
  const locksSelection = selectedId === "mystery" && mysteryLocked;

  const handleArchiveChange = (next: GrowthState) => {
    resetEvolutionRun();
    commitGrowthState(next);
  };

  const startBattle = () => {
    if (!selectedId || locksSelection) return;
    const tickMs = GAME_SPEED_PRESETS.find((preset) => preset.id === speedId)?.tickMs;
    router.push(`/play?ai=${selectedId}&speed=${tickMs}`);
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center gap-10 px-6 py-12">
      {/* 次级动作：沿用速度档位那套 pixel-border，默认压成灰色，hover 才亮起主题青 */}
      <Link
        href="/"
        className="pixel-border pixel-press group absolute top-8 left-8 flex items-center gap-2.5 border-border bg-card px-4 py-2.5 font-pixel text-xs text-muted-foreground transition-colors hover:border-neon-cyan hover:text-neon-cyan"
      >
        <span className="transition-transform group-hover:-translate-x-0.5">←</span>
        标题页
      </Link>

      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-pixel text-2xl text-neon-cyan sm:text-3xl">选择你的对手</h1>
        <p className="text-sm text-muted-foreground">点击卡片选中对手</p>
      </div>

      <div className="grid w-full max-w-6xl grid-cols-1 justify-items-center gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {AI_CHARACTER_IDS.map((id) => {
          const base = AI_ROSTER[id];
          // 自学习体没有预设人设：名字、标语与强度全部来自它自己的成长存档
          const isMystery = id === "mystery";
          const character =
            isMystery && growth
              ? {
                  ...base,
                  name: growth.name,
                  tagline: growth.tagline,
                  challengeLevel: estimateChallengeLevel(growth),
                }
              : base;
          const badge = isMystery
            ? evolutionRun.phase === "running"
              ? "进化中…"
              : readiness?.ready
                ? "数据已攒够 · 待进化"
                : growth
                  ? `第 ${growth.generation} 代 · 已对战 ${growth.matchCount} 局`
                  : "尚未觉醒"
            : undefined;

          return (
            <CharacterCard
              key={id}
              character={character}
              selected={selectedId === id}
              dimmed={selectedId !== null && selectedId !== id}
              onSelect={() => setSelectedId(id)}
              badge={badge}
              badgeTone={isMystery && mysteryLocked ? "warn" : "info"}
            />
          );
        })}
      </div>

      {selectedId === "mystery" && growth && (
        <div className="w-full max-w-xl">
          <EvolutionPanel
            growth={growth}
            onChange={handleArchiveChange}
            themeColorVar={AI_ROSTER.mystery.themeColorVar}
          />
        </div>
      )}

      {/* 三个档位拼成一条分段开关：比三块各自带投影的独立按钮更像一个整体控件 */}
      <div className="flex items-center gap-4">
        <span className="font-pixel text-xs tracking-wider text-muted-foreground">速度</span>
        <div className="pixel-border flex border-border bg-card">
          {GAME_SPEED_PRESETS.map((preset) => {
            const active = speedId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSpeedId(preset.id)}
                className={cn(
                  "border-l-2 border-border px-6 py-2.5 font-pixel text-xs transition-colors first:border-l-0",
                  active
                    ? "bg-neon-cyan text-background"
                    : "text-muted-foreground hover:bg-neon-cyan/10 hover:text-neon-cyan"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex h-16 flex-col items-center gap-2">
        {selectedId && (
          <Button
            size="lg"
            className="font-pixel text-sm"
            onClick={startBattle}
            disabled={locksSelection}
          >
            开始对战
          </Button>
        )}
        {locksSelection && (
          <p className="text-sm text-muted-foreground">
            {evolutionRun.phase === "running"
              ? "它正在进化，等它想明白再打。"
              : "它攒够了对局数据 —— 先让它进化一次，才能继续挑战。"}
          </p>
        )}
      </div>
    </main>
  );
}
