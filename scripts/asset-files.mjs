// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {createHash} from 'node:crypto';
import {resolve, relative, isAbsolute} from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function containedPath(root, target) {
    if (typeof target !== 'string' || !target || target.includes('\\') || isAbsolute(target) || target.split('/').includes('..')) {
        throw new Error(`Invalid relative target: ${target}`);
    }
    const path = resolve(root, target), rel = relative(resolve(root), path);
    if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`Target escapes pack: ${target}`);
    return path;
}

