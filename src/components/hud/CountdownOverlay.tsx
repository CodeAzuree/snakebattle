"use client";

import { useEffect, useState } from "react";

interface CountdownOverlayProps {
  seconds: number;
  onDone: () => void;
}

/**
 * 全屏像素风倒计时（3-2-1-GO），对应 docs/UI_DESIGN.md 4.2 节。
 */
export function CountdownOverlay({ seconds, onDone }: CountdownOverlayProps) {
  const [count, setCount] = useState(seconds);

  useEffect(() => {
    if (count <= 0) {
      const doneTimer = setTimeout(onDone, 300);
      return () => clearTimeout(doneTimer);
    }
    const timer = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85">
      <span
        key={count}
        className="animate-in zoom-in-50 fade-in font-pixel text-8xl text-neon-cyan duration-300"
      >
        {count > 0 ? count : "GO!"}
      </span>
    </div>
  );
}
