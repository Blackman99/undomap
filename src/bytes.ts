/** 1536 -> "1.5 KB" (base 1024, one decimal under 10, SI-looking labels people read at a glance). */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(v)} B`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/** "10MB", "1.5 GB", "0", "512k" -> bytes. Throws on garbage. */
export function parseBytes(s: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgtp]?)(i?b)?\s*$/i.exec(s);
  if (!m) throw new Error(`not a size: "${s}" (try 0, 512KB, 10MB, 2GB)`);
  const pow = " kmgtp".indexOf((m[2] || " ").toLowerCase());
  return Math.round(Number(m[1]) * 1024 ** pow);
}

export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
