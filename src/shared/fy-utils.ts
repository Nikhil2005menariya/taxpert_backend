export function getFYFromDate(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed; March = 2
  if (month < 3) return `${year - 1}-${String(year).slice(-2)}`;
  return `${year}-${String(year + 1).slice(-2)}`;
}

export function currentFY(): string {
  return getFYFromDate(new Date().toISOString());
}
