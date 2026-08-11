"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SPEECH_BUBBLE_DURATION_MS } from "@/lib/constants";

interface SpeechBubbleProps {
  text: string;
  themeColorVar: string;
  className?: string;
}

/**
 * 台词气泡：opacity + translateY 的浮现/淡出动效，
 * 对应 docs/UI_DESIGN.md 1.4 / 5.3 节。
 * 注意：父组件需在每次台词切换时传入变化的 key（如 speech.key），
 * 使本组件随台词内容一起重新挂载，从而自然复位"浮现"动效。
 */
export function SpeechBubble({ text, themeColorVar, className }: SpeechBubbleProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), SPEECH_BUBBLE_DURATION_MS - 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={cn(
        "relative min-h-[3.5rem] border-2 bg-card px-3 py-2 text-xs leading-relaxed transition-all duration-300 ease-out",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1.5 opacity-0",
        className
      )}
      style={{ borderColor: `var(${themeColorVar})` }}
    >
      {text}
      <span
        className="absolute -bottom-[9px] left-6 h-3 w-3 rotate-45 border-r-2 border-b-2 bg-card"
        style={{ borderColor: `var(${themeColorVar})` }}
        aria-hidden="true"
      />
    </div>
  );
}
