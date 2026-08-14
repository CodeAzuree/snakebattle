/**
 * mulberry32：小巧的可播种伪随机数发生器。
 * 沙盒回测需要"同一份基因跑两次结果完全一致"，才能把候选基因与当前最佳基因
 * 放在同样的运气条件下比较，因此不能直接用 Math.random()。
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
