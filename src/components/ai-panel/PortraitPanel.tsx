import Image from "next/image";
import type { AICharacter } from "@/game/ai/roster";
import type { EmotionState } from "@/game/types";
import type { AISpeech } from "@/game/persona/useAIState";
import { getEmotionBadgeSrc, getReactionClassName } from "@/game/persona/portraitMotion";
import { SpeechBubble } from "./SpeechBubble";
import { cn } from "@/lib/utils";

interface PortraitPanelProps {
  character: AICharacter;
  speech: AISpeech | null;
  emotion: EmotionState;
  className?: string;
}

/**
 * 固定 AI 肖像面板：只展示 AI 一方，不给玩家配对称肖像，
 * 对应 docs/DESIGN.md 4.2 节的产品决策与 docs/UI_DESIGN.md 5.3 节。
 * 头像本身叠加"待机呼吸 + 台词触发的角色专属反应动作"，
 * 让静态立绘随台词切换"动起来"（对应 docs/UI_DESIGN.md 5.3 节的动态立绘设计）。
 */
export function PortraitPanel({ character, speech, emotion, className }: PortraitPanelProps) {
  const reactionClassName = getReactionClassName(character.id, emotion);
  const badgeSrc = getEmotionBadgeSrc(character.id, emotion);

  return (
    <div className={cn("flex w-[180px] flex-col items-center gap-3", className)}>
      <div className="min-h-[4rem] w-full">
        {speech && (
          <SpeechBubble
            key={speech.key}
            text={speech.text}
            themeColorVar={character.themeColorVar}
          />
        )}
      </div>

      {/*
        外层不裁切（relative 即可），只用来给情绪贴图定位；
        真正需要裁切头像的 overflow-hidden 放在内层的像素边框盒子上，
        避免贴图因为超出边框盒子范围而被 overflow-hidden 切掉一角。
      */}
      <div className="relative h-[150px] w-[150px]">
        <div
          className="pixel-border portrait-idle relative h-full w-full overflow-hidden bg-card"
          style={{ borderColor: `var(${character.themeColorVar})` }}
        >
          {/*
            待机呼吸动效套在边框盒子（外层），台词触发的反应动效套在内层，
            两者作用于不同元素的 transform，天然叠加而不会相互覆盖。
          */}
          <div key={speech?.key} className={cn("relative h-full w-full", reactionClassName)}>
            <Image
              src={character.avatarSrc}
              alt={character.name}
              fill
              priority
              className="object-cover"
              sizes="150px"
            />
          </div>
        </div>

        {badgeSrc && (
          <div
            key={emotion}
            className="emotion-badge-pop absolute -top-2 -right-2 h-9 w-9 drop-shadow-[0_0_6px_rgba(0,0,0,0.6)]"
          >
            <Image src={badgeSrc} alt="" fill className="object-contain" sizes="36px" />
          </div>
        )}
      </div>

      <div className="text-center">
        <p className="font-pixel text-sm" style={{ color: `var(${character.themeColorVar})` }}>
          {character.name}
        </p>
      </div>
    </div>
  );
}
