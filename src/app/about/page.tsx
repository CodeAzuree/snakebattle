import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export const metadata = {
  title: "AI 设计说明 · CyberSnake",
};

function readDoc(filename: string): string {
  const filePath = path.join(process.cwd(), "docs", filename);
  return fs.readFileSync(filePath, "utf-8");
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="first:mt-0 mt-8 mb-4 font-pixel text-lg text-neon-cyan sm:text-xl">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 mb-3 border-b border-border pb-2 font-pixel text-sm text-neon-cyan sm:text-base">
      {children}
    </h2>
  ),
  h3: ({ children }) => <h3 className="mt-6 mb-2 font-pixel text-xs text-foreground">{children}</h3>,
  p: ({ children }) => <p className="mb-4 text-sm leading-relaxed text-foreground/85">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-4 ml-5 list-disc space-y-1 text-sm text-foreground/85">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 ml-5 list-decimal space-y-1 text-sm text-foreground/85">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a href={href} className="text-neon-cyan underline underline-offset-4">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="text-foreground">{children}</strong>,
  code: ({ children, className }) => {
    if (className?.includes("language-")) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="border border-border bg-card px-1 py-0.5 text-xs text-neon-lime">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto border-2 border-border bg-card p-3 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto border border-border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="text-left">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border bg-card px-2 py-1 font-pixel text-[10px] text-neon-cyan">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
  hr: () => <hr className="my-8 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="border-neon-cyan mb-4 border-l-2 pl-3 text-sm text-muted-foreground">
      {children}
    </blockquote>
  ),
};

export default function AboutPage() {
  const designDoc = readDoc("DESIGN.md");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-xs text-muted-foreground underline underline-offset-4">
          ← 返回首页
        </Link>
        <h1 className="font-pixel text-xl text-neon-cyan">AI 产品设计说明</h1>
        <p className="text-xs text-muted-foreground">
          完整设计文档见仓库 <code>docs/DESIGN.md</code> 与{" "}
          <code>docs/UI_DESIGN.md</code>
        </p>
      </div>

      <article>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {designDoc}
        </ReactMarkdown>
      </article>

      <div className="pt-4">
        <Link
          href="/select"
          className="font-pixel text-xs text-neon-cyan underline underline-offset-4"
        >
          去试玩 →
        </Link>
      </div>
    </main>
  );
}
