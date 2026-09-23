/** Bounded retention by both item count and caller-supplied serialized-data weight. */
export class WeightedLru<K, V> {
  private readonly entries = new Map<K, { value: V; weight: number }>();
  private retainedWeight = 0;
  constructor(private readonly maxEntries: number, private readonly maxWeight: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxWeight) || maxWeight <= 0) throw Error("Invalid cache limits");
  }
  get size() { return this.entries.size; }
  get weight() { return this.retainedWeight; }
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  delete(key: K) {
    const entry = this.entries.get(key);
    if (entry) { this.retainedWeight -= entry.weight; this.entries.delete(key); }
  }
  set(key: K, value: V, weight: number): boolean {
    this.delete(key);
    // Unknown/oversized entries remain usable by the caller, just not cached.
    if (!Number.isFinite(weight) || weight < 0 || weight > this.maxWeight) return false;
    while (this.entries.size >= this.maxEntries || this.retainedWeight + weight > this.maxWeight) this.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, weight }); this.retainedWeight += weight;
    return true;
  }
  clear() { this.entries.clear(); this.retainedWeight = 0; }
}
