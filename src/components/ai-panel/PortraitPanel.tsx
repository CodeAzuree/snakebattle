import Image from "next/image";
import type { AICharacter } from "@/game/ai/roster";
import type { AISpeech } from "@/game/persona/useAIState";
import { SpeechBubble } from "./SpeechBubble";
import { cn } from "@/lib/utils";

interface PortraitPanelProps {
  character: AICharacter;
  speech: AISpeech | null;
  className?: string;
}

/**
 * 固定 AI 肖像面板：只展示 AI 一方，不给玩家配对称肖像，
 * 对应 docs/DESIGN.md 4.2 节的产品决策与 docs/UI_DESIGN.md 5.3 节。
 */
export function PortraitPanel({ character, speech, className }: PortraitPanelProps) {
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

      <div
        className="pixel-border relative h-[150px] w-[150px] overflow-hidden bg-card"
        style={{ borderColor: `var(${character.themeColorVar})` }}
      >
        <Image src={character.avatarSrc} alt={character.name} fill className="object-cover" sizes="150px" />
      </div>

      <div className="text-center">
        <p className="font-pixel text-sm" style={{ color: `var(${character.themeColorVar})` }}>
          {character.name}
        </p>
        <p className="mt-1 font-pixel text-[9px] text-muted-foreground">{character.title}</p>
      </div>
    </div>
  );
}
