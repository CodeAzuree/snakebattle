"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AI_CHARACTER_IDS, AI_ROSTER } from "@/game/ai/roster";
import { createInitialGameState, stepGame } from "@/game/engine";
import type { AICharacterId, Direction } from "@/game/types";
import { useGameLoop } from "@/hooks/useGameLoop";
import { useAIState } from "@/game/persona/useAIState";
import { Board } from "@/components/board/Board";
import { ScoreBoard } from "@/components/hud/ScoreBoard";
import { PortraitPanel } from "@/components/ai-panel/PortraitPanel";
import { ResultModal } from "@/components/result/ResultModal";
import { Button } from "@/components/ui/8bit/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/8bit/dialog";
import { TICK_MS } from "@/lib/constants";

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  w: "UP",
  s: "DOWN",
  a: "LEFT",
  d: "RIGHT",
  W: "UP",
  S: "DOWN",
  A: "LEFT",
  D: "RIGHT",
};

function isValidCharacterId(value: string | null): value is AICharacterId {
  return !!value && (AI_CHARACTER_IDS as string[]).includes(value);
}

function PlayGame({ aiCharacterId }: { aiCharacterId: AICharacterId }) {
  const router = useRouter();
  const [state, setState] = useState(() => createInitialGameState(aiCharacterId));
  const pendingDirectionRef = useRef<Direction | null>(null);
  const character = AI_ROSTER[aiCharacterId];
  const { speech } = useAIState(state);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const direction = KEY_TO_DIRECTION[e.key];
      if (direction) {
        pendingDirectionRef.current = direction;
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        setState((prev) => {
          if (prev.phase === "playing") return { ...prev, phase: "paused" };
          if (prev.phase === "paused") return { ...prev, phase: "playing" };
          return prev;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useGameLoop(
    () => {
      setState((prev) => stepGame(prev, pendingDirectionRef.current));
      pendingDirectionRef.current = null;
    },
    TICK_MS,
    state.phase === "playing"
  );

  const togglePause = () => {
    setState((prev) => ({
      ...prev,
      phase:
        prev.phase === "playing" ? "paused" : prev.phase === "paused" ? "playing" : prev.phase,
    }));
  };

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-4 py-8">
      <div className="w-full max-w-4xl">
        <ScoreBoard state={state} aiName={character.name} aiThemeColorVar={character.themeColorVar} />
      </div>

      <div className="relative flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-8 sm:flex-row sm:items-start sm:justify-center">
        <button
          type="button"
          onClick={togglePause}
          aria-label="暂停"
          className="pixel-border pixel-press absolute -top-2 right-0 z-10 flex h-9 w-9 items-center justify-center border-border bg-card font-pixel text-xs sm:top-0"
        >
          ❚❚
        </button>

        <Board state={state} />
        <PortraitPanel character={character} speech={speech} />
      </div>

      {state.phase === "paused" && (
        <Dialog open>
          <DialogContent className="max-w-xs" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle className="text-center">已暂停</DialogTitle>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button className="w-full" onClick={togglePause}>
                继续
              </Button>
              <Button variant="outline" className="w-full" onClick={() => router.push("/")}>
                返回首页
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ResultModal state={state} character={character} />
    </main>
  );
}

function PlayPageInner() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("ai");
  const aiCharacterId = isValidCharacterId(requested) ? requested : "laomou";
  return <PlayGame key={aiCharacterId} aiCharacterId={aiCharacterId} />;
}

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayPageInner />
    </Suspense>
  );
}
