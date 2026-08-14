import { AI_ROSTER } from "@/game/ai/roster";
import type { GameState } from "@/game/types";
import { DEFAULT_CELL_SIZE } from "@/hooks/useBoardCellSize";

interface BoardProps {
  state: GameState;
  /** 桌面默认 22；窄屏由容器宽高取整缩放 */
  cellSize?: number;
}

/**
 * 20×20 网格棋盘。蛇身/食物用绝对定位方块 + transform: translate 表现，
 * 逐格跳跃而非平滑插值，遵循 docs/UI_DESIGN.md 1.4 节的动效原则。
 */
export function Board({ state, cellSize = DEFAULT_CELL_SIZE }: BoardProps) {
  const { gridSize, player, ai, food } = state;
  const boardPx = gridSize * cellSize;
  const aiCharacter = AI_ROSTER[state.aiCharacterId];
  const foodSize = Math.max(4, cellSize - 6);
  const foodOffset = Math.max(1, Math.floor((cellSize - foodSize) / 2));
  const segmentSize = Math.max(4, cellSize - 2);
  const segmentOffset = Math.max(0, Math.floor((cellSize - segmentSize) / 2));

  return (
    <div
      className="pixel-border relative shrink-0 touch-none border-border bg-[#08080c]"
      style={{
        width: boardPx,
        height: boardPx,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: `${cellSize}px ${cellSize}px`,
      }}
    >
      <div
        className="bg-neon-lime absolute top-0 left-0 rounded-[2px]"
        style={{
          width: foodSize,
          height: foodSize,
          transform: `translate(${food.x * cellSize + foodOffset}px, ${food.y * cellSize + foodOffset}px)`,
          boxShadow: "0 0 6px var(--neon-lime)",
        }}
      />

      {player.body.map((seg, i) => (
        <div
          key={`player-${i}`}
          className="absolute top-0 left-0 rounded-[1px]"
          style={{
            width: segmentSize,
            height: segmentSize,
            transform: `translate(${seg.x * cellSize + segmentOffset}px, ${seg.y * cellSize + segmentOffset}px)`,
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
            width: segmentSize,
            height: segmentSize,
            transform: `translate(${seg.x * cellSize + segmentOffset}px, ${seg.y * cellSize + segmentOffset}px)`,
            backgroundColor: `var(${aiCharacter.themeColorVar})`,
            opacity: ai.alive ? (i === 0 ? 1 : 0.75) : 0.25,
          }}
        />
      ))}
    </div>
  );
}
