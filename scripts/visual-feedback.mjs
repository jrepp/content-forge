// visual-feedback: import Minosoft captures as recipe-addressable review evidence.
//
//   node scripts/visual-feedback.mjs ingest CAPTURE [--image PNG] [--target TARGET ...]
//     --issue TAG [--issue TAG ...] --note TEXT [--severity low|medium|high] [--by NAME]
//   node scripts/visual-feedback.mjs plan [--json]
//   node scripts/visual-feedback.mjs inspect CAPTURE [--image PNG] [--json]
//   node scripts/visual-feedback.mjs candidate ID [--note TEXT] [--by NAME]
//   node scripts/visual-feedback.mjs verify ID CAPTURE [--image PNG] [--note TEXT] [--by NAME]
//   node scripts/visual-feedback.mjs list [--status open|candidate|verified|dismissed]
//   node scripts/visual-feedback.mjs check
//
// The durable record contains hashes and producer lineage, not copied runtime
// screenshots. Minosoft remains the visual-evidence producer; content-forge owns
// review state and turns block/model captures into concrete texture dependencies.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { repoRoot } from './config.mjs';
import { decodePNG } from '../producers/raster/png.mjs';

const STORE = join(repoRoot, 'db', 'visual-feedback.json');
const OUTPUT = join(repoRoot, 'out');
const VALID_STATES = new Set(['open', 'candidate', 'verified', 'dismissed']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
const now = () => new Date().toISOString();
const readJson = (path, fallback = null) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha256File = (path) => existsSync(path) && statSync(path).isFile() ? sha256(readFileSync(path)) : null;
const fail = (message) => { throw new Error(message); };

function parseOptions(args) {
	const positional = [], values = new Map(), flags = new Set();
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith('--')) { positional.push(arg); continue; }
		const equals = arg.indexOf('=');
		const key = equals >= 0 ? arg.slice(0, equals) : arg;
		if (key === '--json' || key === '--force') { flags.add(key); continue; }
		const value = equals >= 0 ? arg.slice(equals + 1) : args[++i];
		if (value == null || value.startsWith('--')) fail(`${key} requires a value`);
		if (!values.has(key)) values.set(key, []);
		values.get(key).push(value);
	}
	return { positional, values, flags, one: (key, fallback = null) => values.get(key)?.at(-1) ?? fallback, all: (key) => values.get(key) || [] };
}

function portablePath(path) {
	const absolute = resolve(path);
	const rel = relative(repoRoot, absolute);
	return rel && !rel.startsWith('../../') ? rel.replaceAll('\\', '/') : absolute;
}

function storedPath(path) {
	return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function loadStore() {
	const store = readJson(STORE, { schema: 1, entries: [] });
	if (store?.schema !== 1 || !Array.isArray(store.entries)) fail(`${STORE} is not visual-feedback schema 1`);
	return store;
}

function saveStore(store) {
	store.entries.sort((a, b) => a.id.localeCompare(b.id));
	writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');
}

function captureInput(input, imageOverride = null) {
	const path = resolve(input);
	if (!existsSync(path)) fail(`capture does not exist: ${path}`);
	let capturePath = path, metadata = {}, image = imageOverride ? resolve(imageOverride) : null;
	if (statSync(path).isDirectory()) {
		capturePath = join(path, 'manifest.json');
		metadata = readJson(capturePath, {});
		const scene = readJson(join(path, 'scene.json'), null);
		if (scene) metadata = { ...metadata, scene };
		if (!image) image = join(path, 'frame.png');
	} else if (path.endsWith('.json')) {
		metadata = readJson(path, null);
		if (!metadata) fail(`capture JSON is invalid: ${path}`);
		if (!image) {
			const declared = metadata.output || metadata.capture?.output;
			if (declared) image = resolve(dirname(path), declared);
			else if (Array.isArray(metadata.captures) && metadata.captures.length === 1 && metadata.captures[0].output) image = resolve(dirname(path), metadata.captures[0].output);
		}
	} else if (path.endsWith('.png')) {
		image = path;
	} else fail(`capture must be a Minosoft diagnostic directory, JSON manifest, or PNG: ${path}`);
	if (!image || !existsSync(image) || !statSync(image).isFile()) fail(`capture image does not exist; pass --image PNG (resolved ${image || '(none)'})`);
	const bytes = readFileSync(image), decoded = decodePNG(bytes);
	const scene = metadata.schema === 'minosoft.scene-review/v1' ? metadata : metadata.scene;
	return {
		metadata,
		source: {
			producer: 'minosoft',
			capture: portablePath(capturePath),
			image: portablePath(image),
			imageSha256: sha256(bytes),
			width: decoded.width,
			height: decoded.height,
			kind: metadata.kind || (metadata.trajectory ? 'trajectory-diagnostic' : 'visual-capture'),
			trajectory: metadata.trajectory || null,
			contentFingerprint: metadata.contentFingerprint || scene?.content?.terrainFingerprint || scene?.content?.missingAssetFingerprint || null,
			contentGeneration: scene?.content?.hotReloadGeneration || null,
			sceneFrame: scene?.frame ?? null,
			capturedAt: metadata.createdAt || null,
		},
	};
}

function canonicalTarget(value) {
	if (value.startsWith('assets/')) return value;
	if (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)) {
		const [namespace, path] = value.split(':', 2);
		if (path.startsWith('textures/') && path.endsWith('.png')) return `assets/${namespace}/${path}`;
		return `assets/${namespace}/textures/${path}.png`;
	}
	if (/^[a-z0-9_./-]+$/.test(value)) {
		const path = value.includes('/') ? value : `block/${value}`;
		return `assets/minecraft/textures/${path}.png`;
	}
	fail(`invalid target: ${value}`);
}

function resourceTarget(id, kind, extension) {
	const normalized = id.includes(':') ? id : `minecraft:${id}`;
	const separator = normalized.indexOf(':');
	return `assets/${normalized.slice(0, separator)}/${kind}/${normalized.slice(separator + 1)}.${extension}`;
}

function modelIds(blockstate) {
	const found = new Set();
	const visit = (value) => {
		if (Array.isArray(value)) { value.forEach(visit); return; }
		if (!value || typeof value !== 'object') return;
		if (typeof value.model === 'string') found.add(value.model);
		Object.values(value).forEach(visit);
	};
	visit(blockstate);
	return found;
}

function textureDependencies(target) {
	const found = new Set(), visited = new Set();
	const visit = (current) => {
		if (visited.has(current)) return;
		visited.add(current);
		const file = join(OUTPUT, current);
		if (current.includes('/textures/') && current.endsWith('.png')) { found.add(current); return; }
		const json = readJson(file, null);
		if (!json) return;
		if (current.includes('/blockstates/')) {
			for (const id of modelIds(json)) visit(resourceTarget(id, 'models', 'json'));
			return;
		}
		if (current.includes('/models/')) {
			if (typeof json.parent === 'string' && !json.parent.startsWith('builtin/')) visit(resourceTarget(json.parent, 'models', 'json'));
			for (const id of Object.values(json.textures || {})) if (typeof id === 'string' && !id.startsWith('#')) visit(resourceTarget(id, 'textures', 'png'));
		}
	};
	visit(target);
	return [...found].sort();
}

function inferredTargets(metadata) {
	const roots = new Set();
	if (typeof metadata.target === 'string' && metadata.target) roots.add(metadata.target);
	for (const capture of metadata.captures || []) if (typeof capture.target === 'string' && capture.target) roots.add(capture.target);
	const textures = new Set();
	for (const root of roots) for (const target of textureDependencies(root)) textures.add(target);
	const scene = metadata.schema === 'minosoft.scene-review/v1' ? metadata : metadata.scene;
	for (const texture of scene?.textures || []) {
		const reference = texture.target || texture.resource;
		if (typeof reference === 'string' && reference) textures.add(canonicalTarget(reference));
	}
	return [...textures];
}

function targetRecords(targets) {
	const producers = readJson(join(OUTPUT, '.producers.json'), {});
	const provenance = readJson(join(OUTPUT, 'provenance.json'), { targets: [] });
	const provenanceByTarget = new Map((provenance.targets || []).map((entry) => [entry.target, entry]));
	return [...new Set(targets)].sort().map((target) => {
		const producer = producers[target] || provenanceByTarget.get(target) || {};
		return {
			target,
			producer: producer.producer || null,
			recipe: producer.recipe || null,
			beforeSha256: sha256File(join(OUTPUT, target)),
		};
	});
}

function actor(options) { return options.one('--by', process.env.USER || 'unknown'); }

function ingest(args) {
	const options = parseOptions(args), captureArg = options.positional[0];
	if (!captureArg) fail('usage: ingest CAPTURE --issue TAG --note TEXT [--target TARGET ...]');
	const issues = [...new Set(options.all('--issue'))].sort();
	if (!issues.length) fail('ingest requires at least one --issue TAG');
	const note = options.one('--note');
	if (!note) fail('ingest requires --note TEXT');
	const severity = options.one('--severity', 'medium');
	if (!VALID_SEVERITIES.has(severity)) fail('--severity must be low, medium, or high');
	const capture = captureInput(captureArg, options.one('--image'));
	const explicit = options.all('--target').map(canonicalTarget);
	const targets = targetRecords(explicit.length ? explicit : inferredTargets(capture.metadata));
	if (!targets.length) fail('capture did not identify texture dependencies; pass one or more --target values');
	const at = now(), by = actor(options);
	const id = sha256(JSON.stringify({ image: capture.source.imageSha256, targets: targets.map((t) => t.target), issues, note })).slice(0, 16);
	const store = loadStore();
	if (store.entries.some((entry) => entry.id === id)) { console.log(`feedback ${id} already exists`); return; }
	store.entries.push({
		id,
		state: 'open',
		severity,
		source: capture.source,
		feedback: { issues, note, by, at },
		targets,
		history: [{ state: 'open', by, at, note: 'Imported Minosoft visual evidence.' }],
	});
	saveStore(store);
	console.log(`ingested feedback ${id}: ${targets.length} texture target(s), ${issues.join(', ')}`);
}

function inspect(args) {
	const options = parseOptions(args), captureArg = options.positional[0];
	if (!captureArg) fail('usage: inspect CAPTURE [--image PNG] [--json]');
	const capture = captureInput(captureArg, options.one('--image'));
	const targets = targetRecords(inferredTargets(capture.metadata));
	const output = { schema: 1, source: capture.source, targets };
	if (options.flags.has('--json')) console.log(JSON.stringify(output, null, 2));
	else {
		console.log(`${capture.source.kind}: ${capture.source.width}x${capture.source.height}, ${targets.length} inferred texture target(s)`);
		for (const target of targets) console.log(`  ${target.target}  ${target.recipe || 'unclassified'}`);
	}
}

function transition(id, state, options, capture = null) {
	const store = loadStore(), entry = store.entries.find((candidate) => candidate.id === id);
	if (!entry) fail(`unknown feedback id: ${id}`);
	const at = now(), by = actor(options), note = options.one('--note', null);
	if (state === 'candidate') {
		let changed = 0;
		for (const target of entry.targets) {
			target.candidateSha256 = sha256File(join(OUTPUT, target.target));
			if (target.candidateSha256 && target.candidateSha256 !== target.beforeSha256) changed++;
		}
		if (!changed && !options.flags.has('--force')) fail(`feedback ${id} has no changed target bytes; regenerate first or pass --force`);
		entry.candidate = { by, at, note, changedTargets: changed };
	}
	if (state === 'verified' && capture) entry.verification = { ...capture.source, by, at, note };
	entry.state = state;
	entry.history.push({ state, by, at, note });
	saveStore(store);
	console.log(`${id} -> ${state}`);
}

function plan(args) {
	const options = parseOptions(args), active = loadStore().entries.filter((entry) => entry.state === 'open' || entry.state === 'candidate');
	const currentProducers = readJson(join(OUTPUT, '.producers.json'), {});
	const groups = new Map();
	for (const entry of active) for (const target of entry.targets) {
		const recipe = (currentProducers[target.target]?.recipe || target.recipe || 'unclassified').replace(/:ref-closure$/, '');
		if (!groups.has(recipe)) groups.set(recipe, { recipe, issues: new Set(), feedback: new Set(), targets: new Set(), states: new Set() });
		const group = groups.get(recipe);
		entry.feedback.issues.forEach((issue) => group.issues.add(issue));
		group.feedback.add(entry.id); group.targets.add(target.target); group.states.add(entry.state);
	}
	const output = [...groups.values()].map((group) => ({
		recipe: group.recipe,
		states: [...group.states].sort(),
		issues: [...group.issues].sort(),
		feedback: [...group.feedback].sort(),
		targets: [...group.targets].sort(),
	})).sort((a, b) => a.recipe.localeCompare(b.recipe));
	if (options.flags.has('--json')) console.log(JSON.stringify({ schema: 1, activeFeedback: active.length, recipes: output }, null, 2));
	else {
		console.log(`active visual feedback: ${active.length}`);
		for (const group of output) console.log(`  ${group.recipe.padEnd(18)} ${group.states.join('+').padEnd(16)} ${group.targets.length} target(s)  ${group.issues.join(', ')}`);
	}
}

function list(args) {
	const options = parseOptions(args), status = options.one('--status');
	if (status && !VALID_STATES.has(status)) fail(`invalid status: ${status}`);
	for (const entry of loadStore().entries.filter((entry) => !status || entry.state === status)) {
		console.log(`${entry.id}  ${entry.state.padEnd(9)} ${entry.severity.padEnd(6)} ${entry.targets.length} target(s)  ${entry.feedback.issues.join(', ')}  ${entry.feedback.note}`);
	}
}

function check() {
	const store = loadStore(), ids = new Set(); let warnings = 0;
	for (const entry of store.entries) {
		if (!entry.id || ids.has(entry.id)) fail(`duplicate or missing feedback id: ${entry.id}`);
		ids.add(entry.id);
		if (!VALID_STATES.has(entry.state)) fail(`${entry.id}: invalid state ${entry.state}`);
		if (!VALID_SEVERITIES.has(entry.severity)) fail(`${entry.id}: invalid severity ${entry.severity}`);
		if (!entry.source?.imageSha256 || !Array.isArray(entry.targets) || !entry.targets.length) fail(`${entry.id}: missing evidence or targets`);
		const image = entry.source.image ? storedPath(entry.source.image) : null;
		if (!image || !existsSync(image)) { warnings++; console.warn(`${entry.id}: source image is no longer present (${entry.source.image})`); }
		else if (sha256File(image) !== entry.source.imageSha256) fail(`${entry.id}: source image hash changed (${entry.source.image})`);
	}
	console.log(`visual feedback valid: ${store.entries.length} entries, ${warnings} unavailable runtime artifact(s)`);
}

const [command, ...args] = process.argv.slice(2);
try {
	switch (command) {
		case 'ingest': ingest(args); break;
		case 'inspect': inspect(args); break;
		case 'plan': plan(args); break;
		case 'list': list(args); break;
		case 'candidate': { const options = parseOptions(args.slice(1)); transition(args[0], 'candidate', options); break; }
		case 'verify': { const options = parseOptions(args.slice(2)); transition(args[0], 'verified', options, captureInput(args[1], options.one('--image'))); break; }
		case 'dismiss': { const options = parseOptions(args.slice(1)); transition(args[0], 'dismissed', options); break; }
		case 'check': check(); break;
		default: fail('commands: ingest | inspect | plan | list | candidate | verify | dismiss | check');
	}
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
