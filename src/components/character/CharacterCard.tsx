"use client";

import Image from "next/image";
import type { AICharacter } from "@/game/ai/roster";
import { PixelMeter } from "@/components/ui/PixelMeter";
import { PixelChip } from "@/components/ui/PixelPanel";
import { cn } from "@/lib/utils";

interface CharacterCardProps {
  character: AICharacter;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  /** 卡片顶部的小标签，目前用于展示自学习体的成长进度 */
  badge?: string;
  /** warn 用于"它攒够数据了、正等着进化"这类需要玩家注意的状态 */
  badgeTone?: "info" | "warn";
}

/**
 * 拳皇式选角卡：固定展示角色代表台词，去除鼠标悬停换词与简介文字，
 * 用更大的头像与三级发光层次（未选中 < 悬停 < 选中）强化沉浸感，
 * 对应 docs/UI_DESIGN.md 四、选角页设计。
 */
export function CharacterCard({
  character,
  selected,
  dimmed,
  onSelect,
  badge,
  badgeTone = "info",
}: CharacterCardProps) {
  const themeColor = `var(${character.themeColorVar})`;
  const badgeColor = badgeTone === "warn" ? "var(--neon-magenta)" : themeColor;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "pixel-border pixel-press flex w-full max-w-[260px] flex-col items-center gap-3 border-border bg-card p-4 text-left transition-all duration-200",
        selected
          ? "scale-105"
          : dimmed
            ? "opacity-45"
            : "opacity-90 hover:scale-[1.02] hover:opacity-100"
      )}
      style={{
        borderColor: selected ? `var(${character.themeColorVar})` : undefined,
        boxShadow: selected
          ? `0 0 24px var(${character.themeColorVar})`
          : dimmed
            ? undefined
            : `0 0 0 var(${character.themeColorVar})`,
      }}
      onMouseEnter={(e) => {
        if (selected || dimmed) return;
        e.currentTarget.style.boxShadow = `0 0 12px var(${character.themeColorVar})`;
      }}
      onMouseLeave={(e) => {
        if (selected || dimmed) return;
        e.currentTarget.style.boxShadow = `0 0 0 var(${character.themeColorVar})`;
      }}
    >
      <div
        className="pixel-border relative h-[180px] w-[180px] overflow-hidden"
        style={{ borderColor: `var(${character.themeColorVar})` }}
      >
        <Image src={character.avatarSrc} alt={character.name} fill className="object-cover" sizes="180px" />
      </div>

      <p className="font-pixel text-lg" style={{ color: themeColor }}>
        {character.name}
      </p>

      {badge && (
        <PixelChip accent={badgeColor} pulse={badgeTone === "warn"} className="max-w-full">
          {badge}
        </PixelChip>
      )}

      <p className="min-h-[2.8rem] text-center text-sm leading-relaxed text-foreground/90">
        「{character.tagline}」
      </p>

      <div className="mt-auto w-full space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="font-pixel text-[11px] text-muted-foreground">挑战强度</span>
          <span className="font-pixel text-[11px]" style={{ color: themeColor }}>
            {character.challengeLevel}
          </span>
        </div>
        <PixelMeter value={character.challengeLevel} color={themeColor} segments={12} />
      </div>
    </button>
  );
}
