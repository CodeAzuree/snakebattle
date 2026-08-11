import { AI_ROSTER } from "@/game/ai/roster";
import type { GameState } from "@/game/types";

const CELL_SIZE = 22;

interface BoardProps {
  state: GameState;
}

/**
 * 20×20 网格棋盘。蛇身/食物用绝对定位方块 + transform: translate 表现，
 * 逐格跳跃而非平滑插值，遵循 docs/UI_DESIGN.md 1.4 节的动效原则。
 */
export function Board({ state }: BoardProps) {
  const { gridSize, player, ai, food } = state;
  const boardPx = gridSize * CELL_SIZE;
  const aiCharacter = AI_ROSTER[state.aiCharacterId];

  return (
    <div
      className="pixel-border relative shrink-0 border-border bg-[#08080c]"
      style={{
        width: boardPx,
        height: boardPx,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: `${CELL_SIZE}px ${CELL_SIZE}px`,
      }}
    >
      <div
        className="bg-neon-lime absolute top-0 left-0 rounded-[2px]"
        style={{
          width: CELL_SIZE - 6,
          height: CELL_SIZE - 6,
          transform: `translate(${food.x * CELL_SIZE + 3}px, ${food.y * CELL_SIZE + 3}px)`,
          boxShadow: "0 0 6px var(--neon-lime)",
        }}
      />

      {player.body.map((seg, i) => (
        <div
          key={`player-${i}`}
          className="absolute top-0 left-0 rounded-[1px]"
          style={{
            width: CELL_SIZE - 2,
            height: CELL_SIZE - 2,
            transform: `translate(${seg.x * CELL_SIZE + 1}px, ${seg.y * CELL_SIZE + 1}px)`,
            backgroundColor: "var(--neon-cyan)",
            opacity: player.alive ? (i === 0 ? 1 : 0.75) : 0.25,
          }}
        />
      ))}

      {ai.body.map((seg, i) => (
        <div
          key={`ai-${i}`}
          className="absolute top-0 left-0 rounded-[1px]"
          style={{
            width: CELL_SIZE - 2,
            height: CELL_SIZE - 2,
            transform: `translate(${seg.x * CELL_SIZE + 1}px, ${seg.y * CELL_SIZE + 1}px)`,
            backgroundColor: `var(${aiCharacter.themeColorVar})`,
            opacity: ai.alive ? (i === 0 ? 1 : 0.75) : 0.25,
          }}
        />
      ))}
    </div>
  );
}
