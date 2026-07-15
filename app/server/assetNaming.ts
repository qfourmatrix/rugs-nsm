let suffixCounter = 0;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function localTimestampParts(date: Date): { date: string; time: string; millis: string } {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`,
    time: `${pad(date.getHours(), 2)}${pad(date.getMinutes(), 2)}${pad(date.getSeconds(), 2)}`,
    millis: pad(date.getMilliseconds(), 3)
  };
}

export function buildAssetId(shotId: string, date = new Date()): string {
  suffixCounter = (suffixCounter + 1) % 2176782336;
  const suffix = suffixCounter.toString(36).padStart(6, "0");
  const parts = localTimestampParts(date);
  return `${shotId}_${parts.date}_${parts.time}_${parts.millis}_${suffix}`;
}
