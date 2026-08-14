"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PixelButton } from "@/components/ui/PixelButton";
import { PixelMeter } from "@/components/ui/PixelMeter";
import { PixelChip, PixelPanel } from "@/components/ui/PixelPanel";
import {
  resetEvolutionRun,
  startEvolution,
  useEvolutionRun,
  type EvolutionNote,
  type SkillProgress,
} from "@/game/growth/evolutionStore";
import { SKILL_REGISTRY, type EvolutionResult, type SkillId } from "@/game/growth/skills/types";
import {
  createNoviceGrowthState,
  evolutionReadiness,
  exportGrowthState,
  importGrowthState,
  type GrowthState,
} from "@/lib/growthStorage";
import { cn } from "@/lib/utils";

interface EvolutionPanelProps {
  growth: GrowthState;
  onChange: (next: GrowthState) => void;
  themeColorVar: string;
}

const STATUS_MARK: Record<SkillProgress["status"], string> = {
  pending: "□",
  running: "▶",
  done: "■",
  skipped: "×",
};

const SHORT_HINT: Record<SkillProgress["status"], string> = {
  pending: "等待",
  running: "进行中",
  done: "完成",
  skipped: "已跳过",
};

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** 取实时原文的最后一行，让折叠状态下也能看出它正在吐什么 */
function liveTail(live: string): string | null {
  const lines = live.split("\n").filter((line) => line.trim().length > 0);
  return lines.length > 0 ? truncate(lines[lines.length - 1], 18) : null;
}

function skillHint(
  progress: SkillProgress,
  notes: EvolutionNote[],
  attempt: { attempt: number; max: number } | null,
  progressLabel: string | null,
  live: string
): string {
  if (progress.status === "running") {
    if (progressLabel) return progressLabel;
    const tail = liveTail(live);
    if (tail) return tail;
    if (progress.id === "diagnose" && attempt && attempt.attempt > 1) {
      return `第 ${attempt.attempt}/${attempt.max} 次诊断`;
    }
    if (progress.id === "evolve" && attempt) return `第 ${attempt.attempt}/${attempt.max} 次提案`;
    return progress.detail || "进行中";
  }
  if (progress.status === "skipped") return progress.detail || "已跳过";
  if (progress.status === "done") {
    const last = [...notes].reverse().find((note) => note.skill === progress.id);
    return last ? truncate(last.text, 18) : "完成";
  }
  return SHORT_HINT[progress.status];
}

/** growthStage 本身常常已经是「第 N 代 · 初醒」，避免再拼一次代数。 */
function stageLabel(growth: GrowthState): string {
  return /^第\s*\d+\s*代/.test(growth.growthStage)
    ? growth.growthStage
    : `第 ${growth.generation} 代 · ${growth.growthStage}`;
}

/**
 * 判断一条结论是不是已经在模型原文里出现过。
 *
 * notes 里既有从模型输出里提炼的结论（原文已经有了），也有系统侧的旁白
 * （护栏收敛了哪些字段、回测结果）。全都追加就会重复，全都不追加又会丢信息。
 */
function alreadyInTranscript(note: string, transcript: string): boolean {
  const body = note.replace(/^[\s·]*(\[[^\]]*\]\s*)?/, "").trim();
  if (!body) return true;
  if (transcript.includes(body)) return true;
  const colon = body.indexOf("：");
  return colon > 0 && transcript.includes(body.slice(colon + 1).trim());
}

/**
 * 步骤详情：模型原文（服务端逐 token 推过来的真流式）+ 原文里没有的结论。
 *
 * 原文在步骤结束后不清空。之前收尾时会切回一段更短的摘要，
 * 观感就是刚看着长出来的内容忽然缩水了。
 */
function StepLog({
  live,
  lines,
  running,
  accent,
}: {
  live: string;
  lines: string[];
  running: boolean;
  accent: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const transcript = live.trim();
  const extra = lines.filter((line) => !alreadyInTranscript(line, transcript));
  const text = [transcript, ...extra].filter(Boolean).join("\n");

  useEffect(() => {
    const node = boxRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [text]);

  return (
    <div
      ref={boxRef}
      className="mt-2 ml-6 max-h-44 overflow-y-auto border-l-2 bg-background/60 px-3 py-2"
      style={{ borderColor: accent }}
    >
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
        {text || (running ? "正在等它开口…" : "这一步还没有留下记录。")}
        {running ? (
          <span className="ml-0.5 inline-block animate-pulse" style={{ color: accent }}>
            █
          </span>
        ) : null}
      </p>
    </div>
  );
}

function resultLabel(result: EvolutionResult): string {
  if (result.status === "rejected") return "提案被否决";
  if (result.status === "failed") return "进化未完成";
  return result.strategyChanged ? "进化生效" : "策略未改动";
}

/**
 * 结果区：一句它自己的话，技术细节收进折叠。
 *
 * 适应度、提案次数、规格 diff 这些是给调参看的，摊在最外层会把「一个东西在成长」
 * 讲成一份回归报告。留在详情里，想看的人点开就有。
 */
function ResultReport({ result, accent }: { result: EvolutionResult; accent: string }) {
  const [open, setOpen] = useState(false);
  const highlight = result.status === "accepted" && result.strategyChanged;

  return (
    <div className="space-y-2.5 border-t-2 border-border pt-3">
      <PixelChip accent={highlight ? accent : "var(--muted-foreground)"}>
        {resultLabel(result)}
      </PixelChip>
      <p
        className="border-l-2 py-1 pl-3 text-[15px] leading-relaxed"
        style={{ borderColor: accent }}
      >
        {result.selfReport}
      </p>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="font-pixel text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? "收起详情" : "详情"}
      </button>
      {open && (
        <div className="space-y-1 bg-background/60 px-3 py-2 text-[13px] text-muted-foreground">
          <p className="font-pixel text-[11px]">
            {result.strategyChanged
              ? `适应度 ${result.baselineFitness ?? "—"} → ${result.candidateFitness ?? "—"}`
              : `适应度 ${result.baselineFitness ?? "—"}（未变）`}{" "}
            · 提案 {result.attempts} 次
          </p>
          <p className="leading-relaxed">{result.headline}</p>
          {result.changes.map((change) => (
            <p key={change}>· {change}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 「？？？」的进化面板：默认只展示简短状态，点开才看思考原文。
 */
export function EvolutionPanel({ growth, onChange, themeColorVar }: EvolutionPanelProps) {
  const run = useEvolutionRun();
  const readiness = evolutionReadiness(growth);
  const running = run.phase === "running";
  const accent = `var(${themeColorVar})`;

  const [openSkill, setOpenSkill] = useState<SkillId | null>(null);
  const userPicked = useRef(false);

  useEffect(() => {
    if (run.phase === "idle") {
      setOpenSkill(null);
      userPicked.current = false;
      return;
    }
    if (userPicked.current) return;
    const current = run.skills.find((skill) => skill.status === "running");
    if (current) setOpenSkill(current.id);
  }, [run.phase, run.skills]);

  const notesBySkill = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const note of run.notes) {
      (map[note.skill] ??= []).push(note.text);
    }
    return map;
  }, [run.notes]);

  const toggleSkill = (id: SkillId) => {
    userPicked.current = true;
    setOpenSkill((prev) => (prev === id ? null : id));
  };

  const showPipeline = running || Boolean(run.result) || Boolean(run.error);
  const idle = !showPipeline;

  return (
    <PixelPanel
      title="进化实验室"
      accent={accent}
      meta={<PixelChip accent={accent}>{stageLabel(growth)}</PixelChip>}
      footer={
        <>
          {run.phase === "finished" ? (
            <PixelButton tone="solid" accent={accent} onClick={resetEvolutionRun}>
              {run.error ? "关闭" : "它准备好了"}
            </PixelButton>
          ) : (
            <>
              <PixelButton
                tone="solid"
                accent={accent}
                disabled={!readiness.ready || running}
                title={
                  running
                    ? "进化进行中"
                    : readiness.ready
                      ? undefined
                      : "还没攒够败绩或平局，暂时不能进化"
                }
                onClick={() => {
                  userPicked.current = false;
                  void startEvolution();
                }}
              >
                {running ? "进化中…" : "开始进化"}
              </PixelButton>
              {idle && !readiness.ready && (
                <span className="text-xs text-muted-foreground">
                  再输掉或打平 {readiness.required - readiness.pending} 局就能复盘
                </span>
              )}
            </>
          )}
          {!running && <ArchiveDock growth={growth} onChange={onChange} accent={accent} />}
        </>
      }
    >
        {idle && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-pixel text-[11px] text-muted-foreground">复盘素材</span>
              <span className="font-pixel text-[11px]" style={{ color: accent }}>
                {Math.min(readiness.pending, readiness.required)}/{readiness.required}
              </span>
            </div>
            <PixelMeter
              value={(readiness.pending / Math.max(1, readiness.required)) * 100}
              color={accent}
              segments={10}
            />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {readiness.ready
                ? "它已经攒够了败绩与平局，想复盘一次。进化完成前不能再挑战它。"
                : `已积累 ${readiness.pending}/${readiness.required} 场败绩或平局（累计 ${readiness.pendingSeconds} 秒）。它赢了的对局不计入，可以继续挑战。`}
            </p>
          </div>
        )}

        {running && run.attempt && run.attempt.attempt > 1 && (
          <p
            className="border-l-2 py-1 pl-2.5 text-[13px] leading-relaxed text-muted-foreground"
            style={{ borderColor: "var(--neon-magenta)" }}
          >
            回测否决了上一版，流程已退回「诊断」重新看病（第 {run.attempt.attempt}/{run.attempt.max} 次）。
          </p>
        )}

        {showPipeline && (
          <ol className="space-y-1">
            {SKILL_REGISTRY.map((skill, index) => {
              const progress = run.skills[index];
              const isRunning = progress.status === "running";
              const isOpen = openSkill === skill.id;
              const isIdleStep = progress.status === "pending" || progress.status === "skipped";
              const hint = skillHint(
                progress,
                run.notes,
                run.attempt,
                isRunning ? (run.progress?.label ?? null) : null,
                run.thinking[skill.id] ?? ""
              );
              const lines = notesBySkill[skill.id] ?? [];
              const canOpen = lines.length > 0 || isRunning || progress.status === "skipped";

              return (
                <li key={skill.id}>
                  <button
                    type="button"
                    disabled={!canOpen}
                    onClick={() => toggleSkill(skill.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-2 py-1.5 text-left transition-colors",
                      canOpen ? "hover:bg-foreground/5" : "cursor-default",
                      isIdleStep && "opacity-55"
                    )}
                    style={isRunning ? { backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)` } : undefined}
                  >
                    <span
                      className={cn("font-pixel text-xs", isRunning && "animate-pulse")}
                      style={{ color: isIdleStep ? "var(--muted-foreground)" : accent }}
                    >
                      {STATUS_MARK[progress.status]}
                    </span>
                    <span
                      className="w-16 shrink-0 font-pixel text-xs"
                      style={{ color: isIdleStep ? "var(--muted-foreground)" : accent }}
                    >
                      {skill.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                      {hint}
                    </span>
                    {canOpen && (
                      <span className="shrink-0 font-pixel text-[10px] text-muted-foreground">
                        {isOpen ? "收起" : "详情"}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <StepLog
                      live={run.thinking[skill.id] ?? ""}
                      lines={lines}
                      running={isRunning}
                      accent={accent}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {run.progress && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                {run.progress.label}
              </span>
              <span className="shrink-0 font-pixel text-[11px]" style={{ color: accent }}>
                {run.progress.done}/{run.progress.total}
              </span>
            </div>
            <PixelMeter
              value={(run.progress.done / Math.max(1, run.progress.total)) * 100}
              color={accent}
              segments={20}
            />
          </div>
        )}

        {run.result && <ResultReport result={run.result} accent={accent} />}

        {run.error && (
          <p className="border-t-2 border-border pt-3 text-sm leading-relaxed text-destructive">
            {run.error}
          </p>
        )}
      </PixelPanel>
  );
}

/**
 * 收在实验室页脚右侧的存档入口。
 *
 * 三个纯文字链容易被当成装饰；做成和速度档位同构的分段开关。
 * 「存档」放在框外当标签，框里只有导出/导入/重置三格能点。
 */
function ArchiveDock({
  growth,
  onChange,
  accent,
}: {
  growth: GrowthState;
  onChange: (next: GrowthState) => void;
  accent: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleExport = () => {
    const blob = new Blob([exportGrowthState(growth)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cybersnake-growth-gen${growth.generation}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("已导出");
  };

  const handleImportFile = async (file: File) => {
    const imported = importGrowthState(await file.text());
    if (!imported) {
      setMessage("导入失败");
      return;
    }
    onChange(imported);
    setMessage(`已导入第 ${imported.generation} 代`);
  };

  return (
    <div className="ml-auto flex items-center gap-2.5">
      {message && (
        <span className="font-pixel text-[10px]" style={{ color: accent }}>
          {message}
        </span>
      )}
      <span className="font-pixel text-[10px] text-muted-foreground">存档</span>
      <div className="pixel-border flex border-border bg-card">
        <button
          type="button"
          onClick={handleExport}
          className="px-3 py-2 font-pixel text-[10px] leading-none text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          导出
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="border-l-2 border-border px-3 py-2 font-pixel text-[10px] leading-none text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          导入
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(createNoviceGrowthState());
            setMessage("已重置");
          }}
          className="border-l-2 border-border px-3 py-2 font-pixel text-[10px] leading-none text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
        >
          重置
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImportFile(file);
        }}
      />
    </div>
  );
}
