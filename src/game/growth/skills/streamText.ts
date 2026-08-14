/**
 * 从流式 JSON 里增量抽出「人话」。
 *
 * 模型的输出是一整份 JSON，直接把 token 原样吐给玩家会是满屏的花括号和字段名。
 * 这里做一次极简扫描：只保留字符串**值**，丢掉键名、数字、布尔与所有结构符号，
 * 于是玩家看到的是「开局就撞墙 / 3 局里 2 局在 5 秒内死亡 / ……」这样一行行的思考。
 *
 * 不做完整 JSON 解析：真正的解析仍由调用方在拿到完整内容后做，
 * 这里只负责好看，扫歪了最多是少显示一行字，不影响结果正确性。
 */
export function createJsonTextExtractor(): (chunk: string) => string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let isKey = false;
  let unicodeLeft = 0;
  let lastSignificant = "";

  return function push(chunk: string): string {
    let out = "";
    for (const ch of chunk) {
      if (inString) {
        if (unicodeLeft > 0) {
          unicodeLeft -= 1;
          continue;
        }
        if (escaped) {
          escaped = false;
          if (ch === "u") unicodeLeft = 4;
          else if (!isKey) out += ch === "n" ? "\n" : ch === "t" ? " " : ch;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          if (!isKey) out += "\n";
          lastSignificant = '"';
          continue;
        }
        if (!isKey) out += ch;
        continue;
      }

      if (ch === '"') {
        inString = true;
        // JSON 里只有对象的第一个位置（紧跟 { 或 ,）才是键名，数组里的字符串一律是值
        isKey =
          stack[stack.length - 1] === "{" && (lastSignificant === "{" || lastSignificant === ",");
        continue;
      }
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
      if (!/\s/.test(ch)) lastSignificant = ch;
    }
    return out;
  };
}
