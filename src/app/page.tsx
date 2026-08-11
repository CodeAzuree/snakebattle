import Link from "next/link";
import { Button } from "@/components/ui/8bit/button";

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,255,242,0.04) 0px, rgba(0,255,242,0.04) 1px, transparent 1px, transparent 3px)",
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <h1 className="font-pixel text-4xl text-neon-cyan drop-shadow-[0_0_12px_rgba(0,255,242,0.6)] sm:text-6xl">
            CYBERSNAKE
          </h1>
          <p className="font-pixel text-sm text-muted-foreground">电子蛇战争</p>
        </div>

        <p className="max-w-md text-sm text-foreground/80 sm:text-base">
          在限时竞速中，与会思考的 AI 蛇一决高下。
        </p>

        <Link href="/select">
          <Button size="lg" className="font-pixel text-sm">
            开始对战
          </Button>
        </Link>

        <Link
          href="/about"
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          查看 AI 设计文档
        </Link>
      </div>
    </main>
  );
}
