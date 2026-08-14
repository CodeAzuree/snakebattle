"use client";

import { useMemo } from "react";
import Image from "next/image";
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
import type { PersonaLineOverride } from "@/game/persona/lines";
import type { EvolutionReadiness } from "@/lib/growthStorage";

interface ResultModalProps {
  state: GameState;
  character: AICharacter;
  onRematch: () => void;
  /** 自学习 AI 攒够数据后，把玩家引导回选角页发起进化 */
  onEvolve?: () => void;
  /** 自学习 AI 的结算台词覆盖 */
  endingLineOverride?: PersonaLineOverride["ending"];
  /** 自学习 AI 的数据积累进度；局末只提示，不在这里触发大模型 */
  growthNotice?: EvolutionReadiness | null;
  growthStage?: string;
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
export function ResultModal({
  state,
  character,
  onRematch,
  onEvolve,
  endingLineOverride,
  growthNotice,
  growthStage,
}: ResultModalProps) {
  const router = useRouter();
  const { result } = state;

  const endingLine = useMemo(
    () =>
      result ? getEndingLine(character.id, result, { ending: endingLineOverride }) : "",
    [result, character.id, endingLineOverride]
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

        <div className="flex items-start gap-3">
          <div
            className="pixel-border relative h-14 w-14 flex-shrink-0 overflow-hidden bg-card"
            style={{ borderColor: `var(${character.themeColorVar})` }}
          >
            <Image
              src={character.avatarSrc}
              alt={character.name}
              fill
              className="object-cover"
              sizes="56px"
            />
          </div>
          <div
            className="relative flex-1 border-2 bg-background/60 p-3 text-xs leading-relaxed"
            style={{ borderColor: `var(${character.themeColorVar})` }}
          >
            {endingLine}
            <span
              className="absolute -left-[9px] top-4 h-3 w-3 rotate-45 border-b-2 border-l-2 bg-background/60"
              style={{ borderColor: `var(${character.themeColorVar})` }}
              aria-hidden="true"
            />
          </div>
        </div>

        {growthNotice && (
          <div
            className="pixel-border space-y-2 bg-background/60 p-3"
            style={{ borderColor: `var(${character.themeColorVar})` }}
          >
            <div className="flex items-center justify-between font-pixel text-[10px]">
              <span style={{ color: `var(${character.themeColorVar})` }}>
                {growthNotice.ready
                  ? "它攒够素材了"
                  : result === "ai"
                    ? "这一局它赢了"
                    : "它记下了这一局"}
              </span>
              {growthStage && <span className="text-muted-foreground">{growthStage}</span>}
            </div>
            <p className="text-xs leading-relaxed">
              {growthNotice.ready
                ? `${growthNotice.pending} 场败绩或平局已经够它复盘一次了。回选角页发起进化，才能继续挑战它。`
                : result === "ai"
                  ? `赢了不计入复盘。已积累 ${growthNotice.pending}/${growthNotice.required} 场败绩或平局，可以继续挑战。`
                  : `已积累 ${growthNotice.pending}/${growthNotice.required} 场败绩或平局。再让它输掉或打平 ${Math.max(
                      1,
                      growthNotice.required - growthNotice.pending
                    )} 局，就能复盘进化。`}
            </p>
          </div>
        )}

        <DialogFooter className="flex-col gap-5 sm:flex-col">
          {growthNotice?.ready && onEvolve ? (
            <Button className="w-full" onClick={onEvolve}>
              去让它进化
            </Button>
          ) : (
            <Button className="w-full" onClick={onRematch}>
              再来一局
            </Button>
          )}
          <Button variant="outline" className="w-full" onClick={() => router.push("/")}>
            返回首页
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
