import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PixelPanelProps {
  title: string;
  accent: string;
  meta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * 选角页右侧那一列面板的统一外壳：硬边框 + 标题条 + 内容区 + 操作区。
 * 标题条用一小段竖色块做强调，比整块描边更克制，也让多张面板看起来是一套的。
 */
export function PixelPanel({ title, accent, meta, footer, children, className }: PixelPanelProps) {
  return (
    <section
      className={cn("pixel-border w-full bg-card", className)}
      style={{ borderColor: "color-mix(in srgb, " + accent + " 45%, var(--border))" }}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-2 border-b-2 px-4 py-3"
        style={{
          borderColor: "color-mix(in srgb, " + accent + " 30%, var(--border))",
          backgroundColor: "color-mix(in srgb, " + accent + " 8%, transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="block h-4 w-1.5" style={{ backgroundColor: accent }} />
          <h3 className="font-pixel text-sm tracking-wide">{title}</h3>
        </div>
        {meta}
      </header>

      <div className="space-y-3.5 px-4 py-4">{children}</div>

      {footer && (
        <div
          className="flex w-full flex-wrap items-center gap-3 border-t-2 px-4 py-3"
          style={{ borderColor: "color-mix(in srgb, " + accent + " 20%, var(--border))" }}
        >
          {footer}
        </div>
      )}
    </section>
  );
}

/** 面板右上角的小信息条，例如「第 3 代 · 初醒」 */
export function PixelChip({
  children,
  accent,
  pulse,
  className,
}: {
  children: ReactNode;
  accent: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-1 font-pixel text-[11px] leading-none",
        pulse && "animate-pulse",
        className
      )}
      style={{
        borderColor: accent,
        color: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
