const cache = new Map<string, { data: any; expiry: number }>();

export async function getCached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expiry > Date.now()) {
    return entry.data;
  }
  const data = await fetcher();
  cache.set(key, { data, expiry: Date.now() + ttlMs });
  return data;
}

export function clearCache(key: string) {
  cache.delete(key);
}

export function clearAllCache() {
  cache.clear();
}
