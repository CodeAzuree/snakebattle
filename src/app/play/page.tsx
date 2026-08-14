"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AI_CHARACTER_IDS, AI_ROSTER } from "@/game/ai/roster";
import { createInitialGameState, rerollFoodPosition, stepGame } from "@/game/engine";
import { MatchRecorder, deriveMatchSummary } from "@/game/replay";
import { useMysteryGrowth } from "@/game/growth/useMysteryGrowth";
import { useEvolutionRun } from "@/game/growth/evolutionStore";
import type { AICharacterId, Direction } from "@/game/types";
import { useGameLoop } from "@/hooks/useGameLoop";
import { useBoardCellSize } from "@/hooks/useBoardCellSize";
import { useCompactPlay, useMediaQuery } from "@/hooks/useMediaQuery";
import { useAIState } from "@/game/persona/useAIState";
import { Board } from "@/components/board/Board";
import { ScoreBoard } from "@/components/hud/ScoreBoard";
import { PortraitPanel } from "@/components/ai-panel/PortraitPanel";
import { VirtualDPad } from "@/components/hud/VirtualDPad";
import { ResultModal } from "@/components/result/ResultModal";
import { CountdownOverlay } from "@/components/hud/CountdownOverlay";
import { Button } from "@/components/ui/8bit/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/8bit/dialog";
import {
  COUNTDOWN_SECONDS,
  DEFAULT_GAME_SPEED_ID,
  findSpeedPresetByTickMs,
  getSpeedTickMs,
} from "@/lib/constants";

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

const COMPACT_AVATAR_PX = 96;
const PORTRAIT_AVATAR_PX = 128;

function isValidCharacterId(value: string | null): value is AICharacterId {
  return !!value && (AI_CHARACTER_IDS as string[]).includes(value);
}

function PlayGame({
  aiCharacterId,
  tickMs,
}: {
  aiCharacterId: AICharacterId;
  tickMs: number;
}) {
  const router = useRouter();
  const [state, setState] = useState(() => createInitialGameState(aiCharacterId));
  const [countdownDone, setCountdownDone] = useState(false);
  const pendingDirectionRef = useRef<Direction | null>(null);
  const heldDirectionRef = useRef<Direction | null>(null);
  const compactPlay = useCompactPlay();
  const landscape = useMediaQuery("(orientation: landscape)");
  const { containerRef: boardAreaRef, cellSize } = useBoardCellSize(state.gridSize, {
    layoutKey: compactPlay ? (landscape ? "landscape" : "portrait") : "desktop",
  });

  const isMystery = aiCharacterId === "mystery";
  const { growth, persona, readiness, handleMatchEnd, clearReadiness } = useMysteryGrowth(isMystery);
  const evolutionRun = useEvolutionRun();
  // 玩家可能在进化进行中直接改 URL 回到对战页；此时它的基因正在被改写，不该开打
  const blockedByEvolution = isMystery && evolutionRun.phase === "running";

  const baseCharacter = AI_ROSTER[aiCharacterId];
  // 自学习体的展示名与标语来自成长存档，会随着它的进化而改变
  const character = useMemo(
    () =>
      growth ? { ...baseCharacter, name: growth.name, tagline: growth.tagline } : baseCharacter,
    [baseCharacter, growth]
  );

  const { speech, emotion } = useAIState(state, persona);

  // 初始食物位置固定在中心格（避免 SSR/CSR 各自随机导致 hydration mismatch），
  // mount 之后再在客户端把食物重新随机摆放一次。
  useEffect(() => {
    setState((prev) => rerollFoodPosition(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 逐 tick 记录对局。记录放在 effect 里而不是 stepGame 的 setState 更新函数里，
  // 因为更新函数在开发模式下会被 React 重复调用，写在那里会产生重复记录。
  const recorderRef = useRef<MatchRecorder | null>(null);
  const prevStateRef = useRef(state);
  const matchReportedRef = useRef(false);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;

    if (state.tickCount === 0) {
      recorderRef.current = new MatchRecorder(state, tickMs);
      matchReportedRef.current = false;
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder) return;
    // 只接受严格连续的下一 tick，避免重复执行的 effect 把同一 tick 记录两次
    if (state.tickCount === recorder.tickCount + 1) {
      recorder.track(prev, state);
    }

    if (state.phase === "ended" && !matchReportedRef.current) {
      matchReportedRef.current = true;
      if (isMystery) {
        handleMatchEnd(deriveMatchSummary(recorder.finish(state)));
      }
    }
  }, [state, tickMs, isMystery, handleMatchEnd]);

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
      // 先取出并清空排队的方向输入，再交给 setState 的更新函数使用，
      // 避免 setState 的更新函数被 React 延迟调用时读到已经被清空的值。
      const inputDirection = pendingDirectionRef.current ?? heldDirectionRef.current;
      pendingDirectionRef.current = null;
      setState((prev) => stepGame(prev, inputDirection, tickMs));
    },
    tickMs,
    countdownDone && state.phase === "playing" && !blockedByEvolution
  );

  const togglePause = () => {
    setState((prev) => ({
      ...prev,
      phase:
        prev.phase === "playing" ? "paused" : prev.phase === "paused" ? "playing" : prev.phase,
    }));
  };

  // "再来一局"：同对手、同速度直接重开一局，回到倒计时，不用跳回选角页。
  const restartGame = () => {
    pendingDirectionRef.current = null;
    heldDirectionRef.current = null;
    clearReadiness();
    setState(rerollFoodPosition(createInitialGameState(aiCharacterId)));
    setCountdownDone(false);
  };

  const holdDirection = (direction: Direction) => {
    // 与键盘相同：先排队，短按也能撑到下一个 tick，不会因为松手太快被丢掉
    pendingDirectionRef.current = direction;
    heldDirectionRef.current = direction;
  };
  const releaseDirection = () => {
    heldDirectionRef.current = null;
  };

  const pauseButton = countdownDone && (
    <button
      type="button"
      onClick={togglePause}
      aria-label="暂停"
      className="pixel-border pixel-press z-10 flex h-9 w-9 touch-manipulation items-center justify-center border-border bg-card font-pixel text-xs compact-play:min-h-11 compact-play:min-w-11"
    >
      ❚❚
    </button>
  );

  const dpad = compactPlay && (
    <VirtualDPad
      floating
      size="lg"
      onHold={holdDirection}
      onRelease={releaseDirection}
      className="pointer-events-none absolute right-1 bottom-1 z-20"
    />
  );

  return (
    <main
      className={
        compactPlay
          ? "flex h-dvh max-h-dvh flex-col items-center overflow-hidden px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
          : "flex min-h-dvh flex-col items-center overflow-hidden px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:gap-6 md:px-4 md:py-8"
      }
    >
      <div className="w-full max-w-4xl shrink-0">
        <ScoreBoard
          state={state}
          aiName={character.name}
          aiThemeColorVar={character.themeColorVar}
          compact={compactPlay}
        />
      </div>

      {compactPlay && landscape ? (
        <div className="relative flex min-h-0 w-full flex-1 flex-row pt-1">
          <div
            ref={boardAreaRef}
            className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden touch-none"
          >
            <Board state={state} cellSize={cellSize} />
          </div>
          <aside className="flex shrink-0 flex-col items-end justify-between gap-2 pl-2 pr-[11.5rem]">
            {pauseButton}
            <PortraitPanel
              character={character}
              speech={speech}
              emotion={emotion}
              compact
              avatarPx={COMPACT_AVATAR_PX}
              className="w-[11rem] items-center"
            />
          </aside>
          {dpad}
        </div>
      ) : compactPlay ? (
        <div className="relative flex min-h-0 w-full flex-1 flex-col pt-1">
          <div
            ref={boardAreaRef}
            className="flex min-h-0 w-full flex-1 flex-col items-center overflow-hidden"
          >
            <div
              className="flex max-w-full flex-col"
              style={{ width: state.gridSize * cellSize }}
            >
              <div className="relative shrink-0 touch-none">
                <Board state={state} cellSize={cellSize} />
              </div>
              <div className="flex shrink-0 justify-end py-1">{pauseButton}</div>
              <div className="flex items-center gap-2">
                <PortraitPanel
                  character={character}
                  speech={speech}
                  emotion={emotion}
                  compact
                  parts="avatar"
                  avatarPx={PORTRAIT_AVATAR_PX}
                />
                <PortraitPanel
                  character={character}
                  speech={speech}
                  emotion={emotion}
                  compact
                  parts="speech"
                  tailAlign="left"
                  className="min-w-0 flex-1"
                />
              </div>
            </div>
          </div>
          {dpad}
        </div>
      ) : (
        <div className="relative flex min-h-0 w-full max-w-4xl flex-1 flex-col items-center justify-center gap-8 md:flex-row md:items-start md:justify-center">
          {countdownDone && (
            <div className="absolute -top-1 right-0 md:top-0">{pauseButton}</div>
          )}
          <div
            ref={boardAreaRef}
            className="flex min-h-0 min-w-0 items-center justify-center touch-none"
          >
            <Board state={state} cellSize={cellSize} />
          </div>
          <PortraitPanel character={character} speech={speech} emotion={emotion} />
        </div>
      )}

      {!countdownDone && (
        <div className="fixed inset-0 z-30">
          <CountdownOverlay
            seconds={COUNTDOWN_SECONDS}
            onDone={() => setCountdownDone(true)}
          />
        </div>
      )}

      {state.phase === "paused" && (
        <Dialog open>
          <DialogContent className="max-w-xs" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle className="text-center">已暂停</DialogTitle>
            </DialogHeader>
            <DialogFooter className="flex-col gap-5 sm:flex-col">
              <Button className="w-full" onClick={togglePause}>
                继续
              </Button>
              <Button variant="outline" className="w-full" onClick={() => router.push("/select")}>
                返回对手选择
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {blockedByEvolution && (
        <Dialog open>
          <DialogContent className="max-w-xs" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle className="text-center">它正在进化</DialogTitle>
            </DialogHeader>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              它的策略正在被改写，这时候开打没有意义。等它想明白再来。
            </p>
            <DialogFooter className="flex-col gap-5 sm:flex-col">
              <Button className="w-full" onClick={() => router.push("/select")}>
                去看看它在想什么
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ResultModal
        state={state}
        character={character}
        onRematch={restartGame}
        onEvolve={() => router.push("/select")}
        endingLineOverride={persona?.lines?.ending}
        growthNotice={readiness}
        growthStage={growth?.growthStage}
      />
    </main>
  );
}

function PlayPageInner() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("ai");
  const aiCharacterId = isValidCharacterId(requested) ? requested : "laomou";

  const requestedSpeed = Number(searchParams.get("speed"));
  const tickMs = findSpeedPresetByTickMs(requestedSpeed)
    ? requestedSpeed
    : getSpeedTickMs(DEFAULT_GAME_SPEED_ID);

  return <PlayGame key={aiCharacterId} aiCharacterId={aiCharacterId} tickMs={tickMs} />;
}

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayPageInner />
    </Suspense>
  );
}
