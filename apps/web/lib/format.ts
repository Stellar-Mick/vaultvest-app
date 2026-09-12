/** Render a duration in seconds as its two most significant units, e.g. "3d 4h". */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const units: [string, number][] = [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ];
  const parts: string[] = [];
  let rest = Math.floor(seconds);
  for (const [label, size] of units) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${label}`);
      rest %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0s';
}
