#!/usr/bin/env node
/**
 * Text-to-Image Benchmark Suite
 *
 * Benchmarks each text-to-image model at both minimum and maximum step counts
 * (aligned with sogni-socket modelTiers.json) to determine:
 *   - Base inference cost (fixed overhead: model load, latent creation, VAE decode)
 *   - Per-step cost (incremental cost of each additional inference step)
 *
 * For each model and step count, 3 back-to-back generations are run:
 *   - Run 1: warmup (primes the model on the worker, discarded)
 *   - Runs 2-3: measured and averaged
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - Sufficient token balance for all generations
 *
 * Usage:
 *   node benchmark_text_to_image.mjs                                # Benchmark all models
 *   node benchmark_text_to_image.mjs --network relaxed              # Benchmark on relaxed network
 *   node benchmark_text_to_image.mjs --models z-turbo,flux1-schnell # Specific models
 *   node benchmark_text_to_image.mjs --prompt "A red car"           # Custom prompt
 *   node benchmark_text_to_image.mjs --runs 5                       # More runs per step count
 *   node benchmark_text_to_image.mjs --no-download                  # Skip image downloads
 *
 * Options:
 *   --network      Network type: fast or relaxed (default: fast)
 *   --models       Comma-separated list of model keys to benchmark (default: all)
 *   --prompt       Prompt to use for all generations (default: built-in benchmark prompt)
 *   --runs         Number of runs per step count (default: 3, minimum: 3)
 *   --warmup       Number of warmup runs to discard (default: 1)
 *   --output       Output directory for generated images (default: ./output/benchmark)
 *   --no-download  Skip downloading images (faster benchmarks, timing only)
 *   --help         Show this help message
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import {
  MODELS,
  log,
  generateRandomSeed,
  defaultExamplesOutputDir
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);

// Benchmark prompt — short, descriptive, safe for all models
const DEFAULT_BENCHMARK_PROMPT =
  'A majestic snow-capped mountain range at golden hour with a crystal clear alpine lake in the foreground reflecting the peaks, photorealistic';

// ============================================
// Model Tier Step Ranges (from sogni-socket/data/modelTiers.json)
//
// These are the authoritative min/max step values used by the server
// for cost calculation. The benchmark runs at these exact boundaries
// to derive base inference cost and per-step cost.
// ============================================

const MODEL_TIER_STEPS = {
  'z_image_turbo_bf16':              { min: 4,  max: 10, default: 8 },
  'z_image_bf16':                    { min: 20, max: 50, default: 25 },
  'chroma-v.46-flash_fp8':           { min: 10, max: 20, default: 10 },
  'chroma-v48-detail-svd_fp8':       { min: 20, max: 40, default: 20 },
  'flux1-krea-dev_fp8_scaled':       { min: 12, max: 40, default: 20 },
  'flux1-schnell-fp8':               { min: 1,  max: 5,  default: 4 },
  'flux2_dev_fp8':                   { min: 20, max: 50, default: 20 },
  'qwen_image_2512_fp8_lightning':   { min: 4,  max: 8,  default: 4 },
  'qwen_image_2512_fp8':             { min: 20, max: 50, default: 20 }
};

// ============================================
// Parse Command Line Arguments
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    network: 'fast',
    models: null,
    prompt: DEFAULT_BENCHMARK_PROMPT,
    runs: 3,
    warmup: 1,
    output: defaultExamplesOutputDir('benchmark'),
    download: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--network' && args[i + 1]) {
      const net = args[++i];
      if (net !== 'fast' && net !== 'relaxed') {
        console.error(`Error: --network must be 'fast' or 'relaxed', got '${net}'`);
        process.exit(1);
      }
      options.network = net;
    } else if (arg === '--models' && args[i + 1]) {
      options.models = args[++i].split(',').map((m) => m.trim());
    } else if (arg === '--prompt' && args[i + 1]) {
      options.prompt = args[++i];
    } else if (arg === '--runs' && args[i + 1]) {
      options.runs = parseInt(args[++i], 10);
    } else if (arg === '--warmup' && args[i + 1]) {
      options.warmup = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--no-download') {
      options.download = false;
    } else {
      console.error(`Unknown option: ${arg}`);
      showHelp();
      process.exit(1);
    }
  }

  // Ensure at least warmup + 2 measured runs
  const minRuns = options.warmup + 2;
  if (options.runs < minRuns) {
    console.error(`Error: --runs must be at least ${minRuns} (warmup ${options.warmup} + 2 measured runs). Setting to ${minRuns}.`);
    options.runs = minRuns;
  }

  return options;
}

function showHelp() {
  console.log(`
Text-to-Image Benchmark Suite

Benchmarks each model at min and max steps (from modelTiers) to derive
base inference cost and per-step cost.

Usage:
  node benchmark_text_to_image.mjs                                # Benchmark all models (fast network)
  node benchmark_text_to_image.mjs --network relaxed              # Benchmark on relaxed network
  node benchmark_text_to_image.mjs --models z-turbo,flux1-schnell # Specific models
  node benchmark_text_to_image.mjs --prompt "A red car"           # Custom prompt
  node benchmark_text_to_image.mjs --runs 5                       # 5 runs per step count
  node benchmark_text_to_image.mjs --no-download                  # Skip image downloads

Available Models:
${Object.entries(MODELS.image)
  .map(([key, cfg]) => {
    const tier = MODEL_TIER_STEPS[cfg.id];
    const steps = tier ? `steps ${tier.min}-${tier.max}` : `steps ${cfg.minSteps}-${cfg.maxSteps}`;
    return `  ${key.padEnd(24)} - ${cfg.name} (${steps})`;
  })
  .join('\n')}

Options:
  --network      Network type: fast or relaxed (default: fast)
  --models       Comma-separated model keys to benchmark (default: all)
  --prompt       Prompt for all generations (default: built-in benchmark prompt)
  --runs         Total runs per step count (default: 3, min: warmup + 2)
  --warmup       Warmup runs to discard (default: 1)
  --output       Output directory (default: ./output/benchmark)
  --no-download  Skip downloading generated images
  --help         Show this help message
`);
}

// ============================================
// Benchmark Helpers
// ============================================

/**
 * Run a single image generation and return timing info.
 * @param {Object} sogni - SDK instance
 * @param {Object} modelConfig - Model config from MODELS.image
 * @param {string} prompt - Text prompt
 * @param {string} tokenType - Payment token type
 * @param {number} steps - Number of inference steps to use
 * @returns {Promise<{durationMs, resultUrl, seed, success, error}>}
 */
function runSingleGeneration(sogni, modelConfig, prompt, tokenType, steps) {
  return new Promise(async (resolve) => {
    const seed = generateRandomSeed();
    const startTime = Date.now();

    const projectParams = {
      type: 'image',
      modelId: modelConfig.id,
      positivePrompt: prompt,
      numberOfMedia: 1,
      steps,
      seed,
      numberOfPreviews: 0,
      disableNSFWFilter: false,
      outputFormat: 'jpg',
      tokenType,
      width: modelConfig.defaultWidth,
      height: modelConfig.defaultHeight
    };

    // Add guidance if supported
    if (modelConfig.supportsGuidance && modelConfig.defaultGuidance !== undefined) {
      projectParams.guidance = modelConfig.defaultGuidance;
    }

    // Add default negative prompt if model has one
    if (modelConfig.defaultNegativePrompt) {
      projectParams.negativePrompt = modelConfig.defaultNegativePrompt;
    }

    // Add sampler/scheduler
    if (modelConfig.isComfyModel && modelConfig.defaultComfySampler) {
      projectParams.sampler = modelConfig.defaultComfySampler;
    } else if (!modelConfig.isComfyModel && modelConfig.defaultSampler) {
      projectParams.sampler = modelConfig.defaultSampler;
    }
    if (modelConfig.isComfyModel && modelConfig.defaultComfyScheduler) {
      projectParams.scheduler = modelConfig.defaultComfyScheduler;
    } else if (!modelConfig.isComfyModel && modelConfig.defaultScheduler) {
      projectParams.scheduler = modelConfig.defaultScheduler;
    }

    try {
      const project = await sogni.projects.create(projectParams);

      // Project-level events: only handle errors/failures.
      // Completion with resultUrl comes from job-level events only.
      const onProject = (event) => {
        if (event.projectId !== project.id) return;

        if (event.type === 'error' || event.type === 'failed') {
          cleanup();
          const durationMs = Date.now() - startTime;
          resolve({ durationMs, resultUrl: null, seed, success: false, error: event.error?.message || event.error || 'Unknown error' });
        }
      };

      // Job-level events: handle completion (with resultUrl) and errors.
      const onJob = (event) => {
        if (event.projectId !== project.id) return;

        if (event.type === 'completed') {
          if (!event.jobId) return; // Ignore events without jobId
          cleanup();
          const durationMs = Date.now() - startTime;

          if (event.isNSFW || !event.resultUrl) {
            resolve({ durationMs, resultUrl: null, seed, success: false, error: event.isNSFW ? 'NSFW filter triggered' : 'No result URL' });
          } else {
            resolve({ durationMs, resultUrl: event.resultUrl, seed, success: true, error: null });
          }
        }

        if (event.type === 'error' || event.type === 'failed') {
          cleanup();
          const durationMs = Date.now() - startTime;
          resolve({ durationMs, resultUrl: null, seed, success: false, error: event.error?.message || event.error || 'Unknown error' });
        }
      };

      function cleanup() {
        sogni.projects.off('project', onProject);
        sogni.projects.off('job', onJob);
      }

      sogni.projects.on('project', onProject);
      sogni.projects.on('job', onJob);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      resolve({ durationMs, resultUrl: null, seed, success: false, error: error.message });
    }
  });
}

/**
 * Run a batch of generations at a given step count and return stats.
 */
async function benchmarkAtStepCount(sogni, modelConfig, prompt, tokenType, steps, totalRuns, warmupRuns, download, outputDir, modelKey) {
  const measuredRunCount = totalRuns - warmupRuns;
  const runs = [];

  for (let run = 1; run <= totalRuns; run++) {
    const isWarmup = run <= warmupRuns;
    const label = isWarmup
      ? `    Warmup ${run}/${warmupRuns}`
      : `    Run ${run - warmupRuns}/${measuredRunCount}`;

    process.stdout.write(`${label}: generating...`);

    const result = await runSingleGeneration(sogni, modelConfig, prompt, tokenType, steps);

    if (result.success) {
      process.stdout.write(`\r${label}: ${formatDuration(result.durationMs)}${isWarmup ? ' (warmup - discarded)' : ''}\n`);

      if (download && result.resultUrl) {
        const filename = `${modelKey}_${steps}steps_run${run}_${result.seed}.jpg`;
        const filepath = `${outputDir}/${filename}`;
        try {
          await downloadImage(result.resultUrl, filepath);
        } catch (e) {
          console.log(`      Warning: download failed - ${e.message}`);
        }
      }
    } else {
      process.stdout.write(`\r${label}: FAILED - ${result.error}\n`);
    }

    runs.push({ run, isWarmup, durationMs: result.durationMs, success: result.success, error: result.error });
  }

  // Compute stats from measured (non-warmup) successful runs
  const measuredTimes = runs.filter((r) => !r.isWarmup && r.success).map((r) => r.durationMs);

  let avgMs = null;
  let medianMs = null;
  let minMs = null;
  let maxMs = null;

  if (measuredTimes.length > 0) {
    avgMs = measuredTimes.reduce((a, b) => a + b, 0) / measuredTimes.length;
    const sorted = [...measuredTimes].sort((a, b) => a - b);
    medianMs = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    minMs = sorted[0];
    maxMs = sorted[sorted.length - 1];
  }

  const warmupRun = runs.find((r) => r.isWarmup && r.success);
  const warmupMs = warmupRun ? warmupRun.durationMs : null;
  const failedCount = runs.filter((r) => !r.success).length;

  return { steps, runs, measuredCount: measuredTimes.length, avgMs, medianMs, minMs, maxMs, warmupMs, failedCount };
}

/**
 * Download an image from URL to a local path.
 */
async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }
  const fileStream = fs.createWriteStream(outputPath);
  await streamPipeline(response.body, fileStream);
}

/**
 * Format milliseconds into a human-readable string.
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(2);
  return `${seconds}s`;
}

// ============================================
// Main Benchmark Logic
// ============================================

async function main() {
  const OPTIONS = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║         Text-to-Image Inference Cost Benchmark Suite             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log();

  // Determine which models to benchmark
  const allModelKeys = Object.keys(MODELS.image);
  const modelKeys = OPTIONS.models
    ? OPTIONS.models.filter((key) => {
        if (!MODELS.image[key]) {
          console.error(`Warning: Unknown model '${key}', skipping.`);
          return false;
        }
        return true;
      })
    : allModelKeys;

  if (modelKeys.length === 0) {
    console.error('Error: No valid models to benchmark.');
    process.exit(1);
  }

  // Total generations = models * 3 step counts * runs (min + default + max; fewer if default == min or max)
  let totalPhases = 0;
  for (const key of modelKeys) {
    const cfg = MODELS.image[key];
    const tier = MODEL_TIER_STEPS[cfg?.id];
    if (!tier) continue;
    totalPhases += (tier.default !== tier.min && tier.default !== tier.max) ? 3 : 2;
  }
  const totalGenerations = totalPhases * OPTIONS.runs;

  console.log(`Benchmark Configuration:`);
  console.log(`  Network:             ${OPTIONS.network}`);
  console.log(`  Models:              ${modelKeys.length} (${modelKeys.join(', ')})`);
  console.log(`  Runs per step count: ${OPTIONS.runs} (${OPTIONS.warmup} warmup + ${OPTIONS.runs - OPTIONS.warmup} measured)`);
  console.log(`  Step counts:         min + default + max per model (from modelTiers)`);
  console.log(`  Total generations:   ${totalGenerations}`);
  console.log(`  Prompt:              ${OPTIONS.prompt.substring(0, 70)}${OPTIONS.prompt.length > 70 ? '...' : ''}`);
  console.log(`  Download images:     ${OPTIONS.download ? 'yes' : 'no'}`);
  console.log(`  Output:              ${OPTIONS.output}`);
  console.log();

  // Load credentials and connect
  const credentials = await loadCredentials();
  let tokenType = loadTokenTypePreference() || 'spark';
  console.log(`Using ${tokenType} tokens for payment.`);
  console.log();

  log('🔄', `Connecting to Sogni (${OPTIONS.network} network)...`);

  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const clientConfig = {
    appId: `sogni-benchmark-${Date.now()}`,
    network: OPTIONS.network
  };

  if (testnet) clientConfig.testnet = testnet;
  if (socketEndpoint) clientConfig.socketEndpoint = socketEndpoint;
  if (restEndpoint) clientConfig.restEndpoint = restEndpoint;

  if (credentials.apiKey) clientConfig.apiKey = credentials.apiKey;
  const sogni = await SogniClient.createInstance(clientConfig);
  if (!credentials.apiKey) {
    await sogni.account.login(credentials.username, credentials.password);
  }
  await sogni.projects.waitForModels();
  log('✓', credentials.apiKey ? 'Connected with API key' : `Connected and logged in as: ${credentials.username}`);
  console.log();

  // Create output directory
  if (OPTIONS.download && !fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // ============================================
  // Run Benchmarks
  // ============================================

  const results = [];

  for (let mi = 0; mi < modelKeys.length; mi++) {
    const modelKey = modelKeys[mi];
    const modelConfig = MODELS.image[modelKey];
    const tier = MODEL_TIER_STEPS[modelConfig.id];
    const modelProgress = `[${mi + 1}/${modelKeys.length}]`;

    if (!tier) {
      console.log(`${modelProgress} Skipping ${modelConfig.name}: no modelTiers entry for ${modelConfig.id}`);
      console.log();
      continue;
    }

    const { min: minSteps, max: maxSteps } = tier;

    console.log('═'.repeat(65));
    console.log(`${modelProgress} ${modelConfig.name}`);
    console.log(`  Model ID:    ${modelConfig.id}`);
    console.log(`  Resolution:  ${modelConfig.defaultWidth}x${modelConfig.defaultHeight}`);
    console.log(`  Tier Steps:  ${minSteps} (min) / ${maxSteps} (max) / ${tier.default} (default)`);
    console.log(`  Guidance:    ${modelConfig.defaultGuidance ?? 'N/A'}`);
    console.log('═'.repeat(65));

    // --- Benchmark at MIN steps ---
    console.log(`\n  ▸ Phase 1: ${minSteps} steps (min)`);
    const minResult = await benchmarkAtStepCount(
      sogni, modelConfig, OPTIONS.prompt, tokenType,
      minSteps, OPTIONS.runs, OPTIONS.warmup, OPTIONS.download, OPTIONS.output, modelKey
    );

    if (minResult.avgMs !== null) {
      console.log(`    → Avg: ${formatDuration(Math.round(minResult.avgMs))} | Range: ${formatDuration(minResult.minMs)}-${formatDuration(minResult.maxMs)}`);
    } else {
      console.log(`    → No successful measured runs`);
    }

    // --- Benchmark at DEFAULT steps (validation) ---
    // Skip if default equals min or max since we already measured it
    const defaultSteps = tier.default;
    const defaultMatchesMinOrMax = defaultSteps === minSteps || defaultSteps === maxSteps;
    let defaultResult = null;

    if (!defaultMatchesMinOrMax) {
      console.log(`\n  ▸ Phase 2: ${defaultSteps} steps (default — validation)`);
      defaultResult = await benchmarkAtStepCount(
        sogni, modelConfig, OPTIONS.prompt, tokenType,
        defaultSteps, OPTIONS.runs, OPTIONS.warmup, OPTIONS.download, OPTIONS.output, modelKey
      );

      if (defaultResult.avgMs !== null) {
        console.log(`    → Avg: ${formatDuration(Math.round(defaultResult.avgMs))} | Range: ${formatDuration(defaultResult.minMs)}-${formatDuration(defaultResult.maxMs)}`);
      } else {
        console.log(`    → No successful measured runs`);
      }
    } else {
      // Reuse the matching benchmark as the default result
      defaultResult = defaultSteps === minSteps ? minResult : null; // will be set after maxResult
    }

    // --- Benchmark at MAX steps ---
    const maxPhaseNum = defaultMatchesMinOrMax ? 2 : 3;
    console.log(`\n  ▸ Phase ${maxPhaseNum}: ${maxSteps} steps (max)`);
    const maxResult = await benchmarkAtStepCount(
      sogni, modelConfig, OPTIONS.prompt, tokenType,
      maxSteps, OPTIONS.runs, OPTIONS.warmup, OPTIONS.download, OPTIONS.output, modelKey
    );

    if (maxResult.avgMs !== null) {
      console.log(`    → Avg: ${formatDuration(Math.round(maxResult.avgMs))} | Range: ${formatDuration(maxResult.minMs)}-${formatDuration(maxResult.maxMs)}`);
    } else {
      console.log(`    → No successful measured runs`);
    }

    // If default == max, point to the max result
    if (defaultMatchesMinOrMax && defaultSteps === maxSteps) {
      defaultResult = maxResult;
    }

    // --- Derive cost model ---
    // time = baseMs + steps * perStepMs
    // Solving from two data points (min and max):
    //   avgMin = baseMs + minSteps * perStepMs
    //   avgMax = baseMs + maxSteps * perStepMs
    //   perStepMs = (avgMax - avgMin) / (maxSteps - minSteps)
    //   baseMs    = avgMin - minSteps * perStepMs

    let baseMs = null;
    let perStepMs = null;

    if (minResult.avgMs !== null && maxResult.avgMs !== null && maxSteps > minSteps) {
      perStepMs = (maxResult.avgMs - minResult.avgMs) / (maxSteps - minSteps);
      baseMs = minResult.avgMs - minSteps * perStepMs;
    }

    // Validation: compare measured default to derived prediction
    let defaultDerivedMs = null;
    let defaultErrorMs = null;
    let defaultErrorPct = null;

    if (baseMs !== null && perStepMs !== null) {
      defaultDerivedMs = Math.round(baseMs + defaultSteps * perStepMs);

      if (defaultResult?.avgMs !== null) {
        defaultErrorMs = Math.round(defaultResult.avgMs - defaultDerivedMs);
        defaultErrorPct = ((defaultResult.avgMs - defaultDerivedMs) / defaultDerivedMs * 100).toFixed(1);
      }
    }

    if (baseMs !== null && perStepMs !== null) {
      console.log(`\n  ┌─ Cost Model ─────────────────────────────────────────────────┐`);
      console.log(`  │  Base inference:  ${formatDuration(Math.round(baseMs)).padEnd(10)} (fixed overhead per generation)  │`);
      console.log(`  │  Per step:        ${formatDuration(Math.round(perStepMs)).padEnd(10)} (incremental per step)         │`);
      console.log(`  │                                                               │`);
      console.log(`  │  Step Count       Measured     Derived      Error              │`);
      console.log(`  │  ${String(minSteps).padStart(3)} (min)        ${formatDuration(Math.round(minResult.avgMs)).padEnd(13)}${formatDuration(Math.round(baseMs + minSteps * perStepMs)).padEnd(13)}--              │`);

      if (defaultResult?.avgMs !== null) {
        const errStr = `${defaultErrorMs >= 0 ? '+' : ''}${formatDuration(Math.abs(defaultErrorMs))} (${defaultErrorMs >= 0 ? '+' : ''}${defaultErrorPct}%)`;
        console.log(`  │  ${String(defaultSteps).padStart(3)} (default)    ${formatDuration(Math.round(defaultResult.avgMs)).padEnd(13)}${formatDuration(defaultDerivedMs).padEnd(13)}${errStr.padEnd(16)}│`);
      } else {
        console.log(`  │  ${String(defaultSteps).padStart(3)} (default)    ${'N/A'.padEnd(13)}${formatDuration(defaultDerivedMs).padEnd(13)}--              │`);
      }

      console.log(`  │  ${String(maxSteps).padStart(3)} (max)        ${formatDuration(Math.round(maxResult.avgMs)).padEnd(13)}${formatDuration(Math.round(baseMs + maxSteps * perStepMs)).padEnd(13)}--              │`);
      console.log(`  └───────────────────────────────────────────────────────────────┘`);
    }

    const totalFailed = minResult.failedCount + maxResult.failedCount + (defaultResult && !defaultMatchesMinOrMax ? defaultResult.failedCount : 0);
    if (totalFailed > 0) {
      console.log(`  ⚠ ${totalFailed} failed run(s)`);
    }

    results.push({
      modelKey,
      modelName: modelConfig.name,
      modelId: modelConfig.id,
      resolution: `${modelConfig.defaultWidth}x${modelConfig.defaultHeight}`,
      tierSteps: tier,
      minStepsBenchmark: minResult,
      defaultStepsBenchmark: defaultResult,
      defaultMatchesMinOrMax,
      maxStepsBenchmark: maxResult,
      costModel: {
        baseMs: baseMs !== null ? Math.round(baseMs) : null,
        perStepMs: perStepMs !== null ? Math.round(perStepMs) : null,
        defaultDerivedMs,
        defaultMeasuredMs: defaultResult?.avgMs !== null ? Math.round(defaultResult.avgMs) : null,
        defaultErrorMs,
        defaultErrorPct: defaultErrorPct !== null ? parseFloat(defaultErrorPct) : null
      }
    });

    console.log();
  }

  // ============================================
  // Summary Report
  // ============================================

  console.log();
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                    BENCHMARK RESULTS SUMMARY                                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log();

  // Per-step-count results table
  console.log('Timing by Step Count:');
  console.log();

  const col = { model: 26, steps: 7, avg: 10, median: 10, min: 10, max: 10, warmup: 10, fail: 6 };

  const timingHeader =
    'Model'.padEnd(col.model) +
    'Steps'.padEnd(col.steps) +
    'Avg'.padEnd(col.avg) +
    'Median'.padEnd(col.median) +
    'Min'.padEnd(col.min) +
    'Max'.padEnd(col.max) +
    'Warmup'.padEnd(col.warmup) +
    'Fails'.padEnd(col.fail);

  console.log(timingHeader);
  console.log('─'.repeat(timingHeader.length));

  for (const r of results) {
    const benchmarks = [r.minStepsBenchmark];
    if (!r.defaultMatchesMinOrMax) {
      benchmarks.push(r.defaultStepsBenchmark);
    }
    benchmarks.push(r.maxStepsBenchmark);

    for (const bench of benchmarks) {
      const stepLabel = bench.steps === r.tierSteps.min ? `${bench.steps}*`
        : bench.steps === r.tierSteps.max ? `${bench.steps}*`
        : bench.steps === r.tierSteps.default ? `${bench.steps}d`
        : String(bench.steps);
      const row =
        r.modelName.substring(0, col.model - 2).padEnd(col.model) +
        stepLabel.padEnd(col.steps) +
        (bench.avgMs !== null ? formatDuration(Math.round(bench.avgMs)) : 'N/A').padEnd(col.avg) +
        (bench.medianMs !== null ? formatDuration(Math.round(bench.medianMs)) : 'N/A').padEnd(col.median) +
        (bench.minMs !== null ? formatDuration(bench.minMs) : 'N/A').padEnd(col.min) +
        (bench.maxMs !== null ? formatDuration(bench.maxMs) : 'N/A').padEnd(col.max) +
        (bench.warmupMs !== null ? formatDuration(bench.warmupMs) : 'N/A').padEnd(col.warmup) +
        String(bench.failedCount).padEnd(col.fail);
      console.log(row);
    }
  }
  console.log('  (* = min/max boundary used for cost model, d = default validation)');

  console.log('─'.repeat(timingHeader.length));
  console.log();

  // Cost model table
  console.log('Derived Cost Model (time = base + steps * perStep):');
  console.log();

  const costCol = { model: 26, base: 12, perStep: 12, defDerived: 13, defMeasured: 13, defError: 14 };

  const costHeader =
    'Model'.padEnd(costCol.model) +
    'Base'.padEnd(costCol.base) +
    'Per Step'.padEnd(costCol.perStep) +
    'Def Derived'.padEnd(costCol.defDerived) +
    'Def Measured'.padEnd(costCol.defMeasured) +
    'Def Error'.padEnd(costCol.defError);

  console.log(costHeader);
  console.log('─'.repeat(costHeader.length));

  for (const r of results) {
    const cm = r.costModel;

    const errStr = cm.defaultErrorPct !== null
      ? `${cm.defaultErrorMs >= 0 ? '+' : ''}${formatDuration(Math.abs(cm.defaultErrorMs))} (${cm.defaultErrorMs >= 0 ? '+' : ''}${cm.defaultErrorPct}%)`
      : 'N/A';

    const row =
      r.modelName.substring(0, costCol.model - 2).padEnd(costCol.model) +
      (cm.baseMs !== null ? formatDuration(cm.baseMs) : 'N/A').padEnd(costCol.base) +
      (cm.perStepMs !== null ? formatDuration(cm.perStepMs) : 'N/A').padEnd(costCol.perStep) +
      (cm.defaultDerivedMs !== null ? formatDuration(cm.defaultDerivedMs) : 'N/A').padEnd(costCol.defDerived) +
      (cm.defaultMeasuredMs !== null ? formatDuration(cm.defaultMeasuredMs) : 'N/A').padEnd(costCol.defMeasured) +
      errStr.padEnd(costCol.defError);
    console.log(row);
  }

  console.log('─'.repeat(costHeader.length));
  console.log();

  // Ranking by per-step cost (fastest per step first)
  const rankedPerStep = results
    .filter((r) => r.costModel.perStepMs !== null)
    .sort((a, b) => a.costModel.perStepMs - b.costModel.perStepMs);

  if (rankedPerStep.length > 0) {
    console.log('Ranking by per-step cost (fastest per step):');
    rankedPerStep.forEach((r, i) => {
      const rank = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
      console.log(`  ${rank.padEnd(5)} ${r.modelName.padEnd(26)} ${formatDuration(r.costModel.perStepMs)}/step  (base: ${formatDuration(r.costModel.baseMs)})`);
    });
    console.log();
  }

  // Save results as JSON
  const jsonPath = `${OPTIONS.output}/benchmark_results.json`;
  const jsonData = {
    timestamp: new Date().toISOString(),
    config: {
      network: OPTIONS.network,
      prompt: OPTIONS.prompt,
      runsPerStepCount: OPTIONS.runs,
      warmupRuns: OPTIONS.warmup,
      measuredRuns: OPTIONS.runs - OPTIONS.warmup,
      tokenType
    },
    results: results.map((r) => {
      const serializeBench = (b) => ({
        steps: b.steps,
        measuredCount: b.measuredCount,
        avgMs: b.avgMs !== null ? Math.round(b.avgMs) : null,
        medianMs: b.medianMs !== null ? Math.round(b.medianMs) : null,
        minMs: b.minMs,
        maxMs: b.maxMs,
        warmupMs: b.warmupMs,
        failedCount: b.failedCount,
        runs: b.runs
      });

      return {
        modelKey: r.modelKey,
        modelName: r.modelName,
        modelId: r.modelId,
        resolution: r.resolution,
        tierSteps: r.tierSteps,
        costModel: r.costModel,
        minStepsBenchmark: serializeBench(r.minStepsBenchmark),
        defaultStepsBenchmark: r.defaultStepsBenchmark ? serializeBench(r.defaultStepsBenchmark) : null,
        defaultMatchesMinOrMax: r.defaultMatchesMinOrMax,
        maxStepsBenchmark: serializeBench(r.maxStepsBenchmark)
      };
    })
  };

  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
  log('💾', `Results saved to: ${jsonPath}`);

  console.log();
  log('✓', 'Benchmark complete!');
  process.exit(0);
}

// ============================================
// Run
// ============================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
