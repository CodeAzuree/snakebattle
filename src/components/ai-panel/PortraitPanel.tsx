import Image from "next/image";
import type { AICharacter } from "@/game/ai/roster";
import type { EmotionState } from "@/game/types";
import type { AISpeech } from "@/game/persona/useAIState";
import { getEmotionBadgeSrc, getReactionClassName } from "@/game/persona/portraitMotion";
import { SpeechBubble } from "./SpeechBubble";
import { cn } from "@/lib/utils";

export type PortraitParts = "all" | "speech" | "avatar";

interface PortraitPanelProps {
  character: AICharacter;
  speech: AISpeech | null;
  emotion: EmotionState;
  className?: string;
  compact?: boolean;
  dense?: boolean;
  /** 覆盖 compact 的固定头像边长，供竖屏按底栏槽位等比缩放 */
  avatarPx?: number;
  parts?: PortraitParts;
  /** 覆盖台词尖角方向 */
  tailAlign?: "start" | "center" | "left";
}

/**
 * 固定 AI 肖像面板：只展示 AI 一方，不给玩家配对称肖像，
 * 对应 docs/DESIGN.md 4.2 节的产品决策与 docs/UI_DESIGN.md 5.3 节。
 * 头像本身叠加"待机呼吸 + 台词触发的角色专属反应动作"，
 * 让静态立绘随台词切换"动起来"（对应 docs/UI_DESIGN.md 5.3 节的动态立绘设计）。
 */
export function PortraitPanel({
  character,
  speech,
  emotion,
  className,
  compact = false,
  dense = false,
  avatarPx: avatarPxProp,
  parts = "all",
  tailAlign: tailAlignProp,
}: PortraitPanelProps) {
  const reactionClassName = getReactionClassName(character.id, emotion);
  const badgeSrc = getEmotionBadgeSrc(character.id, emotion);
  const showSpeech = parts === "all" || parts === "speech";
  const showAvatar = parts === "all" || parts === "avatar";
  const avatarPx = avatarPxProp ?? (dense ? 40 : compact ? 72 : 150);
  const badgePx = Math.max(16, Math.round(avatarPx * 0.22));
  const tailAlign = tailAlignProp ?? (compact ? "center" : "start");

  return (
    <div
      className={cn(
        "flex flex-col",
        compact ? "w-auto gap-1.5" : "w-[180px] items-center gap-3",
        parts === "speech" && "w-full items-start",
        parts === "avatar" && compact && "shrink-0 items-center",
        className
      )}
      style={showAvatar && compact && !showSpeech ? { width: avatarPx } : undefined}
    >
      {showSpeech && (
        <div className={cn("w-full", compact ? "min-h-0" : "min-h-[4rem]")}>
          {speech && (
            <SpeechBubble
              key={speech.key}
              text={speech.text}
              themeColorVar={character.themeColorVar}
              tailAlign={tailAlign}
              className={
                compact
                  ? dense
                    ? "min-h-0 px-2 py-1.5 text-xs leading-snug line-clamp-2"
                    : parts === "speech"
                      ? "min-h-[5.5rem] px-3 py-2.5 text-base leading-relaxed line-clamp-3"
                      : "min-h-[3.5rem] px-3 py-2.5 text-base leading-relaxed line-clamp-3"
                  : undefined
              }
            />
          )}
        </div>
      )}

      {showAvatar && (
        <>
          {/*
            外层不裁切（relative 即可），只用来给情绪贴图定位；
            真正需要裁切头像的 overflow-hidden 放在内层的像素边框盒子上，
            避免贴图因为超出边框盒子范围而被 overflow-hidden 切掉一角。
          */}
          <div className="relative aspect-square shrink-0" style={{ width: avatarPx, height: avatarPx }}>
            <div
              className={cn(
                "pixel-border relative aspect-square h-full w-full shrink-0 overflow-hidden bg-card",
                !compact && "portrait-idle"
              )}
              style={{ borderColor: `var(${character.themeColorVar})` }}
            >
              <div key={speech?.key} className={cn("relative h-full w-full", reactionClassName)}>
                <Image
                  src={character.avatarSrc}
                  alt={character.name}
                  fill
                  priority
                  className="object-cover object-center"
                  sizes={`${avatarPx}px`}
                />
              </div>
            </div>

            {badgeSrc && (
              <div
                key={emotion}
                className="emotion-badge-pop pointer-events-none absolute bg-transparent"
                style={{
                  top: compact ? -6 : -8,
                  right: compact ? -6 : -8,
                  width: badgePx,
                  height: badgePx,
                }}
              >
                {/* 情绪贴图必须走原图：Next 图片优化曾把透明 PNG 压成不透明白底 */}
                <img src={badgeSrc} alt="" className="h-full w-full object-contain" />
              </div>
            )}
          </div>

          {!dense && (
          <div className="text-center">
            <p
              className={cn(
                "font-pixel",
                compact ? (avatarPx >= 140 ? "text-xs" : "text-[10px]") : "text-sm"
              )}
              style={{ color: `var(${character.themeColorVar})` }}
            >
              {character.name}
            </p>
          </div>
          )}
        </>
      )}
    </div>
  );
}
