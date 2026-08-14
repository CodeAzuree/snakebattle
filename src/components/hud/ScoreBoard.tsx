import type { GameState } from "@/game/types";

interface ScoreBoardProps {
  state: GameState;
  aiName: string;
  aiThemeColorVar: string;
  /** 对局页窄屏/横屏用单行紧凑条，避免误用 md 大字号把视口撑爆 */
  compact?: boolean;
}

export function ScoreBoard({ state, aiName, aiThemeColorVar, compact = false }: ScoreBoardProps) {
  const totalSeconds = Math.ceil(state.timeRemainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const urgent = totalSeconds <= 10;

  return (
    <div
      className={
        compact
          ? "pixel-border flex w-full items-center justify-between border-border bg-card/90 px-2 py-1"
          : "pixel-border flex w-full items-center justify-between border-border bg-card/90 px-3 py-2 md:px-8 md:py-3"
      }
    >
      <div className="flex flex-col items-start gap-0.5">
        <span
          className={
            compact
              ? "font-pixel text-[10px] text-muted-foreground"
              : "font-pixel text-[8px] text-muted-foreground md:text-[9px]"
          }
        >
          PLAYER
        </span>
        <span
          className={
            compact
              ? "font-pixel text-base text-neon-cyan"
              : "font-pixel text-lg text-neon-cyan md:text-2xl"
          }
        >
          {state.player.score}
        </span>
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span
          className={
            compact
              ? "font-pixel text-[10px] text-muted-foreground"
              : "font-pixel text-[8px] text-muted-foreground md:text-[9px]"
          }
        >
          TIME
        </span>
        <span
          className={compact ? "font-pixel text-base" : "font-pixel text-lg md:text-2xl"}
          style={{ color: urgent ? "var(--neon-magenta)" : "var(--foreground)" }}
        >
          {mm}:{ss}
        </span>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span
          className={
            compact
              ? "font-pixel text-[10px] text-muted-foreground"
              : "font-pixel text-[8px] text-muted-foreground md:text-[9px]"
          }
        >
          {aiName.toUpperCase()}
        </span>
        <span
          className={compact ? "font-pixel text-base" : "font-pixel text-lg md:text-2xl"}
          style={{ color: `var(${aiThemeColorVar})` }}
        >
          {state.ai.score}
        </span>
      </div>
    </div>
  );
}
