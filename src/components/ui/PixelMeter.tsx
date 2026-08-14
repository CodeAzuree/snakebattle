import { cn } from "@/lib/utils";

interface PixelMeterProps {
  /** 0-100 */
  value: number;
  /** 任意合法 CSS 颜色；走内联样式，避免动态 Tailwind class 被摇掉 */
  color: string;
  segments?: number;
  className?: string;
}

/**
 * 像素分段进度条。
 *
 * 刻意不用 8bit 的 Progress：那个组件要求把填充色作为 Tailwind class 传进去，
 * 而这里的颜色是每个角色的主题色变量，编译期无法枚举，只会得到一条空槽。
 */
export function PixelMeter({ value, color, segments = 16, className }: PixelMeterProps) {
  const ratio = Math.min(100, Math.max(0, value)) / 100;
  const filled = Math.round(ratio * segments);

  return (
    <div
      className={cn(
        "flex h-3.5 w-full items-stretch gap-[2px] border-2 border-border bg-background/80 p-[2px]",
        className
      )}
      role="presentation"
    >
      {Array.from({ length: segments }, (_, index) => (
        <span
          key={index}
          className="flex-1 transition-colors"
          style={
            index < filled
              ? { backgroundColor: color, boxShadow: `0 0 6px ${color}` }
              : { backgroundColor: "color-mix(in srgb, var(--border) 55%, transparent)" }
          }
        />
      ))}
    </div>
  );
}
