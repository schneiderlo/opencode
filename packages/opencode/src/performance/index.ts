import z from "zod"
import { Log } from "../util/log"
import { Storage } from "../storage/storage"

export namespace Performance {
  const log = Log.create({ service: "performance" })

  export const MetricType = z
    .enum([
      "gpu_utilization",
      "memory_usage",
      "render_time",
      "frame_rate",
      "draw_calls",
      "texture_memory",
      "shader_compilation_time",
      "buffer_upload_time",
      "cpu_time",
      "pipeline_stalls",
      "cache_hit_rate",
      "bandwidth_usage",
    ])
    .meta({ description: "Performance metric types" })

  export type MetricType = z.infer<typeof MetricType>

  export const MetricValue = z.object({
    value: z.number(),
    unit: z.string(),
    timestamp: z.number(),
    tags: z.record(z.string()).optional(),
  })

  export type MetricValue = z.infer<typeof MetricValue>

  export const MetricThreshold = z.object({
    warning: z.number(),
    critical: z.number(),
    unit: z.string(),
  })

  export type MetricThreshold = z.infer<typeof MetricThreshold>

  export const PerformanceProfile = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    metrics: z.record(MetricValue),
    thresholds: z.record(MetricThreshold),
    timestamp: z.number(),
    duration: z.number(),
  })

  export type PerformanceProfile = z.infer<typeof PerformanceProfile>

  export interface Profiler {
    start(): Promise<void>
    stop(): Promise<PerformanceProfile>
    isRunning(): boolean
    getMetrics(): Promise<Record<string, MetricValue>>
  }

  export interface Optimizer {
    analyze(profile: PerformanceProfile): Promise<Optimization[]>
    apply(optimization: Optimization): Promise<boolean>
    rollback(optimization: Optimization): Promise<boolean>
  }

  export const Optimization = z.object({
    id: z.string(),
    type: z.enum(["gpu", "memory", "render", "quality", "compute"]),
    name: z.string(),
    description: z.string(),
    impact: z.object({
      performance: z.number(),
      quality: z.number(),
      stability: z.number(),
    }),
    config: z.record(z.any()),
    applied: z.boolean(),
    timestamp: z.number(),
  })

  export type Optimization = z.infer<typeof Optimization>

  export interface BenchmarkSuite {
    name: string
    tests: BenchmarkTest[]
    run(): Promise<BenchmarkResult[]>
  }

  export interface BenchmarkTest {
    name: string
    setup?: () => Promise<void>
    execute(): Promise<number>
    teardown?: () => Promise<void>
    iterations?: number
    warmup?: number
  }

  export const BenchmarkResult = z.object({
    testName: z.string(),
    suiteName: z.string(),
    mean: z.number(),
    median: z.number(),
    min: z.number(),
    max: z.number(),
    stdDev: z.number(),
    samples: z.array(z.number()),
    timestamp: z.number(),
    metadata: z.record(z.any()).optional(),
  })

  export type BenchmarkResult = z.infer<typeof BenchmarkResult>

  export interface RegressionDetector {
    registerBaseline(results: BenchmarkResult[]): Promise<void>
    checkForRegression(newResults: BenchmarkResult[]): Promise<Regression[]>
  }

  export const Regression = z.object({
    testName: z.string(),
    baseline: z.number(),
    current: z.number(),
    regressionPercent: z.number(),
    significance: z.enum(["minor", "moderate", "major", "critical"]),
    timestamp: z.number(),
  })

  export type Regression = z.infer<typeof Regression>

  export interface QualityController {
    currentQuality: QualityLevel
    setQuality(level: QualityLevel): Promise<void>
    adapt(performance: PerformanceProfile): Promise<QualityLevel>
  }

  export const QualityLevel = z.enum(["low", "medium", "high", "ultra"])
  export type QualityLevel = z.infer<typeof QualityLevel>

  const profiles = new Map<string, PerformanceProfile>()
  const optimizers = new Map<string, Optimizer>()
  const profilers = new Map<string, Profiler>()

  export function registerProfiler(id: string, profiler: Profiler) {
    profilers.set(id, profiler)
    log.info(`Registered profiler: ${id}`)
  }

  export function registerOptimizer(id: string, optimizer: Optimizer) {
    optimizers.set(id, optimizer)
    log.info(`Registered optimizer: ${id}`)
  }

  export async function startProfiling(id: string): Promise<void> {
    const profiler = profilers.get(id)
    if (!profiler) {
      throw new Error(`Profiler not found: ${id}`)
    }
    if (profiler.isRunning()) {
      log.warn(`Profiler ${id} is already running`)
      return
    }
    await profiler.start()
    log.info(`Started profiling with: ${id}`)
  }

  export async function stopProfiling(id: string): Promise<PerformanceProfile> {
    const profiler = profilers.get(id)
    if (!profiler) {
      throw new Error(`Profiler not found: ${id}`)
    }
    if (!profiler.isRunning()) {
      throw new Error(`Profiler ${id} is not running`)
    }
    const profile = await profiler.stop()
    profiles.set(profile.id, profile)

    await Storage.write(["performance", "profiles", profile.id], profile)
    log.info(`Stopped profiling ${id}, saved profile: ${profile.id}`)

    return profile
  }

  export async function getProfile(id: string): Promise<PerformanceProfile | null> {
    if (profiles.has(id)) {
      return profiles.get(id)!
    }
    try {
      return await Storage.read<PerformanceProfile>(["performance", "profiles", id])
    } catch {
      return null
    }
  }

  export async function listProfiles(): Promise<string[]> {
    try {
      const keys = await Storage.list(["performance", "profiles"])
      return keys.map((key) => key[key.length - 1])
    } catch {
      return Array.from(profiles.keys())
    }
  }

  export async function optimizeProfile(profileId: string, optimizerId: string): Promise<Optimization[]> {
    const profile = await getProfile(profileId)
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`)
    }

    const optimizer = optimizers.get(optimizerId)
    if (!optimizer) {
      throw new Error(`Optimizer not found: ${optimizerId}`)
    }

    const optimizations = await optimizer.analyze(profile)
    log.info(`Generated ${optimizations.length} optimizations for profile ${profileId}`)

    return optimizations
  }

  export async function applyOptimization(optimization: Optimization): Promise<boolean> {
    const optimizer = Array.from(optimizers.values())[0]
    if (!optimizer) {
      throw new Error("No optimizer available")
    }

    const success = await optimizer.apply(optimization)
    if (success) {
      optimization.applied = true
      optimization.timestamp = Date.now()
      await Storage.write(["performance", "optimizations", optimization.id], optimization)
      log.info(`Applied optimization: ${optimization.name}`)
    } else {
      log.warn(`Failed to apply optimization: ${optimization.name}`)
    }

    return success
  }

  export async function getMetricHistory(
    metricType: MetricType,
    timeRange?: { start: number; end: number },
  ): Promise<MetricValue[]> {
    try {
      const profilePaths = await Storage.list(["performance", "profiles"])
      const history: MetricValue[] = []

      for (const profilePath of profilePaths) {
        const profile = await Storage.read<PerformanceProfile>(profilePath)
        if (!profile.metrics[metricType]) continue

        const metric = profile.metrics[metricType] as MetricValue
        if (timeRange) {
          if (metric.timestamp >= timeRange.start && metric.timestamp <= timeRange.end) {
            history.push(metric)
          }
        } else {
          history.push(metric)
        }
      }

      return history.sort((a, b) => a.timestamp - b.timestamp)
    } catch {
      return []
    }
  }

  export function createReport(profiles: PerformanceProfile[]): PerformanceReport {
    const report: PerformanceReport = {
      timestamp: Date.now(),
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        timestamp: p.timestamp,
        duration: p.duration,
        metrics: p.metrics,
      })),
      summary: {
        totalProfiles: profiles.length,
        averageFrameRate: 0,
        peakMemoryUsage: 0,
        averageGpuUtilization: 0,
      },
      recommendations: [],
    }

    if (profiles.length > 0) {
      const frameRates = profiles
        .map((p) => (p.metrics.frame_rate as MetricValue)?.value)
        .filter((v): v is number => v !== undefined)

      const memoryUsages = profiles
        .map((p) => (p.metrics.memory_usage as MetricValue)?.value)
        .filter((v): v is number => v !== undefined)

      const gpuUtils = profiles
        .map((p) => (p.metrics.gpu_utilization as MetricValue)?.value)
        .filter((v): v is number => v !== undefined)

      if (frameRates.length > 0) {
        report.summary.averageFrameRate = frameRates.reduce((a, b) => a + b, 0) / frameRates.length
      }

      if (memoryUsages.length > 0) {
        report.summary.peakMemoryUsage = Math.max(...memoryUsages)
      }

      if (gpuUtils.length > 0) {
        report.summary.averageGpuUtilization = gpuUtils.reduce((a, b) => a + b, 0) / gpuUtils.length
      }
    }

    if (report.summary.averageFrameRate < 30) {
      report.recommendations.push("Consider reducing render quality to improve frame rate")
    }

    if (report.summary.peakMemoryUsage > 8192) {
      report.recommendations.push("High memory usage detected - consider texture compression")
    }

    if (report.summary.averageGpuUtilization > 90) {
      report.recommendations.push("GPU near capacity - reduce render complexity")
    }

    return report
  }

  export const PerformanceReport = z.object({
    timestamp: z.number(),
    profiles: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        timestamp: z.number(),
        duration: z.number(),
        metrics: z.record(MetricValue),
      }),
    ),
    summary: z.object({
      totalProfiles: z.number(),
      averageFrameRate: z.number(),
      peakMemoryUsage: z.number(),
      averageGpuUtilization: z.number(),
    }),
    recommendations: z.array(z.string()),
  })

  export type PerformanceReport = z.infer<typeof PerformanceReport>
}
