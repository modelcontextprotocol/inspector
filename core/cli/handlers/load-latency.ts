/**
 * Bounded-memory latency recording for `--load` (#2838, items 4 and 6).
 *
 * The engine used to keep every latency in an array, and copy that array to
 * sort it, so memory grew with every call and a multi-hour run grew without
 * bound. A {@link LatencyRecorder} keeps samples exactly up to
 * {@link EXACT_LATENCY_SAMPLES}, so a short run's percentiles are exact as
 * they always were. Past that it folds them into a log-bucketed histogram,
 * whose size is set by the range of latencies seen rather than by how many
 * there were. Neighbouring bucket edges differ by {@link LATENCY_BUCKET_GROWTH},
 * so a percentile read from the histogram is within that relative error of
 * the true nearest-rank value. `min`, `max` and `mean` stay exact either way.
 */

/** Samples kept exactly before the recorder switches to its histogram. */
export const EXACT_LATENCY_SAMPLES = 10_000;
/** Ratio between neighbouring bucket edges: 1% relative accuracy. */
export const LATENCY_BUCKET_GROWTH = 1.01;
/** Latencies at or below this many milliseconds share bucket 0 (1 µs). */
const FLOOR_MS = 0.001;
const LOG_GROWTH = Math.log(LATENCY_BUCKET_GROWTH);

/** Latency distribution in milliseconds, nearest-rank percentiles. */
export type LoadLatency = {
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  /** The 99.9th percentile (#2838). */
  p999: number;
  max: number;
};

/** The percentiles {@link LoadLatency} reports, by key. */
const PERCENTILES = [
  ["p50", 50],
  ["p90", 90],
  ["p95", 95],
  ["p99", 99],
  ["p999", 99.9],
] as const;

/** Nearest-rank percentile over an ascending-sorted, non-empty array. */
export function percentile(sorted: number[], p: number): number {
  return sorted[nearestRank(sorted.length, p) - 1]!;
}

/** The 1-based nearest rank of percentile `p` among `n` values. */
function nearestRank(n: number, p: number): number {
  // ceil(p% of n) in exact integer arithmetic. Floating point would put
  // 99.9% of 1000 at 999.0000000000001, rank 1000; and no fixed epsilon is
  // right at every count. With `p` in thousandths of a percent, `a` stays an
  // exact integer for any count a run can reach (below 2^53 / 100000).
  const a = Math.round(p * 1000) * n;
  const b = 100_000;
  const q = Math.floor(a / b);
  const rank = a - q * b > 0 ? q + 1 : q;
  return Math.min(Math.max(rank, 1), n);
}

/**
 * Two decimal places from a millisecond up, and four significant figures
 * below it. Any fixed number of places loses the histogram's 1% at some
 * sub-millisecond magnitude: two places put a true 0.1048 at 0.10 (5% low),
 * four put 0.00204 at 0.002 (2% low), and either lets a percentile gate pass
 * a run above its limit. Four significant figures is within 0.05% anywhere.
 */
function round(n: number): number {
  const magnitude = Math.abs(n);
  const places =
    magnitude >= 1 || magnitude === 0
      ? 2
      : 3 - Math.floor(Math.log10(magnitude));
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
}

function bucketOf(ms: number): number {
  return ms <= FLOOR_MS
    ? 0
    : Math.floor(Math.log(ms / FLOOR_MS) / LOG_GROWTH) + 1;
}

/** The value a bucket stands for: the geometric midpoint of its edges. */
function bucketValue(bucket: number): number {
  if (bucket === 0) return FLOOR_MS;
  return FLOOR_MS * LATENCY_BUCKET_GROWTH ** (bucket - 0.5);
}

/** Records latencies in bounded memory; see the module comment. */
export class LatencyRecorder {
  private count = 0;
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;
  /** Exact samples, until there are too many; then `undefined`. */
  private samples: number[] | undefined = [];
  /** Bucket index to count, once the recorder has switched. */
  private readonly buckets = new Map<number, number>();

  private readonly exactLimit: number;

  /** `exactLimit` is injectable so tests reach the histogram cheaply. */
  constructor(exactLimit = EXACT_LATENCY_SAMPLES) {
    this.exactLimit = exactLimit;
  }

  add(ms: number): void {
    this.count++;
    this.sum += ms;
    if (ms < this.min) this.min = ms;
    if (ms > this.max) this.max = ms;
    if (this.samples !== undefined) {
      this.samples.push(ms);
      if (this.samples.length > this.exactLimit) {
        for (const s of this.samples) this.bucket(s);
        this.samples = undefined;
      }
      return;
    }
    this.bucket(ms);
  }

  private bucket(ms: number): void {
    const b = bucketOf(ms);
    this.buckets.set(b, (this.buckets.get(b) ?? 0) + 1);
  }

  /** The distribution, or `null` when nothing was recorded. */
  summarize(): LoadLatency | null {
    if (this.count === 0) return null;
    const pct = this.percentiles();
    return {
      min: round(this.min),
      mean: round(this.sum / this.count),
      p50: round(pct.p50),
      p90: round(pct.p90),
      p95: round(pct.p95),
      p99: round(pct.p99),
      p999: round(pct.p999),
      max: round(this.max),
    };
  }

  private percentiles(): Record<(typeof PERCENTILES)[number][0], number> {
    const out = { p50: 0, p90: 0, p95: 0, p99: 0, p999: 0 };
    if (this.samples !== undefined) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      for (const [key, p] of PERCENTILES) out[key] = percentile(sorted, p);
      return out;
    }
    const ordered = [...this.buckets].sort(([a], [b]) => a - b);
    for (const [key, p] of PERCENTILES) {
      const rank = nearestRank(this.count, p);
      let seen = 0;
      for (const [bucket, n] of ordered) {
        seen += n;
        if (seen >= rank) {
          // Clamped, so a percentile never reads outside what was observed.
          out[key] = Math.min(
            Math.max(bucketValue(bucket), this.min),
            this.max,
          );
          break;
        }
      }
    }
    return out;
  }
}

/** Summarize a list of latencies, or `null` for none. */
export function summarizeLatency(latencies: number[]): LoadLatency | null {
  const recorder = new LatencyRecorder();
  for (const ms of latencies) recorder.add(ms);
  return recorder.summarize();
}
