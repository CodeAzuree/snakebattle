import type { GameState } from "@/game/types";

interface ScoreBoardProps {
  state: GameState;
  aiName: string;
  aiThemeColorVar: string;
}

export function ScoreBoard({ state, aiName, aiThemeColorVar }: ScoreBoardProps) {
  const totalSeconds = Math.ceil(state.timeRemainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const urgent = totalSeconds <= 10;

  return (
    <div className="pixel-border flex w-full items-center justify-between border-border bg-card/90 px-4 py-3 sm:px-8">
      <div className="flex flex-col items-start gap-1">
        <span className="font-pixel text-[9px] text-muted-foreground">PLAYER</span>
        <span className="font-pixel text-xl text-neon-cyan sm:text-2xl">{state.player.score}</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="font-pixel text-[9px] text-muted-foreground">TIME</span>
        <span
          className="font-pixel text-xl sm:text-2xl"
          style={{ color: urgent ? "var(--neon-magenta)" : "var(--foreground)" }}
        >
          {mm}:{ss}
        </span>
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="font-pixel text-[9px] text-muted-foreground">
          {aiName.toUpperCase()}
        </span>
        <span
          className="font-pixel text-xl sm:text-2xl"
          style={{ color: `var(${aiThemeColorVar})` }}
        >
          {state.ai.score}
        </span>
      </div>
    </div>
  );
}
