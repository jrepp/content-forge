// @ts-check
// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Portable procedural texture generator core (authored, seed-driven).
 *
 * ZERO DOM / Blockbench dependencies: every function builds or mutates an RGBA
 * {@link PixelBuffer}. The host turns a buffer into a Texture; the (future) paint
 * UI panel calls these same functions — one core, two front-ends. The primitive /
 * family / palette vocabulary aligns with Minosoft's asset-primitive-decomposition
 * spec so the producer can serve the consumer's family-tagged demand.
 *
 * Design intent: give authors AND automation both a quick preset lane (a family)
 * and full compositional control (an ordered list of primitive ops), all
 * deterministic in a seed so results are reproducible and tweakable.
 */

/** @typedef {{ width:number, height:number, data:Uint8ClampedArray }} PixelBuffer */

const SIZE_DEFAULT = 16;

// ---- color math ----
/** @param {number} v */
const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
/** @param {number[]} a @param {number[]} b @param {number} t */
export function mix(a, b, t) {
	return [clampByte(a[0] + (b[0] - a[0]) * t), clampByte(a[1] + (b[1] - a[1]) * t), clampByte(a[2] + (b[2] - a[2]) * t)];
}
/** @param {number[]} c @param {number} d */
export function shade(c, d) {
	return [clampByte(c[0] + d), clampByte(c[1] + d), clampByte(c[2] + d)];
}
/** @param {number} h @param {number} s @param {number} v */
export function hsv(h, s, v) {
	h = ((h % 360) + 360) % 360;
	const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
	let r = 0, g = 0, b = 0;
	if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
	else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
	return [clampByte((r + m) * 255), clampByte((g + m) * 255), clampByte((b + m) * 255)];
}
/** Normalize a color (hex string or number array) to `[r,g,b,a]`. @param {any} color */
function toRGBA(color) {
	if (Array.isArray(color)) return [clampByte(color[0]), clampByte(color[1]), clampByte(color[2]), color.length > 3 ? clampByte(color[3]) : 255];
	if (typeof color === 'string' && color[0] === '#') {
		const h = color.slice(1);
		const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
		return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), n.length >= 8 ? parseInt(n.slice(6, 8), 16) : 255];
	}
	return [0, 0, 0, 255];
}

// ---- PRNG: FNV-1a(32) seed -> mulberry32 (authored mode; not Java-Random parity) ----
/** @param {string} str */
function fnv1a32(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
	return h >>> 0;
}
/** Deterministic PRNG seeded by a string. @param {string} seed */
export function rng(seed) {
	let a = fnv1a32(String(seed));
	const next = () => {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return { nextDouble: next, /** @param {number} n */ nextInt: (n) => Math.floor(next() * n) };
}

// ---- palettes (aligned with Minosoft asset-primitive-decomposition) ----
export const WHITE = [233, 236, 236];
/** @type {Record<string, number[]>} */
export const DYES = {
	white: [233, 236, 236], orange: [240, 118, 19], magenta: [196, 78, 189], light_blue: [59, 178, 218],
	yellow: [249, 195, 33], lime: [107, 199, 32], pink: [240, 148, 168], gray: [78, 78, 78],
	light_gray: [147, 147, 147], cyan: [22, 136, 156], purple: [130, 53, 180], blue: [57, 78, 167],
	brown: [98, 60, 34], green: [85, 119, 21], red: [154, 34, 30], black: [21, 22, 26],
};
/** @type {Record<string, number[]>} */
export const WOODS = {
	oak: [171, 137, 93], spruce: [101, 78, 54], birch: [195, 177, 125], jungle: [142, 107, 71],
	acacia: [162, 88, 44], dark_oak: [66, 48, 32], mangrove: [105, 52, 40], cherry: [222, 173, 172],
	bamboo: [210, 198, 118], crimson: [111, 43, 50], warped: [46, 104, 105],
};
/** Ore mineral speckle colors (keyed by the mineral, deepslate_/nether_ prefixes stripped). @type {Record<string, number[]>} */
export const ORES = {
	coal: [37, 37, 37], iron: [197, 160, 127], copper: [193, 106, 80], gold: [252, 204, 73],
	redstone: [214, 29, 10], lapis: [31, 74, 166], diamond: [92, 219, 213], emerald: [36, 204, 96],
	quartz: [235, 229, 222],
};
/** Leaf tints (biome-neutral, chosen to read distinctly in review). @type {Record<string, number[]>} */
export const LEAVES = {
	spruce: [53, 82, 56], birch: [110, 150, 60], jungle: [47, 111, 24], acacia: [86, 125, 32],
	dark_oak: [54, 92, 31], mangrove: [70, 124, 42], flowering_azalea: [86, 120, 54], azalea: [86, 120, 54],
	cherry: [226, 166, 205], oak: [60, 110, 40],
};
/** Core stone-family tones (looked up longest-match, so polished_/cut_/mossy_ variants
 *  inherit the root). Keyed by the distinctive part of the block name. @type {Record<string, number[]>} */
export const STONE_TONES = {
	stone: [128, 128, 128], smooth_stone: [159, 159, 159],
	cobblestone: [122, 122, 122], mossy_cobblestone: [104, 112, 92],
	granite: [149, 103, 85], diorite: [188, 188, 190], andesite: [136, 136, 138],
	deepslate: [80, 80, 86], cobbled_deepslate: [77, 77, 82], polished_deepslate: [72, 72, 77], chiseled_deepslate: [68, 68, 73],
	tuff: [108, 109, 102], calcite: [223, 224, 220], dripstone: [140, 110, 92],
	basalt: [73, 72, 78], smooth_basalt: [72, 71, 77],
	blackstone: [45, 40, 46], gilded_blackstone: [59, 46, 42],
	netherrack: [97, 38, 38], end_stone: [219, 222, 158], bedrock: [85, 85, 85],
	obsidian: [20, 18, 30], crying_obsidian: [32, 20, 54],
	sandstone: [219, 211, 160], red_sandstone: [168, 88, 34],
	prismarine: [99, 171, 158], dark_prismarine: [51, 91, 75],
	mud: [60, 54, 56], packed_mud: [142, 105, 74],
};
/** Granular-earth tones (dirt/sand/gravel/nylium…), looked up longest-match. @type {Record<string, number[]>} */
export const DIRT_TONES = {
	dirt: [134, 96, 67], coarse_dirt: [122, 86, 60], rooted_dirt: [144, 110, 87], dirt_path: [148, 119, 71], farmland: [102, 68, 40],
	podzol: [91, 66, 33], mycelium: [111, 101, 107], grass_block: [121, 169, 72], moss_block: [89, 109, 45],
	sand: [219, 207, 163], red_sand: [190, 102, 33], gravel: [131, 127, 126], clay: [161, 167, 181],
	soul_sand: [81, 62, 51], soul_soil: [76, 58, 47], crimson_nylium: [130, 31, 31], warped_nylium: [43, 114, 101],
};
/** Coral species tones (dead corals fall back to a bleached gray). @type {Record<string, number[]>} */
export const CORAL_TONES = { tube: [47, 84, 201], brain: [213, 92, 158], bubble: [165, 42, 178], fire: [168, 42, 45], horn: [219, 206, 74] };
/** Flower + plant tones. Greens default; named flowers get their bloom color. @type {Record<string, number[]>} */
export const PLANT_TONES = {
	dandelion: [247, 217, 55], poppy: [196, 42, 35], blue_orchid: [47, 148, 207], allium: [169, 101, 197],
	azure_bluet: [227, 231, 236], red_tulip: [196, 42, 35], orange_tulip: [220, 127, 40], white_tulip: [224, 231, 232], pink_tulip: [224, 158, 220],
	oxeye_daisy: [233, 238, 232], cornflower: [70, 106, 206], lily_of_the_valley: [236, 242, 234], wither_rose: [33, 38, 32],
	sunflower: [247, 196, 26], lilac: [178, 135, 196], rose_bush: [168, 40, 44], peony: [214, 171, 214], torchflower: [236, 120, 40],
	chorus_flower: [151, 116, 151], spore_blossom: [214, 110, 150], pink_petals: [233, 170, 205], pitcher_plant: [123, 90, 176],
	fern: [79, 120, 55], grass: [91, 139, 60], sugar_cane: [148, 193, 109], cactus: [85, 127, 44], bamboo: [124, 161, 72],
	crimson: [123, 40, 52], warped: [22, 120, 116], kelp: [68, 110, 60], vine: [63, 102, 42], lichen: [124, 148, 110],
	sea_pickle: [141, 146, 66], sapling: [74, 110, 46], seagrass: [62, 124, 44], azalea: [90, 122, 56], dripleaf: [96, 140, 55],
};
/** Copper oxidation-stage tones (waxed_ prefix keeps the stage). @type {Record<string, number[]>} */
export const COPPER_TONES = { copper: [193, 106, 80], exposed: [161, 125, 101], weathered: [108, 153, 126], oxidized: [82, 162, 141] };
// ---- item-icon palettes ----
/** Metal tones for ingots / nuggets / raw ore drops. @type {Record<string, number[]>} */
export const METAL_TONES = { iron: [216, 216, 216], gold: [247, 209, 73], copper: [193, 106, 80], netherite: [74, 66, 66] };
/** Gem / shard / crystal tones (looked up longest-match). @type {Record<string, number[]>} */
export const GEM_TONES = {
	diamond: [110, 224, 220], emerald: [43, 203, 96], lapis: [38, 97, 180], quartz: [235, 229, 222],
	amethyst: [153, 112, 206], prismarine: [124, 201, 177], nether_star: [230, 232, 214], echo: [22, 90, 94],
	flint: [62, 58, 58], clay_ball: [161, 167, 181],
};
/** Dust / powder tones. @type {Record<string, number[]>} */
export const DUST_TONES = {
	redstone: [190, 30, 20], glowstone_dust: [214, 178, 116], blaze_powder: [228, 140, 40],
	gunpowder: [80, 80, 84], bone_meal: [233, 233, 222], sugar: [236, 240, 244],
};
/** Seed tones. @type {Record<string, number[]>} */
export const SEED_TONES = {
	wheat_seeds: [122, 150, 70], melon_seeds: [224, 222, 196], pumpkin_seeds: [226, 214, 158],
	beetroot_seeds: [150, 120, 70], torchflower_seeds: [110, 90, 60], pitcher_pod: [86, 120, 60],
};
/** Rod / stick tones. @type {Record<string, number[]>} */
export const ROD_TONES = { stick: [140, 100, 58], blaze_rod: [228, 170, 40], breeze_rod: [150, 214, 220], end_rod: [224, 220, 205] };
/** Tool head material tones (wooden/stone/iron/golden/diamond/netherite tiers). @type {Record<string, number[]>} */
export const TOOL_TONES = { wooden: [160, 127, 72], stone: [130, 130, 130], iron: [216, 216, 216], golden: [247, 209, 73], diamond: [110, 224, 220], netherite: [74, 66, 66] };
/** Particle-effect tones: `[core, edge]` for the radial stamp (frame suffix stripped). @type {Record<string, number[][]>} */
export const PARTICLE_TONES = {
	explosion: [[255, 224, 140], [120, 90, 70]], sonic_boom: [[150, 210, 240], [40, 70, 120]],
	big_smoke: [[150, 150, 155], [70, 70, 75]], gust: [[220, 224, 230], [150, 155, 165]],
	soul: [[150, 240, 240], [40, 120, 140]], sculk_soul: [[90, 220, 210], [20, 90, 110]], sculk_charge: [[90, 220, 210], [20, 90, 110]], sculk_charge_pop: [[90, 220, 210], [20, 90, 110]],
	spell: [[236, 236, 240], [150, 150, 170]], effect: [[236, 236, 240], [150, 150, 170]],
	spark: [[255, 220, 120], [220, 120, 40]], glitter: [[255, 250, 220], [200, 200, 150]], glint: [[255, 250, 220], [200, 200, 150]],
	glow: [[210, 240, 170], [120, 180, 90]], generic: [[220, 220, 224], [120, 120, 126]], sweep: [[240, 240, 244], [180, 180, 190]],
	splash: [[190, 214, 240], [80, 120, 180]], bubble_pop: [[220, 235, 245], [120, 160, 200]], bubble: [[220, 235, 245], [120, 160, 200]],
	trial_spawner_detection: [[240, 170, 90], [150, 60, 120]], cherry: [[240, 180, 210], [200, 120, 160]],
	flash: [[255, 255, 250], [220, 220, 210]], vibration: [[120, 220, 210], [40, 140, 150]],
};

// ---- pixel buffer ----
/** @param {number} w @param {number} h @returns {PixelBuffer} */
export function createBuffer(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
/** @param {PixelBuffer} buf @param {number} x @param {number} y @param {number[]} rgba */
function setPx(buf, x, y, rgba) {
	if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
	const i = (y * buf.width + x) * 4;
	buf.data[i] = rgba[0]; buf.data[i + 1] = rgba[1]; buf.data[i + 2] = rgba[2]; buf.data[i + 3] = rgba.length > 3 ? rgba[3] : 255;
}
/** @param {PixelBuffer} buf @param {number} x @param {number} y */
function getPx(buf, x, y) { const i = (y * buf.width + x) * 4; return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]]; }

// ---- primitive ops: (buf, params, rng) -> void. Composable; applied in order. ----
/** @type {Record<string, (buf: PixelBuffer, p?: any, r?: any) => void>} */
export const OPS = {
	fill(buf, p = {}) { const c = toRGBA(p.color ?? [128, 128, 128]); for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) setPx(buf, x, y, c); },
	noise(buf, p = {}, r) {
		const d = p.delta ?? 8; const base = p.color ? toRGBA(p.color) : null;
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) {
			const src = base || getPx(buf, x, y);
			if (!base && src[3] === 0) continue;
			setPx(buf, x, y, [...shade(src, r.nextInt(2 * d + 1) - d), src[3] ?? 255]);
		}
	},
	speckle(buf, p = {}, r) { const c = toRGBA(p.color ?? [255, 255, 255]); const prob = p.prob ?? 0.06; for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) if (r.nextDouble() < prob) setPx(buf, x, y, c); },
	rect(buf, p = {}) {
		const c = toRGBA(p.color ?? [0, 0, 0]); const x0 = p.x ?? 0, y0 = p.y ?? 0, w = p.w ?? buf.width, h = p.h ?? buf.height;
		for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (p.outline && x > x0 && x < x0 + w - 1 && y > y0 && y < y0 + h - 1) continue; setPx(buf, x, y, c); }
	},
	band(buf, p = {}) { const c = toRGBA(p.color ?? [0, 0, 0]); const y0 = p.y ?? 0, h = p.h ?? 1; for (let y = y0; y < y0 + h; y++) for (let x = 0; x < buf.width; x++) setPx(buf, x, y, c); },
	border(buf, p = {}) { const c = toRGBA(p.color ?? [0, 0, 0]); const t = p.thickness ?? 1; for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) if (x < t || y < t || x >= buf.width - t || y >= buf.height - t) setPx(buf, x, y, c); },
	checker(buf, p = {}) { const a = toRGBA(p.colorA ?? [200, 200, 200]); const b = toRGBA(p.colorB ?? [120, 120, 120]); const s = p.size ?? 4; for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) setPx(buf, x, y, (Math.floor(x / s) + Math.floor(y / s)) % 2 === 0 ? a : b); },
	stripes(buf, p = {}, r) {
		const base = toRGBA(p.color ?? [120, 90, 60]); const variance = p.variance ?? 0.35;
		for (let x = 0; x < buf.width; x++) {
			const tone = mix(base, [0, 0, 0], r.nextDouble() * variance);
			for (let y = 0; y < buf.height; y++) {
				const rr = r.nextDouble();
				const px = rr < 0.08 ? mix(tone, WHITE, 0.2) : rr < 0.16 ? mix(tone, [0, 0, 0], 0.25) : tone;
				setPx(buf, x, y, [...px, 255]);
			}
		}
	},
	gradient(buf, p = {}) { const from = toRGBA(p.from ?? [255, 255, 255]); const to = toRGBA(p.to ?? [0, 0, 0]); for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) { const t = p.axis === 'x' ? x / (buf.width - 1) : y / (buf.height - 1); setPx(buf, x, y, [...mix(from, to, t), 255]); } },
	bricks(buf, p = {}) {
		const c = toRGBA(p.color ?? [150, 80, 70]); const mortar = toRGBA(p.mortar ?? [180, 180, 180]);
		const bh = p.brickH ?? 4, bw = p.brickW ?? 8, off = p.offset ?? 4;
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) { const shift = (Math.floor(y / bh) % 2) * off; setPx(buf, x, y, y % bh === 0 || (x + shift) % bw === 0 ? mortar : c); }
	},
	circle(buf, p = {}) { const c = toRGBA(p.color ?? [255, 255, 255]); const cx = p.cx ?? buf.width / 2 - 0.5, cy = p.cy ?? buf.height / 2 - 0.5, rad = p.r ?? buf.width / 3; for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) setPx(buf, x, y, c); },
	alpha_interior(buf, p = {}) { const c = toRGBA(p.color ?? [255, 255, 255]); const a = p.alpha ?? 120; const m = p.margin ?? 2; for (let y = m; y < buf.height - m; y++) for (let x = m; x < buf.width - m; x++) setPx(buf, x, y, [c[0], c[1], c[2], a]); },
	// Consistent "lit from top-left" bevel: lighten the top/left edge, darken the
	// bottom/right edge. The house style cue that reads as depth on a flat tile.
	bevel(buf, p = {}) {
		const light = p.light ?? 20, dark = p.dark ?? 30, w = buf.width, h = buf.height;
		const add = (x, y, d) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const px = getPx(buf, x, y); if (px[3] === 0) return; setPx(buf, x, y, [...shade(px, d), px[3]]); };
		for (let x = 0; x < w; x++) { add(x, 0, light); add(x, h - 1, -dark); }
		for (let y = 0; y < h; y++) { add(0, y, Math.round(light * 0.6)); add(w - 1, y, -dark); }
	},
};
/** Stable per-name hue (0..359) so distinct blocks read distinctly. */
const hueFromName = (name) => fnv1a32(String(name || 'x')) % 360;

/** Accurate base tones for common blocks — correctness over the per-name hue. */
const BLOCK_TONES = {
	stone: [125, 125, 125], andesite: [136, 136, 138], diorite: [188, 188, 190], granite: [149, 103, 85],
	cobblestone: [122, 122, 122], mossy_cobblestone: [110, 118, 96], basalt: [73, 72, 78], smooth_basalt: [72, 71, 77],
	deepslate: [77, 77, 82], tuff: [108, 109, 102], calcite: [223, 224, 220], dripstone_block: [122, 96, 82],
	dirt: [134, 96, 67], coarse_dirt: [122, 86, 60], rooted_dirt: [144, 110, 87], gravel: [131, 127, 126],
	sand: [219, 207, 163], red_sand: [190, 102, 33], clay: [161, 167, 181], sandstone: [219, 211, 160], red_sandstone: [186, 100, 38],
	netherrack: [97, 38, 38], soul_sand: [81, 62, 51], soul_soil: [76, 58, 47], obsidian: [20, 18, 30],
	bedrock: [85, 85, 85], end_stone: [219, 222, 158], blackstone: [42, 37, 43], gilded_blackstone: [59, 46, 42],
	bone_block: [229, 225, 203], quartz_block: [235, 229, 222], amethyst_block: [133, 97, 191], moss_block: [89, 109, 45],
	mud: [60, 54, 56], packed_mud: [142, 105, 74], ancient_debris: [94, 60, 54], magma: [142, 74, 38],
	glowstone: [171, 131, 84], sea_lantern: [176, 192, 178], prismarine: [99, 171, 158], dark_prismarine: [51, 91, 75],
	snow_block: [240, 247, 247], ice: [145, 183, 254], packed_ice: [141, 180, 249], blue_ice: [116, 168, 252],
	terracotta: [152, 94, 67], netherite_block: [66, 62, 64], iron_block: [220, 220, 220], gold_block: [246, 208, 62],
	diamond_block: [98, 219, 214], emerald_block: [43, 203, 96], redstone_block: [175, 24, 5], lapis_block: [30, 67, 140],
	coal_block: [16, 15, 15], copper_block: [193, 106, 80], honeycomb_block: [229, 148, 32], slime_block: [112, 192, 90],
	honey_block: [251, 179, 62], hay_block: [166, 138, 33], sponge: [196, 192, 75], melon: [111, 145, 32], pumpkin: [198, 118, 24],
	purpur_block: [168, 101, 168], purpur_pillar: [171, 106, 171], nether_wart_block: [114, 17, 19], warped_wart_block: [22, 120, 116],
	shroomlight: [241, 148, 73], crying_obsidian: [32, 20, 54], lodestone: [122, 124, 130], respawn_anchor: [52, 26, 84],
	dried_kelp_block: [51, 58, 42], sculk: [13, 33, 40], sculk_catalyst: [24, 44, 50], mangrove_roots: [93, 72, 49],
	ochre_froglight: [251, 241, 205], verdant_froglight: [227, 239, 216], pearlescent_froglight: [246, 224, 238], target: [225, 186, 161],
	brown_mushroom_block: [149, 111, 80], red_mushroom_block: [201, 63, 60], mushroom_stem: [203, 196, 186], smooth_stone: [159, 159, 159],
	nether_wart: [151, 26, 30], warped_nylium: [43, 114, 101], crimson_nylium: [130, 31, 31], grass_block: [96, 142, 58],
};
const DYE_SUFFIXES = ['_concrete_powder', '_concrete', '_wool', '_carpet', '_terracotta', '_stained_glass', '_shulker_box'];
/** Resolve a block's base tone: exact table, then dye-suffixed family, else null. */
function toneFor(name) {
	if (!name) return null;
	if (BLOCK_TONES[name]) return BLOCK_TONES[name];
	for (const suf of DYE_SUFFIXES) {
		if (name.endsWith(suf)) {
			const dye = DYES[name.slice(0, -suf.length)];
			if (dye) return suf === '_terracotta' ? mix(dye, [152, 94, 67], 0.5) : dye;
		}
	}
	return null;
}
export function listOps() { return Object.keys(OPS); }

// ---- name / classification helpers ----
/** @param {any} target */
function baseName(target) { if (!target) return ''; const s = String(target).split('/').pop() || ''; return s.replace(/\.png$/, ''); }
/** @param {Record<string, number[]>} map @param {string} name @param {number[]} fallback */
function pick(map, name, fallback) {
	// Longest matching key wins, so `dark_oak` beats `oak` and `light_gray` beats `gray`
	// (a plain first-match returns the shorter substring and mis-colors the block).
	let best = fallback, bestLen = 0;
	if (name) for (const key of Object.keys(map)) if (name.includes(key) && key.length > bestLen) { best = map[key]; bestLen = key.length; }
	return best;
}

// ---- family recipes (v1 subset; unknown families fall back to generic_block) ----
/** @type {Record<string, (buf: PixelBuffer, ctx: any, r: any) => void>} */
export const FAMILIES = {
	generic_block(buf, ctx, r) {
		// Per-name hue at a low, stone-like saturation + a value jitter so andesite,
		// basalt and cobblestone are distinct rather than identical gray noise.
		const base = ctx.params && ctx.params.color ? toRGBA(ctx.params.color)
			: (toneFor(ctx.name) || hsv(hueFromName(ctx.name), 0.13, 0.42 + (fnv1a32(String(ctx.name || 'x')) % 22) / 100));
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 12 }, r);
		OPS.speckle(buf, { color: shade(base, -34), prob: 0.05 }, r);
		OPS.speckle(buf, { color: shade(base, 26), prob: 0.03 }, r);
		OPS.bevel(buf, { light: 22, dark: 34 });
	},
	generic_item(buf, ctx, r) {
		const base = ctx.params && ctx.params.color ? toRGBA(ctx.params.color) : hsv(hueFromName(ctx.name), 0.32, 0.62);
		OPS.rect(buf, { x: 3, y: 3, w: 10, h: 10, color: base });
		OPS.noise(buf, { delta: 8 }, r);
		OPS.rect(buf, { x: 3, y: 3, w: 10, h: 10, color: shade(base, -44), outline: true });
	},
	// Log/stem sides: long, irregular bark ridges with broken crevices and an
	// occasional knot. Avoid a full-width band: it repeats as an artificial ring
	// around every trunk when the 16px tile is stacked in-world.
	wood(buf, ctx, r) {
		const bark = pick(WOODS, baseName(ctx.name), WOODS.oak), w = buf.width, h = buf.height;
		OPS.fill(buf, { color: bark });
		OPS.noise(buf, { delta: 7 }, r);
		for (let x = 0; x < w; x++) {
			const ridge = x % 4;
			const d = ridge === 0 ? -28 : ridge === 1 ? 14 : ridge === 3 ? -10 : 4;
			for (let y = 0; y < h; y++) {
				const p = getPx(buf, x, y);
				setPx(buf, x, y, [...shade(p, d + r.nextInt(7) - 3), 255]);
			}
		}
		// Broken vertical fissures meander by one pixel instead of forming a grid.
		for (let x0 = 0; x0 < w; x0 += 4) {
			let x = x0 + r.nextInt(2);
			for (let y = 0; y < h; y++) {
				if (y && y % 4 === 0) x += r.nextInt(3) - 1;
				if (r.nextDouble() > 0.18) setPx(buf, (x + w) % w, y, [...shade(bark, -38 + r.nextInt(9)), 255]);
			}
		}
		// Small elliptical knot, dark-cored and bark-colored rather than a hard dot.
		const kx = 3 + r.nextInt(Math.max(1, w - 6)), ky = 3 + r.nextInt(Math.max(1, h - 6));
		for (let y = ky - 1; y <= ky + 1; y++) for (let x = kx - 2; x <= kx + 2; x++) {
			const edge = Math.abs(x - kx) === 2 || Math.abs(y - ky) === 1;
			setPx(buf, x, y, [...shade(bark, edge ? -24 : -42), 255]);
		}
		setPx(buf, kx, ky, [...shade(bark, -58), 255]);
		OPS.bevel(buf, { light: 8, dark: 12 });
	},
	banner(buf, ctx, r) { const dye = pick(DYES, baseName(ctx.name).replace(/_banner$/, ''), DYES.white); OPS.fill(buf, { color: dye }); OPS.rect(buf, { x: 7, y: 5, w: 2, h: 6, color: mix(dye, WHITE, 0.7) }); },
	glass_pane(buf, ctx, r) { const tint = pick(DYES, baseName(ctx.name).replace(/_stained.*$/, ''), WHITE); OPS.alpha_interior(buf, { color: tint, alpha: 110, margin: 2 }); OPS.border(buf, { color: [...tint, 235], thickness: 1 }); },
	// Solid stained-glass block: translucent tint + a bright frame + a corner glint.
	// tinted_glass is a near-opaque smoky pane (it blocks light in-game).
	glass(buf, ctx, r) {
		const name = baseName(ctx.name);
		const tinted = name === 'tinted_glass';
		const tint = tinted ? [60, 56, 66] : name === 'glass' ? WHITE : pick(DYES, name.replace(/_stained_glass$/, ''), WHITE);
		OPS.fill(buf, { color: [...tint, tinted ? 200 : 92] });
		OPS.border(buf, { color: [...tint, tinted ? 240 : 220], thickness: 1 });
		OPS.rect(buf, { x: 3, y: 2, w: 1, h: 5, color: [255, 255, 255, tinted ? 90 : 130] });
	},
	// Ore: stone (or deepslate) matrix with a scatter of 2x2 mineral nuggets.
	ore(buf, ctx, r) {
		const name = baseName(ctx.name);
		const stone = name.startsWith('deepslate_') ? [77, 77, 82] : [128, 128, 128];
		const mineral = pick(ORES, name.replace(/^deepslate_/, '').replace(/^nether_/, '').replace(/_ore$/, ''), [200, 200, 200]);
		OPS.fill(buf, { color: stone });
		OPS.noise(buf, { delta: 14 }, r);
		for (let k = 0; k < 6; k++) {
			const x = r.nextInt(14), y = r.nextInt(14), c = shade(mineral, r.nextInt(21) - 10);
			setPx(buf, x, y, [...c, 255]); setPx(buf, x + 1, y, [...shade(c, -16), 255]);
			setPx(buf, x, y + 1, [...shade(c, -16), 255]); setPx(buf, x + 1, y + 1, [...c, 255]);
		}
		OPS.bevel(buf, { light: 20, dark: 30 });
	},
	// Planks: horizontal boards (seams at rows 0/8) with staggered end joints + grain.
	planks(buf, ctx, r) {
		const wood = pick(WOODS, baseName(ctx.name).replace(/_planks$/, ''), WOODS.oak);
		const seam = shade(wood, -46);
		OPS.fill(buf, { color: wood });
		OPS.noise(buf, { delta: 9 }, r);
		OPS.band(buf, { y: 0, h: 1, color: seam }); OPS.band(buf, { y: 8, h: 1, color: seam });
		OPS.rect(buf, { x: 6, y: 1, w: 1, h: 7, color: seam }); OPS.rect(buf, { x: 11, y: 9, w: 1, h: 7, color: seam });
		OPS.bevel(buf, { light: 14, dark: 22 });
	},
	// Leaves: layered foliage. A base green is broken up by lighter leaf-tip clumps and
	// darker shadow pockets (round stamps) so it reads as overlapping clusters rather than
	// flat noise; transparent gaps are cleared as small pockets, not single-pixel static.
	// cherry blooms with pale-pink/white blossoms over sparse twigs; flowering_azalea gets
	// magenta flower clusters; spruce/dark_oak stay dense with fewer gaps.
	leaves(buf, ctx, r) {
		const w = buf.width, h = buf.height, s = w / 16;
		const name = baseName(ctx.name).replace(/_leaves$/, '');
		const green = pick(LEAVES, name, LEAVES.oak);
		const cherry = name === 'cherry', flowering = name === 'flowering_azalea';
		const dense = /spruce|dark_oak/.test(name);
		if (name === 'spruce') {
			// Spruce reads as layered needle sprays, not broad round leaf clumps.
			OPS.fill(buf, { color: green });
			OPS.noise(buf, { delta: 9 }, r);
			const branch = shade(green, -28), needle = shade(green, 18), tip = shade(green, 34);
			for (let k = 0; k < Math.round(13 * s * s); k++) {
				const x0 = r.nextInt(w), y0 = r.nextInt(h), dir = r.nextDouble() < 0.5 ? -1 : 1, len = 3 + r.nextInt(4);
				for (let i = 0; i < len; i++) {
					const x = (x0 + dir * i + w) % w, y = (y0 + Math.floor(i / 3)) % h;
					setPx(buf, x, y, [...(i === 0 ? branch : i === len - 1 ? tip : needle), 255]);
					if (i > 0 && i < len - 1 && r.nextDouble() < 0.55) setPx(buf, x, (y - 1 + h) % h, [...shade(needle, -8), 255]);
				}
			}
			OPS.speckle(buf, { color: shade(green, -36), prob: 0.05 }, r);
			for (let k = 0; k < Math.round(4 * s * s); k++) setPx(buf, r.nextInt(w), r.nextInt(h), [0, 0, 0, 0]);
			return;
		}
		// Stamp a soft round clump of `col`, filling covered pixels with probability `prob`.
		const clump = (cx, cy, rad, col, prob) => {
			for (let y = Math.ceil(cy - rad); y <= cy + rad; y++) for (let x = Math.ceil(cx - rad); x <= cx + rad; x++) {
				if (x < 0 || y < 0 || x >= w || y >= h) continue;
				if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad && r.nextDouble() < prob) { const p = getPx(buf, x, y); if (p[3] !== 0) setPx(buf, x, y, [...col, 255]); }
			}
		};
		OPS.fill(buf, { color: green });
		OPS.noise(buf, { delta: cherry ? 14 : 17 }, r);
		const light = shade(green, cherry ? 20 : 26), dark = shade(green, dense ? -30 : -36);
		const nClump = Math.round(7 * s * s);
		for (let k = 0; k < nClump; k++) clump(r.nextInt(w), r.nextInt(h), (2 + r.nextInt(2)) * s, dark, 0.7);   // shadow pockets first
		for (let k = 0; k < nClump; k++) clump(r.nextInt(w), r.nextInt(h), (2 + r.nextInt(2)) * s, light, 0.7);  // lit leaf tips on top
		OPS.speckle(buf, { color: shade(green, -48), prob: 0.06 }, r);   // fine vein/shadow flecks
		OPS.speckle(buf, { color: shade(green, 32), prob: 0.05 }, r);    // dew highlights
		if (cherry) {
			OPS.speckle(buf, { color: [246, 228, 240], prob: 0.11 }, r); // white blossoms
			OPS.speckle(buf, { color: [235, 186, 218], prob: 0.11 }, r); // pale-pink blossoms
			for (let k = 0; k < Math.round(4 * s); k++) setPx(buf, r.nextInt(w), r.nextInt(h), [118, 80, 72, 255]); // twig specks
		} else if (flowering) {
			for (let k = 0; k < Math.round(7 * s * s); k++) clump(r.nextInt(w), r.nextInt(h), (1 + r.nextInt(2)) * s, [214, 108, 170], 0.85); // magenta flowers
			OPS.speckle(buf, { color: [236, 152, 196], prob: 0.05 }, r);
		}
		// Transparent gap pockets between clumps (dense canopies keep fewer, cherry almost none).
		const gaps = Math.round((dense ? 3 : cherry ? 1 : 5) * s * s);
		for (let k = 0; k < gaps; k++) {
			const cx = r.nextInt(w), cy = r.nextInt(h); setPx(buf, cx, cy, [0, 0, 0, 0]);
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (r.nextDouble() < 0.5) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < w && y < h) setPx(buf, x, y, [0, 0, 0, 0]); }
		}
	},
	// Bricks: running-bond courses with mortar + grain. Stone-family bricks take the
	// matching stone tone (deepslate bricks dark, prismarine teal); clay bricks red.
	bricks(buf, ctx, r) {
		const name = baseName(ctx.name);
		const stony = /stone|deepslate|tuff|blackstone|end_stone|mud|prismarine/.test(name);
		const c = /nether/.test(name) ? [44, 22, 26] : /mud/.test(name) ? [142, 105, 74] : pick(STONE_TONES, name, stony ? [122, 122, 122] : [150, 84, 74]);
		const mortar = /nether/.test(name) ? [64, 40, 44] : shade(c, 30);
		OPS.bricks(buf, { color: c, mortar, brickH: 4, brickW: 8, offset: 4 });
		OPS.noise(buf, { delta: 8 }, r);
		OPS.bevel(buf, { light: 12, dark: 18 });
	},
	// Stone: mottled rock. cobble(d) -> 4px cobbles with mortar seams; polished_/
	// smooth_/chiseled_ -> soft bevel (except natural smooth_basalt); otherwise
	// natural speckled stone. Tone per type from STONE_TONES (longest-match).
	stone(buf, ctx, r) {
		const name = baseName(ctx.name);
		const base = pick(STONE_TONES, name, [128, 128, 128]);
		if (/cobble/.test(name)) {
			// Staggered, variably sized cobbles replace the rigid 4x4 checkerboard.
			OPS.fill(buf, { color: shade(base, -42) });
			let cy = -1, row = 0;
			while (cy < buf.height) {
				const ch = 4 + r.nextInt(2), y0 = cy + 1, y1 = Math.min(buf.height - 1, cy + ch - 1);
				let cx = row % 2 ? -2 : -1;
				while (cx < buf.width) {
					const cw = 4 + r.nextInt(3), x0 = cx + 1, x1 = cx + cw - 1;
					const cell = shade(base, r.nextInt(31) - 15);
					for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
						if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) continue;
						const corner = (x === x0 || x === x1) && (y === y0 || y === y1);
						if (corner && r.nextDouble() < 0.55) continue;
						const edge = x === x0 || y === y0 ? 9 : x === x1 || y === y1 ? -10 : 0;
						setPx(buf, x, y, [...shade(cell, edge + r.nextInt(7) - 3), 255]);
					}
					cx += cw;
				}
				cy += ch; row++;
			}
			return;
		}
		if (/obsidian/.test(name)) {
			const stone = /crying/.test(name) ? [34, 22, 58] : [22, 19, 35];
			OPS.fill(buf, { color: stone });
			OPS.noise(buf, { delta: 5 }, r);
			for (let k = 0; k < 4; k++) {
				let x = r.nextInt(buf.width), y = r.nextInt(buf.height), len = 3 + r.nextInt(5);
				for (let i = 0; i < len; i++) {
					const glow = /crying/.test(name) ? [104, 49, 156] : [52, 43, 82];
					setPx(buf, x, y, [...shade(glow, r.nextInt(15) - 7), 255]);
					x = (x + 1) % buf.width; if (r.nextDouble() < 0.45) y = (y + (r.nextDouble() < 0.5 ? -1 : 1) + buf.height) % buf.height;
				}
			}
			OPS.speckle(buf, { color: [70, 54, 104], prob: 0.025 }, r);
			return;
		}
		if (/blackstone/.test(name)) {
			OPS.fill(buf, { color: base });
			OPS.noise(buf, { delta: 8 }, r);
			for (let k = 0; k < 9; k++) {
				const x = r.nextInt(buf.width - 1), y = r.nextInt(buf.height), c = shade(base, r.nextInt(35) - 17);
				setPx(buf, x, y, [...c, 255]); setPx(buf, x + 1, y, [...shade(c, r.nextInt(9) - 4), 255]);
			}
			for (let k = 0; k < 2; k++) { const y = 3 + r.nextInt(10), x = r.nextInt(8); for (let i = 0; i < 4 + r.nextInt(5); i++) setPx(buf, x + i, y + (i > 3 && r.nextDouble() < 0.35 ? 1 : 0), [...shade(base, -25), 255]); }
			return;
		}
		const polished = /^(polished_|smooth_|chiseled_)/.test(name) && name !== 'smooth_basalt';
		OPS.fill(buf, { color: base });
		if (polished) {
			OPS.noise(buf, { delta: 6 }, r);
			OPS.speckle(buf, { color: shade(base, -16), prob: 0.03 }, r);
			OPS.bevel(buf, { light: 14, dark: 18 });
			if (/^chiseled_/.test(name)) OPS.border(buf, { color: shade(base, -30), thickness: 1 });
		} else {
			OPS.noise(buf, { delta: 12 }, r);
			OPS.speckle(buf, { color: shade(base, -30), prob: 0.06 }, r);
			OPS.speckle(buf, { color: shade(base, 22), prob: 0.05 }, r);
			// Two-pixel patches create mineral body at game scale without noisy static.
			for (let k = 0; k < 5; k++) {
				const x = r.nextInt(Math.max(1, buf.width - 1)), y = r.nextInt(Math.max(1, buf.height - 1)), c = shade(base, r.nextInt(29) - 14);
				setPx(buf, x, y, [...c, 255]); setPx(buf, x + 1, y, [...shade(c, 4), 255]);
				if (r.nextDouble() < 0.6) setPx(buf, x, y + 1, [...shade(c, -4), 255]);
			}
		}
	},
	// Spawn egg (item): a rounded egg body in a per-mob hue with darker spots.
	spawn_egg(buf, ctx, r) {
		const base = hsv(hueFromName(baseName(ctx.name).replace(/_spawn_egg$/, '')), 0.5, 0.72);
		const spot = shade(base, -66);
		OPS.circle(buf, { cx: 7.5, cy: 8, r: 5, color: base });
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) { const p = getPx(buf, x, y); if (p[3] !== 0 && r.nextDouble() < 0.2) setPx(buf, x, y, [...spot, 255]); }
	},
	// Granular earth: speckled ground; grass/mycelium/podzol/nylium get a colored top
	// fringe so grass_block_side / *_nylium read as topped soil. sand/gravel less noisy.
	dirt(buf, ctx, r) {
		const name = baseName(ctx.name);
		const base = pick(DIRT_TONES, name, [134, 96, 67]);
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: /sand|gravel|clay/.test(name) ? 8 : 11 }, r);
		// Broad crumb clusters establish soil body; fine flecks sit on top as grit.
		for (let k = 0; k < 10; k++) {
			const x = r.nextInt(buf.width - 1), y = r.nextInt(buf.height - 1), c = shade(base, r.nextInt(37) - 18);
			setPx(buf, x, y, [...c, 255]); setPx(buf, x + 1, y, [...shade(c, 3), 255]);
			if (r.nextDouble() < 0.65) setPx(buf, x, y + 1, [...shade(c, -3), 255]);
		}
		OPS.speckle(buf, { color: shade(base, -28), prob: 0.06 }, r);
		OPS.speckle(buf, { color: shade(base, 22), prob: 0.045 }, r);
		if (/podzol/.test(name) && !/_side$/.test(name)) {
			// Sparse needle litter makes the taiga floor identifiable without turning it yellow.
			for (let k = 0; k < 10; k++) { const x = r.nextInt(buf.width), y = r.nextInt(buf.height), c = k % 3 ? [122, 86, 38] : [67, 48, 28]; setPx(buf, x, y, [...c, 255]); if (r.nextDouble() < 0.65) setPx(buf, Math.min(buf.width - 1, x + 1), y, [...shade(c, 8), 255]); }
		}
		if (/grass_block_(?:side|snow)|mycelium_side|podzol_side|nylium_side|moss.*_side/.test(name)) {
			const top = /snow/.test(name) ? [235, 242, 245] : /grass_block|moss/.test(name) ? [95, 142, 55]
				: /podzol/.test(name) ? [122, 90, 40] : /mycelium/.test(name) ? [126, 110, 130]
					: /crimson/.test(name) ? [140, 31, 31] : /warped/.test(name) ? [43, 130, 116] : base;
			for (let y = 0; y < 4; y++) for (let x = 0; x < buf.width; x++) if (r.nextDouble() < (y < 2 ? 0.92 : 0.4)) setPx(buf, x, y, [...shade(top, r.nextInt(21) - 10), 255]);
		}
	},
	// Grass top: mottled green blades (grass_block_top, tinted grays in vanilla).
	grass(buf, ctx, r) {
		const base = [95, 142, 55];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 16 }, r);
		OPS.speckle(buf, { color: shade(base, -26), prob: 0.10 }, r);
		OPS.speckle(buf, { color: shade(base, 22), prob: 0.10 }, r);
	},
	// Log/stem top: concentric growth rings in the species bark tone.
	log_top(buf, ctx, r) {
		const wood = pick(WOODS, baseName(ctx.name).replace(/^stripped_/, '').replace(/_(?:log|stem|wood|hyphae)_top$/, ''), WOODS.oak);
		OPS.fill(buf, { color: wood });
		OPS.noise(buf, { delta: 8 }, r);
		const cx = 7.5, cy = 7.5;
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) {
			const ring = Math.sin(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) * 1.6);
			const d = ring > 0.4 ? -22 : ring < -0.4 ? 14 : 0;
			if (d) setPx(buf, x, y, [...shade(wood, d), 255]);
		}
		OPS.bevel(buf, { light: 10, dark: 14 });
	},
	// Coral: solid knobbly block, or branches on transparent for coral/fan. Dead = gray.
	coral(buf, ctx, r) {
		const name = baseName(ctx.name);
		const species = ['tube', 'brain', 'bubble', 'fire', 'horn'].find((s) => name.includes(s)) || 'tube';
		const base = /dead_/.test(name) ? [130, 124, 120] : CORAL_TONES[species];
		if (/_block$/.test(name)) {
			OPS.fill(buf, { color: base });
			OPS.noise(buf, { delta: 16 }, r);
			OPS.speckle(buf, { color: shade(base, -26), prob: 0.10 }, r);
			OPS.speckle(buf, { color: shade(base, 22), prob: 0.08 }, r);
			OPS.bevel(buf, { light: 16, dark: 24 });
		} else {
			for (let k = 0; k < 5; k++) {
				const x0 = 3 + k * 2 + r.nextInt(2);
				for (let y = 15; y > 3 + r.nextInt(5); y--) {
					const x = x0 + Math.round(Math.sin((15 - y) / 3) * 1.5);
					setPx(buf, x, y, [...shade(base, r.nextInt(21) - 10), 255]); setPx(buf, x + 1, y, [...shade(base, -14), 255]);
				}
			}
		}
	},
	// Mushroom blocks: red cap with white spots, brown cap, or pale porous stem.
	mushroom(buf, ctx, r) {
		const name = baseName(ctx.name);
		if (/stem/.test(name)) { OPS.fill(buf, { color: [203, 196, 186] }); OPS.noise(buf, { delta: 8 }, r); OPS.speckle(buf, { color: [176, 168, 158], prob: 0.06 }, r); OPS.bevel(buf, { light: 10, dark: 14 }); return; }
		const red = /red/.test(name);
		const base = red ? [201, 63, 60] : [149, 111, 80];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 10 }, r);
		if (red) for (let k = 0; k < 5; k++) { const x = 2 + r.nextInt(11), y = 2 + r.nextInt(11); for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) setPx(buf, x + xx, y + yy, [214, 209, 196, 255]); }
		OPS.bevel(buf, { light: 12, dark: 16 });
	},
	// Crop: rows of vertical stalks on transparent (wheat gold, beetroot red-green, …).
	crop(buf, ctx, r) {
		const name = baseName(ctx.name);
		const tone = /wheat/.test(name) ? [190, 175, 90] : /beetroot/.test(name) ? [110, 140, 60] : /nether_wart/.test(name) ? [151, 26, 30] : [95, 140, 55];
		for (let col = 2; col < buf.width; col += 4) for (let y = 4; y < buf.height; y++) {
			if (y % 2 === 0) continue;
			setPx(buf, col, y, [...shade(tone, r.nextInt(17) - 8), 255]); setPx(buf, col + 1, y, [...shade(tone, -12), 255]);
		}
	},
	// Cross-shaped plant / flower on transparent: green blades, plus a colored bloom.
	plant(buf, ctx, r) {
		const name = baseName(ctx.name);
		if (/^(?:large_)?fern(?:_(?:top|bottom))?$/.test(name)) {
			const top = /_top$/.test(name), tall = /large_/.test(name);
			const stemColor = [91, 118, 52], needleColor = [72, 122, 55];
			for (let y = top ? 1 : 0; y < 16; y++) {
				const width = top ? Math.min(6, Math.floor(y / 2)) : tall ? 6 : Math.min(6, Math.floor((15 - y) / 2));
				setPx(buf, 8, y, [...stemColor, 255]);
				if (y % 2) continue;
				for (let dx = 1; dx <= width; dx++) for (const sign of [-1, 1]) {
					setPx(buf, 8 + sign * dx, y - Math.floor(dx / 3), [...shade(needleColor, r.nextInt(19) - 9), 255]);
				}
			}
			return;
		}
		const isFlower = /flower|dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily|_rose|rose_|lilac|peony|sunflower|torchflower|chorus|petal|blossom|wither|pitcher/.test(name);
		const tone = pick(PLANT_TONES, name, [86, 124, 54]);
		const stem = isFlower ? [70, 110, 50] : tone;
		for (const [bx, by, tx, ty] of [[4, 15, 4, 7], [7, 15, 8, 4], [10, 15, 9, 8], [6, 15, 6, 9]]) {
			let x = bx; const dx = Math.sign(tx - bx);
			for (let y = by; y >= ty; y--) { setPx(buf, x, y, [...shade(stem, r.nextInt(17) - 8), 255]); if ((by - y) % 3 === 2) x += dx; }
		}
		if (isFlower) {
			for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) if (Math.abs(xx) + Math.abs(yy) <= 3) setPx(buf, 8 + xx, 4 + yy, [...shade(tone, r.nextInt(17) - 8), 255]);
			setPx(buf, 8, 4, [...shade(tone, 30), 255]);
		}
	},
	// Copper: metal in its oxidation-stage tone (copper/exposed/weathered/oxidized),
	// with green patina flecks once it starts to weather. waxed_ keeps the stage.
	copper(buf, ctx, r) {
		const name = baseName(ctx.name).replace(/^waxed_/, '');
		const stage = ['oxidized', 'weathered', 'exposed'].find((s) => name.startsWith(s)) || 'copper';
		const base = COPPER_TONES[stage];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 12 }, r);
		OPS.speckle(buf, { color: shade(base, -24), prob: 0.08 }, r);
		OPS.speckle(buf, { color: shade(base, 20), prob: 0.06 }, r);
		if (stage === 'weathered' || stage === 'oxidized') OPS.speckle(buf, { color: [70, 150, 120], prob: 0.10 }, r);
		OPS.bevel(buf, { light: 18, dark: 26 });
	},
	// Wool / carpet: dyed cloth with a woven cross-hatch over the dye tone.
	wool(buf, ctx, r) {
		const dye = pick(DYES, baseName(ctx.name).replace(/_(?:wool|carpet)$/, ''), WHITE);
		OPS.fill(buf, { color: dye });
		OPS.noise(buf, { delta: 14 }, r);
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) { const p = (x + y) % 4; if (p === 0) setPx(buf, x, y, [...shade(dye, 10), 255]); else if (p === 2) setPx(buf, x, y, [...shade(dye, -12), 255]); }
		OPS.bevel(buf, { light: 12, dark: 14 });
	},
	// Concrete: a smooth dyed slab; _powder is the loose granular form.
	concrete(buf, ctx, r) {
		const name = baseName(ctx.name);
		const dye = pick(DYES, name.replace(/_concrete(?:_powder)?$/, ''), [160, 160, 160]);
		OPS.fill(buf, { color: dye });
		if (/_powder$/.test(name)) { OPS.noise(buf, { delta: 16 }, r); OPS.speckle(buf, { color: shade(dye, -20), prob: 0.10 }, r); OPS.speckle(buf, { color: shade(dye, 16), prob: 0.08 }, r); }
		else { OPS.noise(buf, { delta: 5 }, r); OPS.speckle(buf, { color: shade(dye, -12), prob: 0.02 }, r); OPS.bevel(buf, { light: 10, dark: 12 }); }
	},
	// Terracotta: mottled fired clay (dye mixed into the clay body). _glazed is a
	// bright glazed tile with a simple geometric motif.
	terracotta(buf, ctx, r) {
		const name = baseName(ctx.name);
		const glazed = /glazed/.test(name);
		const dye = pick(DYES, name.replace(/_glazed_terracotta$/, '').replace(/_terracotta$/, ''), null);
		const clay = [152, 94, 67];
		const base = dye ? mix(dye, clay, glazed ? 0.15 : 0.5) : clay;
		OPS.fill(buf, { color: base });
		if (glazed) {
			OPS.rect(buf, { x: 2, y: 2, w: 12, h: 12, color: shade(base, -30), outline: true });
			OPS.rect(buf, { x: 5, y: 5, w: 6, h: 6, color: shade(base, 34) });
			OPS.rect(buf, { x: 7, y: 7, w: 2, h: 2, color: shade(base, -24) });
			OPS.bevel(buf, { light: 14, dark: 14 });
		} else {
			OPS.noise(buf, { delta: 14 }, r);
			OPS.speckle(buf, { color: shade(base, -22), prob: 0.08 }, r);
			OPS.speckle(buf, { color: shade(base, 16), prob: 0.05 }, r);
			OPS.bevel(buf, { light: 12, dark: 16 });
		}
	},
	// Candle: a short dyed wax pillar with a dark wick (plain candle = pale wax).
	candle(buf, ctx, r) {
		const dyeName = baseName(ctx.name).replace(/_?candle(?:_cake)?(?:_lit)?$/, '').replace(/^candle_?/, '');
		const wax = dyeName ? pick(DYES, dyeName, [232, 224, 196]) : [232, 224, 196];
		for (let y = 5; y < 14; y++) for (let x = 7; x < 10; x++) setPx(buf, x, y, [...shade(wax, y < 7 ? 12 : (x === 9 ? -14 : 0)), 255]);
		setPx(buf, 8, 4, [40, 30, 20, 255]);            // wick
		OPS.bevel(buf, { light: 10, dark: 12 });
	},
	// Sculk: dark blue-black organic block with bright cyan glints.
	sculk(buf, ctx, r) {
		const base = [16, 38, 46];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 10 }, r);
		OPS.speckle(buf, { color: shade(base, -8), prob: 0.14 }, r);
		OPS.speckle(buf, { color: [30, 190, 180], prob: 0.06 }, r);
		OPS.bevel(buf, { light: 8, dark: 12 });
	},
	// Ice / snow: distinct material structures rather than three interchangeable
	// white-noise tiles. Snow stays quiet; packed/blue ice keeps sharper fissures.
	ice(buf, ctx, r) {
		const name = baseName(ctx.name);
		const snow = /snow/.test(name), powder = /powder_snow/.test(name), block = /snow_block/.test(name);
		const base = /blue_ice/.test(name) ? [116, 168, 252] : /packed/.test(name) ? [141, 180, 249] : powder ? [232, 241, 244] : block ? [239, 246, 247] : snow ? [244, 249, 249] : [145, 183, 254];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: snow ? (powder ? 5 : 7) : 6 }, r);
		if (snow) {
			const shadow = powder ? [-10, -7, -4] : block ? [-13, -9, -5] : [-8, -5, -3];
			for (let k = 0; k < (block ? 9 : powder ? 6 : 5); k++) {
				const x = r.nextInt(buf.width - 1), y = r.nextInt(buf.height - 1), c = [clampByte(base[0] + shadow[0]), clampByte(base[1] + shadow[1]), clampByte(base[2] + shadow[2])];
				setPx(buf, x, y, [...c, 255]);
				if (block || r.nextDouble() < 0.45) setPx(buf, x + 1, y, [...shade(c, 3), 255]);
			}
			OPS.speckle(buf, { color: [252, 255, 255], prob: block ? 0.06 : 0.035 }, r);
			OPS.bevel(buf, { light: 5, dark: powder ? 4 : 6 });
			return;
		}
		OPS.speckle(buf, { color: shade(base, 18), prob: 0.05 }, r);
		OPS.speckle(buf, { color: shade(base, -26), prob: 0.03 }, r);
		for (let k = 0; k < 3; k++) { let x = r.nextInt(buf.width), y = r.nextInt(buf.height); for (let i = 0; i < 4 + r.nextInt(4); i++) { setPx(buf, x, y, [...shade(base, -18), 255]); x = (x + 1) % buf.width; if (r.nextDouble() < 0.4) y = (y + 1) % buf.height; } }
		OPS.bevel(buf, { light: 9, dark: 8 });
	},
	// Water overlay: translucent cold-blue ripples. It must never fall back to the
	// opaque generic-block recipe, which turns shoreline water into a gray slab.
	water(buf, ctx, r) {
		const base = [55, 105, 148, 104];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 4 }, r);
		for (let k = 0; k < 7; k++) {
			const y = 1 + r.nextInt(buf.height - 2), x0 = r.nextInt(buf.width), len = 2 + r.nextInt(5), light = r.nextDouble() < 0.55;
			for (let i = 0; i < len; i++) {
				const x = (x0 + i) % buf.width, p = getPx(buf, x, y);
				setPx(buf, x, y, [...shade(p, light ? 17 : -14), light ? 122 : 96]);
			}
		}
	},
	// Quartz / purpur: smooth pale decorative stone. quartz is near-white, purpur light
	// purple. chiseled_ frames an inset panel with a carved diamond; _pillar cuts vertical
	// flutes; smooth_ and plain stay clean with a soft bevel.
	quartz(buf, ctx, r) {
		const name = baseName(ctx.name);
		const purpur = /purpur/.test(name);
		const base = purpur ? [170, 104, 170] : [235, 229, 222];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: purpur ? 8 : 5 }, r);
		OPS.speckle(buf, { color: shade(base, 12), prob: 0.05 }, r);
		OPS.speckle(buf, { color: shade(base, -12), prob: 0.03 }, r);
		if (/chiseled/.test(name)) {
			OPS.rect(buf, { x: 1, y: 1, w: 14, h: 14, color: shade(base, -24), outline: true });
			OPS.rect(buf, { x: 3, y: 3, w: 10, h: 10, color: shade(base, -14), outline: true });
			for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++) if (Math.abs(x - 7.5) + Math.abs(y - 7.5) <= 3.5) setPx(buf, x, y, [...shade(base, -18), 255]); // carved diamond
			for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) if (Math.abs(x - 7.5) + Math.abs(y - 7.5) <= 2) setPx(buf, x, y, [...shade(base, 16), 255]);
		} else if (/pillar/.test(name)) {
			for (let x = 3; x < 16; x += 5) { OPS.rect(buf, { x, y: 0, w: 1, h: 16, color: shade(base, -18) }); OPS.rect(buf, { x: x + 1, y: 0, w: 1, h: 16, color: shade(base, 12) }); }
		}
		OPS.bevel(buf, { light: 12, dark: 12 });
	},
	// Froglight: bright glowing block with an organic cellular pattern — a few darker
	// rings over a luminous base, each cell centre catching light. ochre/verdant/
	// pearlescent shift the glow warm-yellow / green / pink.
	froglight(buf, ctx, r) {
		const name = baseName(ctx.name);
		const base = /verdant/.test(name) ? [227, 239, 216] : /pearlescent/.test(name) ? [246, 224, 238] : [251, 241, 205];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 6 }, r);
		const ring = shade(base, -40), glow = shade(base, 20);
		for (let k = 0; k < 9; k++) {
			const cx = r.nextInt(16), cy = r.nextInt(16), rad = 2 + r.nextInt(2);
			OPS.circle(buf, { cx, cy, r: rad, color: ring });
			OPS.circle(buf, { cx, cy, r: rad - 1, color: base });
			setPx(buf, cx, cy, [...glow, 255]); setPx(buf, (cx + 1) % 16, cy, [...glow, 255]);
		}
		OPS.speckle(buf, { color: glow, prob: 0.07 }, r);
		OPS.bevel(buf, { light: 10, dark: 8 });
	},
	// Magma: dark cracked crust veined with glowing lava. A dark base is broken by a
	// branching network of orange cracks with hotter yellow cores.
	magma(buf, ctx, r) {
		const crust = [78, 34, 24];
		OPS.fill(buf, { color: crust });
		OPS.noise(buf, { delta: 12 }, r);
		OPS.speckle(buf, { color: shade(crust, -22), prob: 0.10 }, r);
		const w = buf.width, h = buf.height, hot = [246, 190, 70], warm = [226, 108, 30];
		for (let k = 0; k < 3; k++) {   // a few glowing cracks that wander across the tile
			let x = r.nextInt(w), y = r.nextInt(h), len = 8 + r.nextInt(8);
			for (let i = 0; i < len; i++) {
				setPx(buf, (x + w) % w, (y + h) % h, [...warm, 255]);
				if (r.nextDouble() < 0.5) setPx(buf, (x + 1) % w, (y + h) % h, [...hot, 255]);
				x += r.nextInt(3) - 1; y += r.nextDouble() < 0.6 ? 1 : (r.nextInt(3) - 1);
			}
		}
		OPS.speckle(buf, { color: warm, prob: 0.04 }, r);
		OPS.bevel(buf, { light: 8, dark: 16 });
	},
	// Hay bale (side): golden straw in fine horizontal striations, cinched by two
	// darker binding cords near the top and bottom edges.
	hay(buf, ctx, r) {
		const straw = [166, 138, 33];
		OPS.fill(buf, { color: straw });
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) {
			const rr = r.nextDouble();
			const d = rr < 0.16 ? 26 : rr < 0.30 ? -28 : r.nextInt(13) - 6;   // bright/dark straws over jitter
			setPx(buf, x, y, [...shade(straw, d), 255]);
		}
		const cord = shade(straw, -46), tie = shade(straw, -66);
		for (const cy of [2, 13]) {                                          // two binding cords
			OPS.band(buf, { y: cy, h: 1, color: cord }); OPS.band(buf, { y: cy + 1, h: 1, color: shade(straw, 18) });
			for (let x = 0; x < buf.width; x += 3) setPx(buf, x, cy, [...tie, 255]);   // twisted-rope notches
		}
		OPS.bevel(buf, { light: 14, dark: 20 });
	},
	// Bone block (side): pale bone laid in vertical columns with darker grooves between
	// them and a darker cap band at the top and bottom (the vertebra ends).
	bone(buf, ctx, r) {
		const bone = [229, 225, 203];
		OPS.fill(buf, { color: bone });
		OPS.noise(buf, { delta: 7 }, r);
		for (let x = 3; x < buf.width; x += 4) { OPS.rect(buf, { x, y: 0, w: 1, h: 16, color: shade(bone, -34) }); OPS.rect(buf, { x: x + 1, y: 0, w: 1, h: 16, color: shade(bone, 12) }); }
		const cap = shade(bone, -30);
		for (const cy of [0, 1, 14, 15]) OPS.band(buf, { y: cy, h: 1, color: cy === 0 || cy === 15 ? cap : shade(bone, -16) });
		OPS.speckle(buf, { color: shade(bone, -22), prob: 0.05 }, r);
		OPS.bevel(buf, { light: 12, dark: 14 });
	},
	// Melon / pumpkin rind (side). Melon: green with lighter vertical stripes and dark
	// mottle. Pumpkin: orange rounded ribs separated by dark vertical grooves.
	gourd(buf, ctx, r) {
		const name = baseName(ctx.name);
		if (/pumpkin/.test(name)) {
			const skin = [198, 118, 24];
			OPS.fill(buf, { color: skin });
			OPS.noise(buf, { delta: 9 }, r);
			for (let x = 0; x < buf.width; x++) {
				const rib = ((x + 1) % 4);                                  // 4px ribs, groove at the seam
				const d = rib === 0 ? -40 : rib === 2 ? 16 : 0;             // dark groove / lit rib crown
				if (d) for (let y = 0; y < buf.height; y++) setPx(buf, x, y, [...shade(getPx(buf, x, y), d), 255]);
			}
			OPS.speckle(buf, { color: shade(skin, -26), prob: 0.05 }, r);
			OPS.bevel(buf, { light: 14, dark: 18 });
			return;
		}
		const rind = [111, 145, 32];
		OPS.fill(buf, { color: rind });
		OPS.noise(buf, { delta: 12 }, r);
		OPS.speckle(buf, { color: shade(rind, -30), prob: 0.14 }, r);       // dark mottle
		for (let x = 1; x < buf.width; x += 3) if (r.nextDouble() < 0.7) for (let y = 0; y < buf.height; y++) if (r.nextDouble() < 0.6) setPx(buf, x, y, [...shade(rind, 26), 255]); // pale stripes
		OPS.speckle(buf, { color: shade(rind, 20), prob: 0.05 }, r);
		OPS.bevel(buf, { light: 14, dark: 18 });
	},
	// Dried kelp block: dark olive plant matter pressed into horizontal layers, with
	// darker seams between layers and warm reddish-brown flecks.
	dried_kelp(buf, ctx, r) {
		const base = [51, 58, 42];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 10 }, r);
		for (let y = 2; y < buf.height; y += 4) OPS.band(buf, { y, h: 1, color: shade(base, -22) });   // pressed-layer seams
		OPS.speckle(buf, { color: shade(base, 20), prob: 0.06 }, r);
		OPS.speckle(buf, { color: [96, 66, 44], prob: 0.05 }, r);           // reddish-brown dried flecks
		OPS.bevel(buf, { light: 10, dark: 16 });
	},
	// Honey block: a translucent amber cube — a raised bright frame around a lighter,
	// see-through interior panel with a diagonal shine streak.
	honey(buf, ctx, r) {
		const amber = [251, 179, 62];
		OPS.fill(buf, { color: [...amber, 210] });
		OPS.border(buf, { color: [...shade(amber, 22), 255], thickness: 1 });
		OPS.rect(buf, { x: 2, y: 2, w: 12, h: 12, color: [...shade(amber, -20), 190], outline: true });
		OPS.rect(buf, { x: 4, y: 4, w: 8, h: 8, color: [...mix(amber, WHITE, 0.18), 170] });
		for (let i = 0; i < 5; i++) setPx(buf, 5 + i, 4 + i, [255, 240, 200, 200]);   // shine streak
		OPS.speckle(buf, { color: [...shade(amber, -16), 210], prob: 0.03 }, r);
	},
	// Target block (side): a bullseye of concentric square rings — tan straw border
	// stepping in through white to a dark-red centre.
	target(buf, ctx, r) {
		const tan = [225, 186, 161], white = [230, 224, 214], red = [176, 42, 40], deep = [138, 28, 28];
		const cx = 7.5, cy = 7.5;
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) {
			const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));         // Chebyshev ring distance
			const col = d >= 6.5 ? tan : d >= 4.5 ? white : d >= 2.5 ? red : d >= 1 ? white : deep;
			setPx(buf, x, y, [...shade(col, r.nextInt(11) - 5), 255]);
		}
		OPS.bevel(buf, { light: 12, dark: 14 });
	},
	// Ancient debris: a hoary dark-brown block pocked with lighter porous patches and
	// pale netherite grit; the top face exposes a lighter core.
	ancient_debris(buf, ctx, r) {
		const base = [94, 60, 54];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 12 }, r);
		for (let k = 0; k < 6; k++) { const cx = r.nextInt(16), cy = r.nextInt(16), rad = 2 + r.nextInt(2); OPS.circle(buf, { cx, cy, r: rad, color: shade(base, 24) }); OPS.circle(buf, { cx, cy, r: rad - 1, color: shade(base, -12) }); }
		OPS.speckle(buf, { color: [150, 120, 96], prob: 0.07 }, r);        // pale netherite grit
		OPS.speckle(buf, { color: shade(base, -30), prob: 0.08 }, r);
		if (/_top$/.test(baseName(ctx.name))) { OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 3, color: [124, 96, 80] }); OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 1, color: [162, 132, 108] }); }
		OPS.bevel(buf, { light: 14, dark: 20 });
	},
	// Lodestone: pale gray cut stone with a chiseled central inset and four bright
	// electromagnet studs around a light core.
	lodestone(buf, ctx, r) {
		const base = [122, 124, 130];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 8 }, r);
		OPS.speckle(buf, { color: shade(base, -18), prob: 0.05 }, r);
		OPS.rect(buf, { x: 3, y: 3, w: 10, h: 10, color: shade(base, -30), outline: true });
		OPS.rect(buf, { x: 5, y: 5, w: 6, h: 6, color: shade(base, -16) });
		for (const [x, y] of [[6, 6], [9, 6], [6, 9], [9, 9]]) setPx(buf, x, y, [...shade(base, 34), 255]);   // studs
		setPx(buf, 7, 7, [212, 216, 224, 255]); setPx(buf, 8, 8, [212, 216, 224, 255]);                      // lit core
		OPS.bevel(buf, { light: 14, dark: 16 });
	},
	// Respawn anchor: black obsidian riddled with glowing magenta cells — a bright core
	// cluster on the top face, glowing cell rows on the sides.
	respawn_anchor(buf, ctx, r) {
		const obsidian = [30, 22, 46], glow = [190, 70, 224], core = [236, 156, 255];
		OPS.fill(buf, { color: obsidian });
		OPS.noise(buf, { delta: 8 }, r);
		OPS.speckle(buf, { color: shade(obsidian, -12), prob: 0.10 }, r);
		if (/_top/.test(baseName(ctx.name))) {
			OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 4, color: glow });
			OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 2, color: core });
		} else {
			for (let y = 3; y < 14; y += 5) for (let x = 3; x < 14; x += 5) { OPS.rect(buf, { x, y, w: 3, h: 3, color: glow }); setPx(buf, x + 1, y + 1, [...core, 255]); }
		}
		OPS.border(buf, { color: shade(obsidian, -8), thickness: 1 });
		OPS.bevel(buf, { light: 10, dark: 14 });
	},
	// Reinforced deepslate: deepslate with a riveted dark frame and a faint central sigil.
	reinforced_deepslate(buf, ctx, r) {
		const base = [77, 77, 82];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 8 }, r);
		OPS.speckle(buf, { color: shade(base, -16), prob: 0.06 }, r);
		OPS.speckle(buf, { color: shade(base, 14), prob: 0.04 }, r);
		OPS.border(buf, { color: shade(base, -26), thickness: 1 });
		for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) setPx(buf, x, y, [...shade(base, 26), 255]);   // rivets
		OPS.rect(buf, { x: 5, y: 5, w: 6, h: 6, color: shade(base, -14), outline: true });                        // sigil
		OPS.bevel(buf, { light: 12, dark: 16 });
	},
	// Scaffolding: a bamboo frame on transparent — two vertical poles bound by horizontal
	// rungs; the top face adds the woven diagonal cross.
	scaffolding(buf, ctx, r) {
		const bamboo = [196, 170, 92];
		const strut = (x0, y0, x1, y1) => { const dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy)) || 1; for (let i = 0; i <= n; i++) { const x = Math.round(x0 + dx * i / n), y = Math.round(y0 + dy * i / n); setPx(buf, x, y, [...shade(bamboo, r.nextInt(13) - 6), 255]); setPx(buf, x + 1, y, [...shade(bamboo, -16), 255]); } };
		strut(1, 0, 1, 15); strut(14, 0, 14, 15);       // vertical poles
		strut(0, 1, 15, 1); strut(0, 14, 15, 14); strut(0, 7, 15, 7);   // rungs
		if (/_top/.test(baseName(ctx.name))) { strut(1, 1, 14, 14); strut(14, 1, 1, 14); }
	},
	// Mangrove roots: tangled brown root strands on transparent; the muddy variant packs
	// the gaps with wet mud.
	roots(buf, ctx, r) {
		const muddy = /muddy/.test(baseName(ctx.name));
		const wood = [113, 88, 58], mud = [70, 58, 52];
		if (muddy) { OPS.fill(buf, { color: mud }); OPS.noise(buf, { delta: 12 }, r); OPS.speckle(buf, { color: shade(mud, -18), prob: 0.10 }, r); }
		const strand = (x0) => { let x = x0; for (let y = 0; y < 16; y++) { setPx(buf, (x + 16) % 16, y, [...shade(wood, r.nextInt(17) - 8), 255]); setPx(buf, (x + 17) % 16, y, [...shade(wood, -16), 255]); if (r.nextDouble() < 0.35) x += r.nextInt(3) - 1; } };
		for (let k = 0; k < (muddy ? 4 : 6); k++) strand(2 + k * 3 + r.nextInt(2));
		OPS.bevel(buf, { light: 12, dark: 16 });
	},
	// Sniffer egg: a mossy olive egg with darker organic spots and a pale top highlight.
	egg(buf, ctx, r) {
		const base = [120, 120, 80], spot = [80, 92, 58], light = [168, 170, 120];
		const inEgg = (x, y) => { const dx = (x - 7.5) / 5.5, dy = (y - 8.5) / 6.8; return dx * dx + dy * dy <= 1; };
		for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (inEgg(x, y)) setPx(buf, x, y, [...shade(base, r.nextInt(17) - 8), 255]);
		for (let k = 0; k < 9; k++) { const cx = r.nextInt(16), cy = r.nextInt(16); for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (inEgg(x, y) && (x - cx) ** 2 + (y - cy) ** 2 <= 2) setPx(buf, x, y, [...shade(spot, r.nextInt(11) - 5), 255]); }
		for (let k = 0; k < 10; k++) { const x = 5 + r.nextInt(6), y = 2 + r.nextInt(3); if (inEgg(x, y)) setPx(buf, x, y, [...light, 255]); }
		for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { if (inEgg(x, y)) continue; if (inEgg(x - 1, y) || inEgg(x + 1, y) || inEgg(x, y - 1) || inEgg(x, y + 1)) setPx(buf, x, y, [54, 58, 40, 255]); }
	},
	// Pointed dripstone: a stone spike tapering down the tile centre (transparent bg),
	// lit on the left edge and shadowed on the right.
	dripstone(buf, ctx, r) {
		const base = [140, 110, 92];
		for (let y = 0; y < 16; y++) {
			const half = Math.max(0.5, (16 - y) * 0.34);                   // widest at the top, tapering to a tip
			const cx = 7.5;
			for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
				const d = x < cx - half + 1 ? 22 : x > cx + half - 1 ? -24 : r.nextInt(15) - 7;
				const spot = r.nextDouble() < 0.06 ? -26 : 0;              // pitting, only on the spike
				setPx(buf, x, y, [...shade(base, d + spot), 255]);
			}
		}
	},
	// Solid mineral / metal block: metals are smooth with a sheen, gems are faceted
	// crystal lattices, coal/redstone are flecked, raw ore blocks are chunky nuggets.
	mineral_block(buf, ctx, r) {
		const name = baseName(ctx.name);
		const TONES = {
			iron_block: [220, 220, 220], gold_block: [246, 208, 62], diamond_block: [98, 219, 214],
			emerald_block: [43, 203, 96], lapis_block: [30, 67, 140], redstone_block: [175, 24, 5],
			coal_block: [22, 20, 20], netherite_block: [66, 62, 64], amethyst_block: [133, 97, 191],
			budding_amethyst: [146, 108, 198], raw_iron_block: [194, 150, 122], raw_gold_block: [224, 180, 96],
		};
		const base = TONES[name] || [180, 180, 180];
		const gem = /diamond|emerald|lapis|amethyst/.test(name);
		const metal = /iron_block|gold_block|netherite/.test(name);
		const raw = /^raw_/.test(name);
		OPS.fill(buf, { color: base });
		if (raw) {
			OPS.noise(buf, { delta: 14 }, r);
			OPS.speckle(buf, { color: shade(base, -28), prob: 0.10 }, r);
			for (let k = 0; k < 6; k++) { const x = r.nextInt(14), y = r.nextInt(14), c = shade(base, 20); OPS.rect(buf, { x, y, w: 2, h: 2, color: c }); setPx(buf, x, y, [...shade(base, 36), 255]); }
			OPS.bevel(buf, { light: 18, dark: 26 });
		} else if (gem) {
			OPS.noise(buf, { delta: 6 }, r);
			for (let cy = 0; cy < buf.height; cy += 4) for (let cx = 0; cx < buf.width; cx += 4) {   // 4px faceted crystals
				for (let y = cy; y < cy + 4; y++) for (let x = cx; x < cx + 4; x++) { const lx = x - cx, ly = y - cy; const d = lx + ly < 3 ? 24 : lx + ly > 4 ? -26 : 0; if (d) setPx(buf, x, y, [...shade(base, d), 255]); }
				setPx(buf, cx + 1, cy + 1, [...shade(base, 44), 255]);   // facet glint
			}
			OPS.bevel(buf, { light: 14, dark: 14 });
		} else if (metal) {
			OPS.noise(buf, { delta: /netherite/.test(name) ? 10 : 4 }, r);
			if (/netherite/.test(name)) { OPS.speckle(buf, { color: shade(base, -22), prob: 0.10 }, r); OPS.speckle(buf, { color: shade(base, 18), prob: 0.05 }, r); }   // marbled
			for (let i = 0; i < 8; i++) setPx(buf, 3 + i, 3 + i, [...shade(base, 34), 255]);   // diagonal sheen
			OPS.bevel(buf, { light: 18, dark: 22 });
		} else {   // coal_block, redstone_block: solid with fine flecks
			OPS.noise(buf, { delta: 10 }, r);
			OPS.speckle(buf, { color: shade(base, -30), prob: 0.08 }, r);
			OPS.speckle(buf, { color: shade(base, 24), prob: 0.05 }, r);
			OPS.bevel(buf, { light: 12, dark: 16 });
		}
	},
	// Honeycomb block: warm wax with an offset grid of hexagonal-ish cells outlined by
	// darker walls, each cell catching a little light.
	honeycomb(buf, ctx, r) {
		const wax = [229, 148, 32], wall = shade(wax, -40), lit = shade(wax, 26);
		OPS.fill(buf, { color: wax });
		OPS.noise(buf, { delta: 7 }, r);
		const s = 5;
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) {
			const row = Math.floor(y / (s - 1)), ox = (row & 1) ? Math.floor(s / 2) : 0;
			const wx = (x + ox) % s, wy = y % (s - 1);
			if (wx === 0 || wy === 0) setPx(buf, x, y, [...wall, 255]);
			else if (wx === 2 && wy === 2) setPx(buf, x, y, [...lit, 255]);
		}
		OPS.bevel(buf, { light: 12, dark: 14 });
	},
	// Sponge: porous yellow block riddled with dark pores; wet_sponge is darker with a
	// few damp blue-green drips.
	sponge(buf, ctx, r) {
		const wet = /wet/.test(baseName(ctx.name));
		const base = wet ? [150, 148, 70] : [196, 192, 75];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 16 }, r);
		for (let k = 0; k < 26; k++) { const x = r.nextInt(16), y = r.nextInt(16); setPx(buf, x, y, [...shade(base, -48), 255]); if (r.nextDouble() < 0.5) setPx(buf, (x + 1) % 16, y, [...shade(base, -40), 255]); }
		OPS.speckle(buf, { color: shade(base, 22), prob: 0.06 }, r);
		if (wet) OPS.speckle(buf, { color: [70, 110, 120], prob: 0.05 }, r);
		OPS.bevel(buf, { light: 12, dark: 16 });
	},
	// Wart block: a spongy field of bumps — dark crimson for nether_wart_block, teal for
	// warped_wart_block, with lighter nubs and darker pits.
	wart(buf, ctx, r) {
		const warped = /warped/.test(baseName(ctx.name));
		const base = warped ? [22, 120, 116] : [114, 17, 19];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 10 }, r);
		for (let k = 0; k < 11; k++) { const cx = r.nextInt(16), cy = r.nextInt(16), rad = 1 + r.nextInt(2); OPS.circle(buf, { cx, cy, r: rad, color: shade(base, 22) }); setPx(buf, cx, cy, [...shade(base, 38), 255]); }
		OPS.speckle(buf, { color: shade(base, -26), prob: 0.10 }, r);
		OPS.bevel(buf, { light: 14, dark: 18 });
	},
	// Slime block: a translucent green cube with a darker frame and an inner slime-ball
	// outline, plus a couple of pale bubbles.
	slime(buf, ctx, r) {
		const green = [112, 192, 90];
		OPS.fill(buf, { color: [...green, 175] });
		OPS.border(buf, { color: [...shade(green, -32), 230], thickness: 1 });
		OPS.rect(buf, { x: 3, y: 3, w: 10, h: 10, color: [...shade(green, -20), 205], outline: true });
		OPS.rect(buf, { x: 6, y: 6, w: 4, h: 4, color: [...shade(green, -14), 200], outline: true });
		for (const [x, y] of [[5, 11], [11, 5], [10, 10]]) setPx(buf, x, y, [...mix(green, WHITE, 0.4), 210]);
	},
	// Redstone lamp (unlit): a dark reddish housing latticed into cells, each holding a
	// dim redstone node.
	redstone_lamp(buf, ctx, r) {
		const base = [104, 60, 32];
		OPS.fill(buf, { color: base });
		OPS.noise(buf, { delta: 8 }, r);
		for (let i = 0; i < buf.width; i += 5) { OPS.rect(buf, { x: i, y: 0, w: 1, h: 16, color: shade(base, -30) }); OPS.rect(buf, { x: 0, y: i, w: 16, h: 1, color: shade(base, -30) }); }
		for (let cy = 2; cy < 16; cy += 5) for (let cx = 2; cx < 16; cx += 5) { setPx(buf, cx, cy, [150, 40, 20, 255]); setPx(buf, cx + 1, cy, [120, 30, 16, 255]); }
		OPS.bevel(buf, { light: 10, dark: 16 });
	},
	// Machines & utility blocks: a shared "template" impression — a material-tinted,
	// noisy, beveled body with corner rivets — plus a small name-keyed accent motif, so a
	// furnace, a piston, a command block and a bookshelf read as themselves rather than as
	// identical hash-hued noise. content-forge serves one flat texture per machine, so this
	// is a single-face impression, not a per-face atlas (furnace_front/_side/_top).
	machine(buf, ctx, r) {
		const name = baseName(ctx.name);
		const is = (re) => re.test(name);
		// A recessed inset panel: darkened interior inside a darker 1px frame.
		const panel = (x, y, w, h, tone, depth = -30) => {
			OPS.rect(buf, { x, y, w, h, color: [...shade(tone, depth), 255] });
			OPS.rect(buf, { x, y, w, h, color: [...shade(tone, depth - 22), 255], outline: true });
		};
		// Body material the block is cut from — picks the base tone and the noise grain.
		const wood = is(/table|bookshelf|jukebox|lectern|barrel|note_block|smoker|piston|composter|beehive|bee_nest|daylight_detector|decorated_pot/);
		const body =
			is(/crafting_table|cartography_table|fletching_table|smithing_table|loom|lectern|jukebox|note_block|bookshelf|barrel|composter|beehive|bee_nest|daylight_detector|crafter/) ? WOODS.oak :
			is(/smoker/) ? WOODS.spruce :
			is(/piston/) ? WOODS.birch :
			is(/decorated_pot/) ? [152, 94, 67] :
			is(/command_block|structure_block|structure_void|jigsaw|spawner|enchanting_table/) ? [48, 44, 54] :
			is(/hopper|anvil|cauldron|brewing_stand|bell|^chain$|iron_bars|iron_door|iron_trapdoor|conduit|lantern|grindstone|stonecutter|blast_furnace/) ? [128, 130, 137] :
			[110, 110, 114]; // furnace / dispenser / dropper: cobbled body
		// ---- shared template ----
		OPS.fill(buf, { color: body });
		OPS.noise(buf, { delta: wood ? 9 : 12 }, r);
		OPS.bevel(buf, { light: 20, dark: 30 });
		if (!wood) for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) setPx(buf, x, y, [...shade(body, 34), 255]); // corner rivets

		// ---- per-block accent motif ----
		if (is(/furnace|smoker/)) {                 // recessed firebox with grate bars
			panel(3, 7, 10, 7, body, -40);
			OPS.rect(buf, { x: 4, y: 9, w: 8, h: 1, color: shade(body, -6) });
			OPS.rect(buf, { x: 4, y: 11, w: 8, h: 1, color: shade(body, -6) });
		} else if (is(/dispenser|dropper/)) {       // recessed panel with a round mouth
			panel(3, 3, 10, 10, body, -34);
			OPS.circle(buf, { cx: 7.5, cy: 8, r: is(/dropper/) ? 1.6 : 2.4, color: [24, 24, 26] });
		} else if (is(/piston/)) {                  // plank face in a frame; sticky = green pad
			OPS.border(buf, { color: shade(body, -34), thickness: 2 });
			const pad = is(/sticky/) ? [120, 176, 84] : shade(body, 12);
			OPS.rect(buf, { x: 4, y: 4, w: 8, h: 8, color: pad });
			OPS.rect(buf, { x: 4, y: 4, w: 8, h: 8, color: shade(pad, -30), outline: true });
		} else if (is(/observer/)) {                // a single dark eye with a bright pupil
			panel(4, 4, 8, 8, body, -40);
			OPS.rect(buf, { x: 7, y: 7, w: 2, h: 2, color: [210, 60, 40] });
		} else if (is(/repeater|comparator/)) {     // smooth deck carrying redstone-torch nubs
			OPS.fill(buf, { color: [150, 150, 150] }); OPS.noise(buf, { delta: 6 }, r); OPS.bevel(buf, { light: 16, dark: 22 });
			for (const [x, top] of [[5, is(/comparator/) ? 3 : 9], [10, 9]]) { OPS.rect(buf, { x, y: top, w: 1, h: 3, color: [96, 40, 30] }); setPx(buf, x, top - 1, [210, 44, 30, 255]); }
		} else if (is(/daylight_detector/)) {       // wood frame around a blue glass sensor
			panel(3, 3, 10, 10, [40, 70, 120], -4);
			OPS.speckle(buf, { color: [120, 160, 210], prob: 0.14 }, r);
		} else if (is(/command_block/)) {           // chiseled circuit, tinted by variant
			const tint = is(/repeating/) ? [120, 90, 190] : is(/chain/) ? [70, 150, 130] : [176, 120, 70];
			OPS.border(buf, { color: shade(tint, -20), thickness: 1 });
			OPS.rect(buf, { x: 3, y: 3, w: 10, h: 10, color: tint, outline: true });
			OPS.rect(buf, { x: 6, y: 6, w: 4, h: 4, color: shade(tint, 20), outline: true });
			setPx(buf, 7, 7, [...shade(tint, 40), 255]); setPx(buf, 8, 8, [...shade(tint, 40), 255]);
		} else if (is(/structure_block|structure_void|jigsaw/)) { // tech block with a label plate
			const tint = is(/jigsaw/) ? [150, 120, 170] : [120, 170, 190];
			OPS.rect(buf, { x: 3, y: 3, w: 10, h: 10, color: tint, outline: true });
			OPS.rect(buf, { x: 6, y: 6, w: 4, h: 4, color: shade(tint, -30) });
		} else if (is(/spawner|trial_spawner/)) {   // barred cage over a dark void
			panel(2, 2, 12, 12, [30, 34, 40], 0);
			for (let i = 2; i <= 14; i += 3) { OPS.rect(buf, { x: i, y: 2, w: 1, h: 12, color: [70, 78, 86] }); OPS.rect(buf, { x: 2, y: i, w: 12, h: 1, color: [70, 78, 86] }); }
		} else if (is(/enchanting_table/)) {        // obsidian body, red cloth top, arcane sparkle
			OPS.band(buf, { y: 0, h: 4, color: [150, 34, 30] }); OPS.band(buf, { y: 3, h: 1, color: [90, 20, 20] });
			OPS.speckle(buf, { color: [176, 120, 214], prob: 0.05 }, r);
		} else if (is(/bookshelf/)) {               // plank rails with a row of book spines
			OPS.band(buf, { y: 0, h: 2, color: shade(body, -26) }); OPS.band(buf, { y: 14, h: 2, color: shade(body, -26) }); OPS.band(buf, { y: 7, h: 2, color: shade(body, -30) });
			const spines = [[150, 60, 50], [70, 110, 160], [90, 140, 70], [200, 170, 80], [150, 90, 160]];
			for (let x = 1; x < 15; x += 2) { OPS.rect(buf, { x, y: 2, w: 1, h: 5, color: spines[(x >> 1) % spines.length] }); OPS.rect(buf, { x, y: 9, w: 1, h: 5, color: spines[((x >> 1) + 2) % spines.length] }); }
		} else if (is(/barrel/)) {                  // staves with dark hoops and a center plug
			for (let x = 2; x < 16; x += 3) OPS.rect(buf, { x, y: 0, w: 1, h: 16, color: shade(body, -22) });
			OPS.band(buf, { y: 3, h: 1, color: shade(body, -36) }); OPS.band(buf, { y: 12, h: 1, color: shade(body, -36) });
			OPS.rect(buf, { x: 6, y: 6, w: 4, h: 4, color: shade(body, -18), outline: true });
		} else if (is(/jukebox|note_block/)) {      // wood cabinet with an inlaid panel
			panel(4, 4, 8, 8, body, -34);
			if (is(/note_block/)) for (const [x, y] of [[6, 6], [9, 6], [6, 9], [9, 9]]) setPx(buf, x, y, [30, 30, 34, 255]);
			else { OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 1.6, color: [20, 20, 22] }); setPx(buf, 8, 7, [190, 190, 190, 255]); }
		} else if (is(/composter/)) {               // slatted bin open to dark compost
			for (let x = 1; x < 15; x += 3) OPS.rect(buf, { x, y: 2, w: 1, h: 14, color: shade(body, -26) });
			panel(4, 4, 8, 8, [70, 58, 40], 0); OPS.speckle(buf, { color: [96, 128, 60], prob: 0.16 }, r);
		} else if (is(/beehive|bee_nest/)) {        // bark body with a honey band and an entrance
			OPS.band(buf, { y: 8, h: 3, color: [214, 148, 40] });
			OPS.rect(buf, { x: 7, y: 9, w: 2, h: 2, color: [40, 26, 16] });
		} else if (is(/decorated_pot/)) {           // terracotta pot with rim bands and a face
			OPS.band(buf, { y: 1, h: 2, color: shade(body, -20) }); OPS.band(buf, { y: 13, h: 2, color: shade(body, -20) });
			panel(5, 5, 6, 7, body, -16);
		} else if (is(/crafting_table|crafter/)) {  // grid seams with a saw motif
			OPS.rect(buf, { x: 8, y: 0, w: 1, h: 16, color: shade(body, -30) }); OPS.rect(buf, { x: 0, y: 8, w: 16, h: 1, color: shade(body, -30) });
			for (let i = 10; i < 15; i++) setPx(buf, i, 2, [150, 150, 155, 255]);
		} else if (is(/cartography_table/)) {       // parchment map with red route lines
			panel(3, 3, 10, 9, [222, 214, 180], -4);
			OPS.rect(buf, { x: 5, y: 7, w: 6, h: 1, color: [168, 60, 50] }); OPS.rect(buf, { x: 7, y: 5, w: 1, h: 6, color: [168, 60, 50] });
		} else if (is(/fletching_table/)) {         // crossed arrow strokes
			for (let i = 0; i < 10; i++) { setPx(buf, 3 + i, 12 - i, [210, 210, 210, 255]); setPx(buf, 5 + i, 12 - i, [150, 110, 70, 255]); }
		} else if (is(/smithing_table/)) {          // dark iron top with a hammer
			OPS.band(buf, { y: 2, h: 4, color: [60, 62, 68] });
			OPS.rect(buf, { x: 6, y: 8, w: 4, h: 2, color: [92, 94, 100] }); OPS.rect(buf, { x: 7, y: 9, w: 1, h: 5, color: shade(body, -24) });
		} else if (is(/loom/)) {                    // warp/weft string crosshatch
			for (let x = 2; x < 14; x += 3) OPS.rect(buf, { x, y: 2, w: 1, h: 12, color: shade(body, 22) });
			for (let y = 2; y < 14; y += 3) OPS.rect(buf, { x: 2, y, w: 12, h: 1, color: shade(body, -22) });
		} else if (is(/lectern/)) {                 // an open book on a stand
			OPS.rect(buf, { x: 3, y: 5, w: 5, h: 7, color: [228, 222, 196] }); OPS.rect(buf, { x: 8, y: 5, w: 5, h: 7, color: [214, 208, 182] });
			OPS.rect(buf, { x: 7, y: 5, w: 2, h: 7, color: shade(body, -20) });
		} else if (is(/hopper/)) {                  // iron rim over a converging funnel
			OPS.band(buf, { y: 2, h: 2, color: shade(body, -30) });
			for (let y = 4; y < 12; y++) { const w = 12 - (y - 4); OPS.rect(buf, { x: (16 - w) >> 1, y, w, h: 1, color: y < 8 ? shade(body, -10) : [40, 42, 46] }); }
		} else if (is(/anvil/)) {                   // dark iron with a lighter face; scars if worn
			OPS.band(buf, { y: 1, h: 3, color: shade(body, 24) }); OPS.band(buf, { y: 4, h: 1, color: shade(body, -36) });
			if (is(/chipped|damaged/)) OPS.speckle(buf, { color: shade(body, -40), prob: 0.08 }, r);
		} else if (is(/cauldron/)) {                // iron pot, interior tinted by contents
			const brew = is(/lava/) ? [214, 110, 30] : is(/powder_snow/) ? [235, 240, 244] : is(/water/) ? [56, 96, 160] : [30, 30, 34];
			panel(4, 4, 8, 9, body, -20); OPS.rect(buf, { x: 5, y: 6, w: 6, h: 6, color: brew });
		} else if (is(/brewing_stand/)) {           // stone base, central rod, bottle nubs
			OPS.rect(buf, { x: 7, y: 2, w: 2, h: 10, color: [150, 150, 150] }); OPS.band(buf, { y: 12, h: 3, color: shade(body, -14) });
			for (const x of [3, 12]) setPx(buf, x, 11, [214, 224, 210, 255]);
		} else if (is(/grindstone/)) {              // a stone wheel in a frame
			OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 6, color: shade(body, -34) }); OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 4.5, color: [150, 150, 150] }); OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 1.4, color: shade(body, -20) });
		} else if (is(/stonecutter/)) {             // base with a saw blade
			for (let i = 2; i < 14; i++) setPx(buf, i, 14 - i, [210, 210, 215, 255]);
			OPS.rect(buf, { x: 6, y: 3, w: 4, h: 1, color: shade(body, -30) });
		} else if (is(/conduit/)) {                 // ornate frame with a teal eye
			OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 5, color: [196, 178, 120] }); OPS.circle(buf, { cx: 7.5, cy: 7.5, r: 2.4, color: [64, 180, 190] }); setPx(buf, 7, 7, [200, 240, 240, 255]);
		} else if (is(/bell/)) {                    // a mounted gold bell
			const gold = [224, 182, 66];
			OPS.rect(buf, { x: 5, y: 3, w: 6, h: 8, color: gold }); OPS.rect(buf, { x: 4, y: 10, w: 8, h: 2, color: shade(gold, -12) }); OPS.rect(buf, { x: 7, y: 2, w: 2, h: 1, color: shade(gold, -24) });
		} else if (is(/lantern/)) {                 // a glowing core in a metal cage
			const glow = is(/soul/) ? [90, 200, 210] : [244, 206, 120];
			OPS.circle(buf, { cx: 7.5, cy: 8, r: 3, color: glow }); OPS.circle(buf, { cx: 7.5, cy: 8, r: 1.4, color: mix(glow, WHITE, 0.6) });
			OPS.band(buf, { y: 1, h: 2, color: shade(body, -20) });
		} else if (is(/^chain$/)) {                 // a vertical run of links
			OPS.fill(buf, { color: [0, 0, 0, 0] });
			for (let y = 1; y < 16; y += 4) OPS.rect(buf, { x: 6, y, w: 4, h: 3, color: shade(body, -6), outline: true });
		} else if (is(/iron_bars/)) {               // vertical bars on transparent
			OPS.fill(buf, { color: [0, 0, 0, 0] });
			for (const x of [4, 8, 11]) OPS.rect(buf, { x, y: 0, w: 1, h: 16, color: body });
		} else {                                    // iron_door / iron_trapdoor / fallback panel
			panel(4, 4, 8, 8, body, -26);
			OPS.rect(buf, { x: 6, y: 6, w: 2, h: 2, color: shade(body, 28) });
		}
	},
	// Particles: soft radial stamps on a transparent field — the animated puff / spark /
	// glow sheets (explosion, smoke, soul, spell, spark, glitter, sweep, splash…). The
	// trailing frame index drives a dissipation curve (blobs grow & fade, rings expand) so a
	// strip of frames reads as one evolving effect. Shaped-icon and glyph sheets (heart,
	// nautilus, drip_*, the sga_* runes) stay authored and are not routed here.
	particle(buf, ctx, r) {
		const raw = baseName(ctx.name);
		const key = raw.replace(/_\d+$/, '');
		const frame = Number((raw.match(/_(\d+)$/) || [, '0'])[1]) || 0;
		const [core, edge] = PARTICLE_TONES[key] || [[220, 220, 224], [120, 120, 126]];
		const W = buf.width, H = buf.height;
		OPS.fill(buf, { color: [0, 0, 0, 0] });
		const ring = /sonic_boom|bubble_pop|sweep/.test(key);
		const puff = /explosion|big_smoke|gust|soul|spell|effect|trial_spawner_detection/.test(key);
		// Frame drives size & brightness: rings and puffs expand and fade over the strip;
		// twinkles (spark/glitter/cherry/…) stay compact and bright.
		const rad = ring ? 2.5 + frame * 0.9 : puff ? 4 + frame * 0.35 : 3.6 + (r.nextDouble() - 0.5);
		const peak = Math.max(96, (ring || puff ? 235 - frame * 12 : 235));
		// One soft radial stamp; alpha falls off from the center (or peaks at a shell for rings).
		const stamp = (cx, cy, rd, pk) => {
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const d = Math.hypot(x - cx, y - cy) / rd;
				if (d > 1) continue;
				const col = mix(core, edge, d);
				let a = ring ? pk * Math.max(0, 1 - Math.abs(d - 0.72) * 4) : pk * (1 - d * d);
				a *= 0.75 + 0.5 * r.nextDouble();               // grain so it isn't a clean gradient
				a = Math.round(Math.min(255, a));
				if (a > getPx(buf, x, y)[3]) setPx(buf, x, y, [...col, a]);
			}
		};
		const blobs = puff ? 2 : 1;                             // smoke/spell read as clustered puffs
		for (let b = 0; b < blobs; b++) stamp(W / 2 - 0.5 + (r.nextDouble() - 0.5) * (blobs > 1 ? 4 : 1.5), H / 2 - 0.5 + (r.nextDouble() - 0.5) * (blobs > 1 ? 4 : 1.5), rad * (1 - b * 0.25), peak);
		// A bright pinpoint core for the twinkles; a few stray sparkles for glitter/glint.
		if (/spark|glitter|glint|flash|cherry|generic/.test(key)) setPx(buf, W >> 1, H >> 1, [...mix(core, WHITE, 0.6), 255]);
		if (/glitter|glint/.test(key)) for (let k = 0; k < 3; k++) setPx(buf, r.nextInt(W), r.nextInt(H), [...mix(core, WHITE, 0.5), 200 + r.nextInt(56)]);
	},
	// ---- item icons (centered on a transparent background) ----
	// Ingot: a beveled metal bar — top highlight, dark outline, a shine dash.
	ingot(buf, ctx, r) {
		const base = pick(METAL_TONES, baseName(ctx.name).replace(/_ingot$/, ''), [200, 200, 200]);
		OPS.rect(buf, { x: 3, y: 6, w: 10, h: 5, color: base });
		OPS.rect(buf, { x: 4, y: 5, w: 8, h: 1, color: shade(base, 26) });
		OPS.rect(buf, { x: 3, y: 6, w: 10, h: 5, color: shade(base, -44), outline: true });
		OPS.rect(buf, { x: 5, y: 7, w: 3, h: 1, color: shade(base, 40) });
	},
	// Nugget: a small metal blob with a glint.
	nugget(buf, ctx, r) {
		const base = pick(METAL_TONES, baseName(ctx.name).replace(/_nugget$/, ''), [200, 200, 200]);
		OPS.circle(buf, { cx: 8, cy: 9, r: 3, color: base });
		setPx(buf, 7, 7, [...shade(base, 40), 255]);
	},
	// Gem / shard: a faceted rhombus, left facets lit, right facets shaded.
	gem(buf, ctx, r) {
		const base = pick(GEM_TONES, baseName(ctx.name), [120, 210, 210]);
		for (let y = 2; y < 14; y++) for (let x = 3; x < 13; x++) if (Math.abs(x - 7.5) + Math.abs(y - 7.5) <= 5) setPx(buf, x, y, [...shade(base, x <= 7 ? 20 : -16), 255]);
		setPx(buf, 6, 5, [...shade(base, 48), 255]); setPx(buf, 7, 5, [...shade(base, 36), 255]);
	},
	// Mineral chunk: raw ore or coal — a speckled lump.
	mineral(buf, ctx, r) {
		const name = baseName(ctx.name);
		const base = /coal|charcoal/.test(name) ? [40, 40, 40] : pick(METAL_TONES, name.replace(/^raw_/, ''), [150, 120, 90]);
		OPS.circle(buf, { cx: 8, cy: 8, r: 5, color: base });
		for (let k = 0; k < 8; k++) { const a = r.nextDouble() * 6.283, rr = 4 + r.nextInt(2); setPx(buf, Math.round(8 + Math.cos(a) * rr), Math.round(8 + Math.sin(a) * rr), [...base, 255]); }
		for (let y = 0; y < buf.height; y++) for (let x = 0; x < buf.width; x++) { const p = getPx(buf, x, y); if (p[3] !== 0) setPx(buf, x, y, [...shade([p[0], p[1], p[2]], r.nextInt(31) - 13), 255]); }
	},
	// Dust / powder: a scattered pile of fine grains.
	dust(buf, ctx, r) {
		const base = pick(DUST_TONES, baseName(ctx.name), [190, 30, 20]);
		for (let k = 0; k < 48; k++) { const x = 3 + r.nextInt(10), y = 6 + r.nextInt(8); if ((x - 8) ** 2 + (y - 10) ** 2 < 26) setPx(buf, x, y, [...shade(base, r.nextInt(33) - 16), 255]); }
	},
	// Seeds: a few paired seeds scattered in the icon.
	seeds(buf, ctx, r) {
		const base = pick(SEED_TONES, baseName(ctx.name), [140, 158, 84]);
		for (const [x, y] of [[6, 7], [9, 6], [7, 10], [10, 9], [5, 10]]) {
			setPx(buf, x, y, [...base, 255]); setPx(buf, x + 1, y, [...shade(base, -16), 255]);
			setPx(buf, x, y + 1, [...shade(base, -16), 255]); setPx(buf, x + 1, y + 1, [...base, 255]);
		}
	},
	// Rod / stick: a diagonal shaft with a lit and a shaded edge.
	rod(buf, ctx, r) {
		const base = pick(ROD_TONES, baseName(ctx.name), [140, 100, 58]);
		for (let i = 2; i < 14; i++) { const x = i, y = 15 - i; setPx(buf, x, y, [...shade(base, r.nextInt(13) - 6), 255]); setPx(buf, x - 1, y, [...shade(base, -18), 255]); setPx(buf, x + 1, y, [...shade(base, 16), 255]); }
	},
	// Tool: a stick handle (bottom-left) + a material head shaped by the tool type,
	// oriented like the vanilla icons (head at top-right). Flat shapes are drawn first,
	// then a shared bevel pass (highlight top-left rim, shadow bottom-right) and a 1px
	// dark outline give the crisp, dimensional pixel-art look.
	tool(buf, ctx, r) {
		const name = baseName(ctx.name);
		const mat = pick(TOOL_TONES, name, [190, 190, 190]);
		const wood = [120, 86, 50], bind = [78, 74, 78];
		const fill = (x, y, c) => setPx(buf, x, y, c[3] === 0 ? c : [c[0], c[1], c[2], 255]);
		const bar = (x0, y0, x1, y1, c, w = 2) => { const dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy)) || 1; for (let i = 0; i <= n; i++) { const x = Math.round(x0 + dx * i / n), y = Math.round(y0 + dy * i / n); for (let o = 0; o < w; o++) fill(x + (o && dx >= 0 ? o : 0), y + (o && dx < 0 ? o : 0), c); } };
		const type = ['sword', 'pickaxe', 'shovel', 'hoe', 'axe'].find((t) => name.endsWith(t)) || 'sword';
		if (type === 'sword') {
			bar(2, 13, 4, 11, wood, 2);                                     // grip
			bar(2, 9, 6, 13, bind, 1);                                      // crossguard (perpendicular)
			for (let i = 0; i < 10; i++) { const x = 4 + i, y = 12 - i; fill(x, y, mat); fill(x + 1, y, mat); if (i > 0) fill(x, y + 1, mat); } // thick blade
			fill(13, 2, mat); fill(14, 2, mat);                             // tip
		} else {
			for (let i = 0; i < 9; i++) { const x = 2 + i, y = 13 - i; fill(x, y, wood); fill(x + 1, y, wood); } // handle
			if (type === 'pickaxe') {
				for (let x = 3; x <= 13; x++) { const t = (x - 8) / 5, y = Math.round(3 + t * t * 3.5); fill(x, y, mat); fill(x, y + 1, mat); }
				fill(9, 5, mat); fill(9, 6, mat);                           // connect to handle
			} else if (type === 'axe') {
				for (let y = 2; y <= 9; y++) { const w = 5 - Math.round(Math.abs(y - 5.5) * 0.8); for (let x = 10 - w; x <= 10; x++) fill(x, y, mat); }
			} else if (type === 'shovel') {
				for (let y = 1; y <= 5; y++) for (let x = 7; x <= 11; x++) fill(x, y, mat);
				for (const [x, y] of [[7, 1], [11, 1], [7, 5], [11, 5]]) fill(x, y, [0, 0, 0, 0]); // round corners
				fill(9, 6, mat);                                            // neck
			} else if (type === 'hoe') {
				for (let x = 8; x <= 13; x++) { fill(x, 2, mat); fill(x, 3, mat); }
				fill(12, 4, mat); fill(13, 4, mat); fill(12, 5, mat);       // neck down to handle
			}
		}
		// bevel: lighten top/left rim, darken bottom/right rim
		const solid = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && getPx(buf, x, y)[3] !== 0;
		const bev = [];
		for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { if (!solid(x, y)) continue; let d = 0; if (!solid(x - 1, y) || !solid(x, y - 1)) d += 26; if (!solid(x + 1, y) || !solid(x, y + 1)) d -= 32; if (d) { const p = getPx(buf, x, y); bev.push([x, y, shade([p[0], p[1], p[2]], d)]); } }
		for (const [x, y, c] of bev) fill(x, y, c);
		// 1px dark outline on transparent pixels touching the shape
		const out = [];
		for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { if (solid(x, y)) continue; if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) out.push([x, y]); }
		for (const [x, y] of out) setPx(buf, x, y, [38, 32, 28, 255]);
	},
};
export function listFamilies() { return Object.keys(FAMILIES); }

// Core stone types (+ their polished_/cut_/mossy_/cobbled_/… variants) route to the
// `stone` family. Strip the decorative prefixes, then test the remaining root.
const STONE_PREFIX = /^(polished_|smooth_|chiseled_|cobbled_|cracked_|mossy_|cut_|gilded_|infested_)+/;
const STONE_ROOTS = new Set([
	'stone', 'smooth_stone', 'cobblestone', 'granite', 'diorite', 'andesite',
	'deepslate', 'tuff', 'calcite', 'dripstone_block', 'basalt',
	'blackstone', 'netherrack', 'end_stone', 'bedrock',
	'obsidian', 'crying_obsidian', 'sandstone', 'red_sandstone',
	'prismarine', 'dark_prismarine', 'mud', 'packed_mud',
]);
const isStone = (t) => STONE_ROOTS.has(t) || STONE_ROOTS.has(t.replace(STONE_PREFIX, ''));

// Granular-earth blocks (grass_block_side/snow route here for the topped-soil look).
const DIRT_ROOTS = new Set([
	'dirt', 'coarse_dirt', 'rooted_dirt', 'dirt_path', 'farmland', 'podzol', 'mycelium',
	'moss_block', 'sand', 'red_sand', 'gravel', 'clay', 'soul_sand', 'soul_soil',
	'crimson_nylium', 'warped_nylium',
]);
const isDirt = (t) => DIRT_ROOTS.has(t) || /^grass_block_(side|snow)$/.test(t) || /^suspicious_(sand|gravel)$/.test(t);
// Cross-shaped plants, flowers, and small foliage (transparent-background models).
const PLANT_SET = new Set([
	'fern', 'large_fern', 'grass', 'short_grass', 'tall_grass', 'bamboo', 'cactus', 'sugar_cane',
	'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'vine', 'cave_vines', 'cave_vines_plant',
	'glow_lichen', 'sea_pickle', 'nether_sprouts', 'crimson_fungus', 'warped_fungus',
	'crimson_roots', 'warped_roots', 'twisting_vines', 'twisting_vines_plant', 'weeping_vines',
	'weeping_vines_plant', 'hanging_roots', 'lily_pad', 'big_dripleaf', 'small_dripleaf',
	'sweet_berry_bush', 'chorus_plant', 'chorus_flower', 'pitcher_plant', 'spore_blossom',
	'pink_petals', 'dead_bush', 'azalea', 'flowering_azalea', 'brown_mushroom', 'red_mushroom', 'dandelion', 'poppy', 'blue_orchid',
	'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
	'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower',
]);
const isPlant = (t) => PLANT_SET.has(t) || /_sapling$/.test(t) || /_fern$/.test(t);
// Item-icon routing (only applied under /item/).
const isGem = (t) => /^(?:diamond|emerald|quartz|flint|clay_ball|nether_star|echo_shard|lapis_lazuli)$/.test(t) || /amethyst|prismarine_(?:shard|crystals)/.test(t);
const isDust = (t) => /^(?:redstone|glowstone_dust|blaze_powder|gunpowder|bone_meal|sugar)$/.test(t);
const isSeed = (t) => /_seeds$/.test(t) || /^(?:pitcher_pod|torchflower_seeds)$/.test(t);

/** Classify a resource path into a family (rule-ordered subset). @param {any} target */
export function classify(target) {
	const t = baseName(target); const path = String(target);
	// Particle-effect sheets are decided first (the path is unambiguous), before any block
	// rule can intercept — e.g. sculk_soul/sculk_charge must read as soul-flame particles,
	// not as the sculk block. The animated soft-blob puffs / sparks / glows become radial
	// stamps; shaped-icon and glyph sheets (heart, angry, nautilus, drip_*, damage, the
	// crit/hit sparks, the sga_* runes) are authored art and stay on the generic fallback.
	if (path.includes('/particle/')) {
		if (/^sga_[a-z]$/.test(t) || /^(?:heart|angry|nautilus|damage|critical_hit|enchanted_hit|shriek|drip_(?:fall|hang|land))$/.test(t)) return 'generic_block';
		return 'particle';
	}
	// Slab / stairs / wall / fence textures reuse the base block's look. Strip the
	// shape suffix (and its inner/outer/top/double/side/post variant) and classify the
	// base block, so andesite_stairs_inner reads as andesite, deepslate_brick_slab as
	// bricks, oak_fence_side as planks — not a flat gray fallback.
	const shape = t.match(/^(.+?)(?:_slab|_stairs|_wall|_fence)(?:_top|_bottom|_side|_double|_inner|_outer|_post)?$/);
	if (shape && shape[1]) return classify('block/' + shape[1]);
	// Buttons and pressure plates reuse their base block's texture; the weighted
	// pressure plates are metal (heavy = iron, light = gold).
	const bp = t.match(/^(.+?)_(?:button|pressure_plate)$/);
	if (bp) { const base = bp[1] === 'heavy_weighted' ? 'iron_block' : bp[1] === 'light_weighted' ? 'gold_block' : bp[1]; return classify('block/' + base); }
	if (/_spawn_egg$/.test(t)) return 'spawn_egg';
	if (/_banner$/.test(t)) return 'banner';
	if (/_stained_glass_pane(?:_top|_side)?$/.test(t) || /^glass_pane(?:_top|_side)?$/.test(t)) return 'glass_pane';
	if (/_stained_glass$/.test(t) || t === 'glass') return 'glass';
	if (/_ore$/.test(t)) return 'ore';
	if (/_planks$/.test(t)) return 'planks';
	if (/_leaves$/.test(t)) return 'leaves';
	// Brick/tile masonry, incl. singular variants (mossy_stone_brick, deepslate_tile).
	if (/_bricks?$/.test(t) || /_tiles?$/.test(t) || t === 'bricks' || t === 'brick') return 'bricks';
	if (/(_wood|_hyphae|_log)$/.test(t) || /(?:crimson|warped)_stem$/.test(t)) return 'wood';
	// Bare wood species (left by the shape strip above, e.g. oak_fence_side -> oak) and
	// the mosaic/petrified plank-material blocks take the species plank look.
	if (/^(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|crimson|warped|bamboo)(?:_mosaic)?$/.test(t) || t === 'petrified_oak') return 'planks';
	// Wood-material blocks that aren't planks/logs — stairs, fences, doors, signs,
	// etc. of a known species — take the plank look (plank-colored, not the near-gray
	// generic fallback). Species prefix + a "made of planks" suffix.
	if (/^(dark_oak|oak|spruce|birch|jungle|acacia|mangrove|cherry|bamboo|crimson|warped)_/.test(t)
		&& /(_stairs|_slab|_fence|_fence_gate|_door|_trapdoor|_pressure_plate|_button|_sign|_hanging_sign)$/.test(t)) return 'planks';
	if (isStone(t)) return 'stone';
	// Dyed / oxidized / crystalline block families.
	if (/copper/.test(t)) return 'copper';
	if (/_wool$|_carpet$/.test(t)) return 'wool';
	if (/_concrete(?:_powder)?$/.test(t)) return 'concrete';
	if (/_glazed_terracotta$|_terracotta$/.test(t) || t === 'terracotta') return 'terracotta';
	if (/candle/.test(t)) return 'candle';
	if (/sculk/.test(t)) return 'sculk';
	if (/^(?:water_overlay|water_still|water_flow)$/.test(t)) return 'water';
	if (/_ice$|^ice$/.test(t) || /^(?:snow|snow_block|powder_snow)$/.test(t)) return 'ice';
	// Smooth pale decorative blocks (block-side only; item/quartz stays a gem).
	if (/quartz|purpur/.test(t) && !path.includes('/item/')) return 'quartz';
	if (/froglight/.test(t)) return 'froglight';
	if (t === 'magma_block' || t === 'magma') return 'magma';
	// Bound / fibrous / gourd blocks and a couple of one-off decorative blocks.
	if (t === 'hay_block') return 'hay';
	if (t === 'bone_block') return 'bone';
	if (t === 'dried_kelp_block') return 'dried_kelp';
	if (t === 'honey_block') return 'honey';
	if (t === 'target') return 'target';
	if (/^(?:melon|pumpkin)(?:_side|_top)?$/.test(t)) return 'gourd';
	// One-off mineral / decorative / organic blocks.
	if (/^ancient_debris/.test(t)) return 'ancient_debris';
	if (/^lodestone/.test(t)) return 'lodestone';
	if (/^respawn_anchor/.test(t)) return 'respawn_anchor';
	if (/^reinforced_deepslate/.test(t)) return 'reinforced_deepslate';
	if (/^scaffolding/.test(t)) return 'scaffolding';
	if (/mangrove_roots(?:_side|_top)?$/.test(t)) return 'roots';
	if (/^sniffer_egg/.test(t)) return 'egg';
	if (/^pointed_dripstone/.test(t)) return 'dripstone';
	// Solid mineral / metal blocks (copper already routed above).
	if (/^(?:iron|gold|diamond|emerald|lapis|redstone|coal|netherite)_block$/.test(t) || /^raw_(?:iron|gold)_block$/.test(t) || t === 'amethyst_block' || t === 'budding_amethyst') return 'mineral_block';
	if (t === 'honeycomb_block') return 'honeycomb';
	if (t === 'sponge' || t === 'wet_sponge') return 'sponge';
	if (t === 'nether_wart_block' || t === 'warped_wart_block') return 'wart';
	if (t === 'slime_block') return 'slime';
	if (t === 'redstone_lamp') return 'redstone_lamp';
	if (/^(?:stripped_)?bamboo_block$/.test(t)) return 'wood';
	if (t === 'tinted_glass') return 'glass';
	// Log/stem end grain (rings) and grass-block top; log/stem sides use `wood`.
	if (/(?:_log|_stem|_wood|_hyphae)_top$/.test(t)) return 'log_top';
	if (t === 'grass_block_top') return 'grass';
	// Organic families: coral (species blocks/fans, incl. dead), crops, mushroom blocks,
	// granular earth, and cross-shaped plants/flowers.
	if (/(?:tube|brain|bubble|fire|horn)_coral(?:_block|_fan|_wall_fan)?$/.test(t) || /coral/.test(t) && /^dead_/.test(t)) return 'coral';
	if (/^(?:wheat|carrots|potatoes|beetroots|nether_wart|torchflower_crop|pitcher_crop)$/.test(t)) return 'crop';
	if (/(?:red|brown)_mushroom_block$/.test(t) || t === 'mushroom_stem') return 'mushroom';
	if (isDirt(t)) return 'dirt';
	if (/^(?:large_)?fern(?:_(?:top|bottom))?$/.test(t) || isPlant(t)) return 'plant';
	// Machines & utility blocks: furnaces, redstone components, crafting stations, storage,
	// command/tech blocks and iron fixtures. An explicit allowlist (not a broad pattern) so
	// authored art — heads, rails, torches, potted plants, portals — is not swept in.
	if (/^(?:furnace|blast_furnace|smoker|dispenser|dropper|crafter|hopper|observer|piston|sticky_piston|piston_head|moving_piston|comparator|repeater|daylight_detector|crafting_table|cartography_table|fletching_table|smithing_table|loom|lectern|jukebox|note_block|bookshelf|chiseled_bookshelf|barrel|composter|beehive|bee_nest|brewing_stand|enchanting_table|grindstone|stonecutter|anvil|chipped_anvil|damaged_anvil|cauldron|water_cauldron|lava_cauldron|powder_snow_cauldron|bell|conduit|lantern|soul_lantern|chain|iron_bars|iron_door|iron_trapdoor|decorated_pot|command_block|chain_command_block|repeating_command_block|structure_block|structure_void|jigsaw|spawner|trial_spawner)$/.test(t)) return 'machine';
	// Item icons: ingots, nuggets, gems, raw ore / coal, dust, seeds, rods.
	if (path.includes('/item/')) {
		if (/^(?:wooden|stone|iron|golden|diamond|netherite)_(?:sword|pickaxe|axe|shovel|hoe)$/.test(t)) return 'tool';
		if (/_ingot$/.test(t)) return 'ingot';
		if (/_nugget$/.test(t)) return 'nugget';
		if (isGem(t)) return 'gem';
		if (/^raw_(?:iron|gold|copper)$/.test(t) || t === 'coal' || t === 'charcoal') return 'mineral';
		if (isDust(t)) return 'dust';
		if (isSeed(t)) return 'seeds';
		if (t === 'stick' || /_rod$/.test(t)) return 'rod';
		return 'generic_item';
	}
	return 'generic_block';
}

/**
 * Build a texture as an RGBA pixel buffer. Preset lane: pass `family`/`target`.
 * Compositional lane: pass an ordered `ops` list (overrides family).
 * @param {{family?:string, ops?:{op:string,params?:object}[], target?:string, name?:string, seed?:string, size?:number, palette?:string, params?:object}} spec
 * @returns {PixelBuffer}
 */
export function generateTexture(spec) {
	const size = spec.size && spec.size > 0 ? Math.floor(spec.size) : SIZE_DEFAULT;
	const buf = createBuffer(size, size);
	const r = rng(spec.seed || spec.target || spec.name || 'seed');
	if (Array.isArray(spec.ops) && spec.ops.length) {
		for (const step of spec.ops) { const fn = OPS[step.op]; if (fn) fn(buf, step.params || {}, r); }
	} else {
		const named = spec.family && FAMILIES[spec.family] ? spec.family : spec.target ? classify(spec.target) : spec.family || 'generic_block';
		const fn = FAMILIES[named] || FAMILIES.generic_block;
		fn(buf, { name: baseName(spec.target || spec.name || named), palette: spec.palette, params: spec.params }, r);
	}
	return buf;
}
