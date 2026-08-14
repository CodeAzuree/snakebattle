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

      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="font-pixel text-4xl text-neon-cyan drop-shadow-[0_0_12px_rgba(0,255,242,0.6)] sm:text-6xl">
            CYBERSNAKE
          </h1>
          <div className="flex items-center gap-3 font-pixel text-[10px] text-neon-magenta drop-shadow-[0_0_8px_rgba(255,43,214,0.5)] sm:text-xs">
            <span aria-hidden="true">◂◂</span>
            <span className="tracking-[0.4em]">电子蛇战争</span>
            <span aria-hidden="true">▸▸</span>
          </div>
        </div>

        <Link href="/select">
          <Button size="lg" className="font-pixel text-sm">
            开始对战
          </Button>
        </Link>
      </div>
    </main>
  );
}
