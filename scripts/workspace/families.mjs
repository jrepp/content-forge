// Copyright (C) 2026 Jacob Repp; SPDX-License-Identifier: GPL-3.0-or-later
import {validateFamily as validateItems} from '../../producers/blockbench/item-family.mjs';

export function capabilities(family) {
    return {edit: true, candidateExport: family.codec === 'java_block', animationReview: family.kind === 'animated_entity'};
}

export function validateWorkspaceFamily(family) {
    if (family.kind === undefined || family.kind === 'items') return validateItems(family);
    if (family.schema !== 1 || family.kind !== 'animated_entity' || family.codec !== 'free' ||
        !/^[a-z0-9-]+$/.test(family.id || '') || typeof family.title !== 'string' || !family.title.trim() ||
        typeof family.approach !== 'string' ||
        family.source !== `producers/blockbench/entities/${family.id}/source.bbmodel` ||
        !Array.isArray(family.members) || family.members.length !== 1 || family.members[0]?.id !== family.id ||
        Object.keys(family.members[0]).some(key => key !== 'id')) {
        throw new Error('Invalid animated entity definition; consumer export targets are not supported yet');
    }
}
