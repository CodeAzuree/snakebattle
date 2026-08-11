"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/8bit/dialog";
import { Button } from "@/components/ui/8bit/button";
import type { AICharacter } from "@/game/ai/roster";
import type { GameState } from "@/game/types";
import { getEndingLine } from "@/game/persona/lines";

interface ResultModalProps {
  state: GameState;
  character: AICharacter;
}

const RESULT_LABEL: Record<NonNullable<GameState["result"]>, string> = {
  player: "VICTORY",
  ai: "DEFEAT",
  draw: "DRAW",
};

/**
 * 结算弹层：结果大字 + 双方分数 + AI 专属彩蛋台词，
 * 对应 docs/UI_DESIGN.md 六、结算弹层设计。
 */
export function ResultModal({ state, character }: ResultModalProps) {
  const router = useRouter();
  const { result } = state;

  const endingLine = useMemo(
    () => (result ? getEndingLine(character.id, result) : ""),
    [result, character.id]
  );

  if (!result) return null;

  const themeColor =
    result === "player"
      ? "var(--neon-cyan)"
      : result === "ai"
        ? `var(${character.themeColorVar})`
        : "var(--muted-foreground)";

  return (
    <Dialog open>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-center text-3xl tracking-wider" style={{ color: themeColor }}>
            {RESULT_LABEL[result]}
          </DialogTitle>
          <DialogDescription className="text-center font-pixel text-xs">
            玩家 {state.player.score} : {state.ai.score} {character.name}
          </DialogDescription>
        </DialogHeader>

        <div
          className="border-2 bg-background/60 p-3 text-center text-xs leading-relaxed"
          style={{ borderColor: `var(${character.themeColorVar})` }}
        >
          {endingLine}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={() => router.push("/select")}>
            再来一局
          </Button>
          <Button variant="outline" className="w-full" onClick={() => router.push("/")}>
            返回首页
          </Button>
          <a
            href="/about"
            className="text-center text-[10px] text-muted-foreground underline underline-offset-4"
          >
            查看 AI 设计说明
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
