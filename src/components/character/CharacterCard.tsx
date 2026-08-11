"use client";

import Image from "next/image";
import { useState } from "react";
import type { AICharacter } from "@/game/ai/roster";
import { getRandomLine } from "@/game/persona/lines";
import { cn } from "@/lib/utils";

interface CharacterCardProps {
  character: AICharacter;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}

/**
 * 拳皇式选角卡：默认展示代表性台词，悬停/点击时从台词池随机换一条，
 * 对应 docs/UI_DESIGN.md 四、选角页设计。
 */
export function CharacterCard({ character, selected, dimmed, onSelect }: CharacterCardProps) {
  const [line, setLine] = useState(character.tagline);

  const rerollLine = () => {
    setLine((prev) => getRandomLine(character.id, "hunting", "calm", prev));
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={rerollLine}
      className={cn(
        "pixel-border pixel-press flex w-full max-w-[260px] flex-col items-center gap-3 border-border bg-card p-4 text-left transition-all duration-200",
        selected ? "scale-105" : dimmed ? "opacity-45" : "opacity-90 hover:opacity-100"
      )}
      style={{
        borderColor: selected ? `var(${character.themeColorVar})` : undefined,
        boxShadow: selected ? `0 0 18px var(${character.themeColorVar})` : undefined,
      }}
    >
      <div
        className="pixel-border relative h-[140px] w-[140px] overflow-hidden"
        style={{ borderColor: `var(${character.themeColorVar})` }}
      >
        <Image src={character.avatarSrc} alt={character.name} fill className="object-cover" sizes="140px" />
      </div>

      <p className="font-pixel text-base" style={{ color: `var(${character.themeColorVar})` }}>
        {character.name}
      </p>
      <p className="font-pixel text-[9px] text-muted-foreground">{character.title}</p>

      <p className="min-h-[2.6rem] text-center text-xs text-foreground/90">「{line}」</p>

      <div className="w-full">
        <p className="mb-1 font-pixel text-[8px] text-muted-foreground">挑战强度</p>
        <div className="h-3 w-full border border-border bg-background">
          <div
            className="h-full transition-all"
            style={{
              width: `${character.challengeLevel}%`,
              backgroundColor: `var(${character.themeColorVar})`,
            }}
          />
        </div>
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        {character.description}
      </p>
    </button>
  );
}
