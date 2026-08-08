// Config loader for content-forge. Resolves the machine-local producer/consumer
// paths with precedence: environment override > forge.config.json > sibling default.
//
// forge.config.json is git-ignored (machine-local); forge.config.example.json is the
// tracked template. Relative paths in the config resolve against the repo root.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function abs(base, value, fallback) {
  const v = value ?? fallback;
  if (!v) return null;
  return isAbsolute(v) ? v : resolve(base, v);
}

export function loadConfig() {
  const configPath = process.env.FORGE_CONFIG ? resolve(process.env.FORGE_CONFIG) : join(repoRoot, 'forge.config.json');
  const configPresent = existsSync(configPath);
  const cfg = configPresent ? readJson(configPath) : {};
  const consumer = cfg.consumer ?? {};
  const producer = cfg.producer ?? {};

  return {
    repoRoot,
    configPath,
    configPresent,
    // Consumer = Minosoft checkout (drives demand via its content queue).
    consumerRoot: process.env.MINOSOFT_ROOT
      ? resolve(process.env.MINOSOFT_ROOT)
      : abs(repoRoot, consumer.root, join('..', 'Minosoft')),
    stack: process.env.FORGE_STACK || consumer.stack || 'standalone',
    // Producer = Blockbench checkout (drives asset generation via CDP automation).
    producerRoot: process.env.BLOCKBENCH_ROOT
      ? resolve(process.env.BLOCKBENCH_ROOT)
      : abs(repoRoot, producer.root, join('..', 'blockbench')),
    cdpPort: Number(process.env.BLOCKBENCH_CDP_PORT || producer.cdpPort || 9223),
    // Handoff output root (the loose-content resource pack the consumer ingests).
    outDir: abs(repoRoot, cfg.out, 'out'),
  };
}

/** Print the resolved config (used by `npm run config`). */
export function describe(config = loadConfig()) {
  const line = (k, v) => `  ${k.padEnd(13)} ${v}`;
  return [
    config.configPresent ? `config: ${config.configPath}` : `config: (none — using defaults; copy forge.config.example.json)`,
    line('consumerRoot', config.consumerRoot),
    line('stack', config.stack),
    line('producerRoot', config.producerRoot),
    line('cdpPort', config.cdpPort),
    line('outDir', config.outDir),
  ].join('\n');
}

// `node scripts/config.mjs` prints the resolved config.
if (import.meta.url === `file://${process.argv[1]}`) console.log(describe());
