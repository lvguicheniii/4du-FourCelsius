const { monitorEventLoopDelay } = require('node:perf_hooks');

const SAMPLE_LIMIT = Math.max(256, Number(process.env.REQUEST_METRIC_SAMPLE_LIMIT) || 2048);
const samples = [];
const statusCounts = { success: 0, redirect: 0, clientError: 0, serverError: 0 };
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

let totalRequests = 0;
let slowRequests = 0;
let maxRequestMs = 0;

function recordRequestMetric(durationMs, statusCode) {
  const duration = Math.max(0, Number(durationMs) || 0);
  totalRequests += 1;
  maxRequestMs = Math.max(maxRequestMs, duration);
  if (duration >= 1000) slowRequests += 1;
  if (statusCode >= 500) statusCounts.serverError += 1;
  else if (statusCode >= 400) statusCounts.clientError += 1;
  else if (statusCode >= 300) statusCounts.redirect += 1;
  else statusCounts.success += 1;
  samples.push(duration);
  if (samples.length > SAMPLE_LIMIT) samples.shift();
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function nsToMs(value) {
  const milliseconds = Number(value) / 1e6;
  return Number.isFinite(milliseconds) ? Math.round(milliseconds * 10) / 10 : 0;
}

function getRuntimeMetrics() {
  return {
    requests: {
      total: totalRequests,
      sampled: samples.length,
      slow: slowRequests,
      status: { ...statusCounts },
      p50Ms: Math.round(percentile(samples, 0.5) * 10) / 10,
      p95Ms: Math.round(percentile(samples, 0.95) * 10) / 10,
      p99Ms: Math.round(percentile(samples, 0.99) * 10) / 10,
      maxMs: Math.round(maxRequestMs * 10) / 10,
    },
    eventLoop: {
      meanMs: nsToMs(eventLoop.mean),
      p95Ms: nsToMs(eventLoop.percentile(95)),
      p99Ms: nsToMs(eventLoop.percentile(99)),
      maxMs: nsToMs(eventLoop.max),
    },
  };
}

module.exports = { recordRequestMetric, getRuntimeMetrics };
