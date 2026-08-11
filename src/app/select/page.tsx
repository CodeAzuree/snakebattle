"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AI_CHARACTER_IDS, AI_ROSTER } from "@/game/ai/roster";
import type { AICharacterId } from "@/game/types";
import { CharacterCard } from "@/components/character/CharacterCard";
import { CountdownOverlay } from "@/components/hud/CountdownOverlay";
import { Button } from "@/components/ui/8bit/button";
import { COUNTDOWN_SECONDS } from "@/lib/constants";

export default function SelectPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<AICharacterId | null>(null);
  const [countingDown, setCountingDown] = useState(false);

  return (
    <main className="relative flex min-h-screen flex-col items-center gap-10 px-6 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-pixel text-2xl text-neon-cyan sm:text-3xl">选择你的对手</h1>
        <p className="text-xs text-muted-foreground">
          点击卡片选中对手，鼠标悬停可试听更多台词
        </p>
      </div>

      <div className="flex w-full max-w-5xl flex-col items-center justify-center gap-6 sm:flex-row sm:items-stretch">
        {AI_CHARACTER_IDS.map((id) => {
          const character = AI_ROSTER[id];
          return (
            <CharacterCard
              key={id}
              character={character}
              selected={selectedId === id}
              dimmed={selectedId !== null && selectedId !== id}
              onSelect={() => setSelectedId(id)}
            />
          );
        })}
      </div>

      <div className="h-16">
        {selectedId && (
          <Button
            size="lg"
            className="font-pixel text-sm"
            onClick={() => setCountingDown(true)}
          >
            开始对战
          </Button>
        )}
      </div>

      {countingDown && selectedId && (
        <div className="fixed inset-0 z-30">
          <CountdownOverlay
            seconds={COUNTDOWN_SECONDS}
            onDone={() => router.push(`/play?ai=${selectedId}`)}
          />
          <button
            type="button"
            onClick={() => setCountingDown(false)}
            className="absolute bottom-10 left-1/2 z-40 -translate-x-1/2 font-pixel text-[10px] text-muted-foreground underline underline-offset-4"
          >
            返回重选
          </button>
        </div>
      )}
    </main>
  );
}
