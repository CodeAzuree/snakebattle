import { FEATURE_KEYS, type FeatureKey } from "./spec";
import type { FeatureMap } from "./features";

type AstNode =
  | { kind: "num"; value: number }
  | { kind: "feat"; key: FeatureKey }
  | { kind: "unary"; op: "-"; arg: AstNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: AstNode; right: AstNode }
  | { kind: "call"; name: "min" | "max" | "clamp" | "abs"; args: AstNode[] };

const FEATURE_SET = new Set<string>(FEATURE_KEYS);
const MAX_NODES = 40;

class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

type Token =
  | { type: "num"; value: number }
  | { type: "id"; value: string }
  | { type: "op"; value: string }
  | { type: "eof" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && /[0-9.]/.test(source[i])) i += 1;
      const value = Number(source.slice(start, i));
      if (!Number.isFinite(value)) throw new ParseError("非法数字");
      tokens.push({ type: "num", value });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
      tokens.push({ type: "id", value: source.slice(start, i) });
      continue;
    }
    if ("+-*/(),".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    throw new ParseError(`非法字符「${ch}」`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

function isOp(token: Token, value: string): token is { type: "op"; value: string } {
  return token.type === "op" && token.value === value;
}

class Parser {
  private index = 0;
  private nodes = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): AstNode {
    const node = this.expr();
    if (this.peek().type !== "eof") throw new ParseError("表达式末尾有多余内容");
    return node;
  }

  private bump(): AstNode {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) throw new ParseError("表达式过长");
    return undefined as unknown as AstNode;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private eat(): Token {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private expr(): AstNode {
    return this.termRest(this.term());
  }

  private termRest(left: AstNode): AstNode {
    const token = this.peek();
    if (token.type === "op" && (token.value === "+" || token.value === "-")) {
      this.eat();
      this.bump();
      const right = this.term();
      return this.termRest({ kind: "binary", op: token.value, left, right });
    }
    return left;
  }

  private term(): AstNode {
    return this.factorRest(this.factor());
  }

  private factorRest(left: AstNode): AstNode {
    const token = this.peek();
    if (token.type === "op" && (token.value === "*" || token.value === "/")) {
      this.eat();
      this.bump();
      const right = this.factor();
      return this.factorRest({ kind: "binary", op: token.value, left, right });
    }
    return left;
  }

  private factor(): AstNode {
    const token = this.peek();
    if (token.type === "op" && token.value === "-") {
      this.eat();
      this.bump();
      return { kind: "unary", op: "-", arg: this.factor() };
    }
    if (token.type === "op" && token.value === "(") {
      this.eat();
      const inner = this.expr();
      const close = this.eat();
      if (close.type !== "op" || close.value !== ")") throw new ParseError("缺少右括号");
      return inner;
    }
    if (token.type === "num") {
      this.eat();
      this.bump();
      return { kind: "num", value: token.value };
    }
    if (token.type === "id") {
      this.eat();
      if (isOp(this.peek(), "(")) {
        return this.call(token.value);
      }
      if (!FEATURE_SET.has(token.value)) {
        throw new ParseError(`未知特征「${token.value}」`);
      }
      this.bump();
      return { kind: "feat", key: token.value as FeatureKey };
    }
    throw new ParseError("表达式不完整");
  }

  private call(name: string): AstNode {
    if (name !== "min" && name !== "max" && name !== "clamp" && name !== "abs") {
      throw new ParseError(`未知函数「${name}」`);
    }
    this.eat(); // (
    const args: AstNode[] = [];
    if (!isOp(this.peek(), ")")) {
      args.push(this.expr());
      while (isOp(this.peek(), ",")) {
        this.eat();
        args.push(this.expr());
      }
    }
    const close = this.eat();
    if (close.type !== "op" || close.value !== ")") throw new ParseError("函数调用缺少右括号");
    const expected = name === "abs" ? 1 : name === "clamp" ? 3 : 2;
    if (name === "min" || name === "max") {
      if (args.length < 2) throw new ParseError(`${name} 至少需要 2 个参数`);
    } else if (args.length !== expected) {
      throw new ParseError(`${name} 需要 ${expected} 个参数`);
    }
    this.bump();
    return { kind: "call", name, args };
  }
}

function evalAst(node: AstNode, features: FeatureMap): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "feat":
      return features[node.key];
    case "unary":
      return -evalAst(node.arg, features);
    case "binary": {
      const left = evalAst(node.left, features);
      const right = evalAst(node.right, features);
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      return right === 0 ? 0 : left / right;
    }
    case "call": {
      const args = node.args.map((arg) => evalAst(arg, features));
      if (node.name === "abs") return Math.abs(args[0] ?? 0);
      if (node.name === "min") return Math.min(...args);
      if (node.name === "max") return Math.max(...args);
      const [value, lo, hi] = args;
      return Math.min(hi ?? 0, Math.max(lo ?? 0, value ?? 0));
    }
  }
}

const astCache = new Map<string, AstNode | null>();

/**
 * 把受限打分表达式编译成求值函数。
 *
 * 只允许特征名、数字、+ - * / ( ) 与 min/max/clamp/abs，节点数上限 40。
 * 不用 eval：导入他人存档时表达式只是数据，不会变成代码执行入口。
 * 非法表达式返回 null，调用方回落到权重求和。
 */
export function compileScoreExpression(
  source: string | null
): ((features: FeatureMap) => number) | null {
  if (!source) return null;
  let ast = astCache.get(source);
  if (ast === undefined) {
    try {
      ast = new Parser(tokenize(source)).parse();
    } catch {
      ast = null;
    }
    astCache.set(source, ast);
    if (astCache.size > 64) {
      const first = astCache.keys().next().value;
      if (first !== undefined) astCache.delete(first);
    }
  }
  if (!ast) return null;
  const compiled = ast;
  return (features) => {
    const value = evalAst(compiled, features);
    return Number.isFinite(value) ? value : 0;
  };
}

/** sanitize 时用来判断表达式能不能留下：编不过就整段丢弃 */
export function isValidScoreExpression(source: string | null): boolean {
  return compileScoreExpression(source) !== null;
}
