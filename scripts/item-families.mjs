// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {repoRoot} from './config.mjs';
export function itemFamily(target) {
    const name=target.split('/').at(-1).replace(/\.json$/,'');
    for(const family of ['pickaxe','shovel','sword','axe','hoe'])if(name.endsWith('_'+family))return 'tools/'+family;
    if (/^(bow|crossbow|fishing_rod|shield|trident|clock|compass|recovery_compass|spyglass)$/.test(name)) return 'stateful/'+name;
    if (name.endsWith('_ingot')) return 'materials/ingots';
    if (name.endsWith('_nugget')) return 'materials/nuggets';
    if (name.endsWith('_spawn_egg')) return 'layered/spawn-eggs';
    if (/_(helmet|chestplate|leggings|boots)$/.test(name)) return 'equipment/armor';
    if (/(boat|raft)$/.test(name)) return 'transport/boats';
    if (/(potion|tipped_arrow)$/.test(name)) return 'layered/potions-arrows';
    if (/_(slab|stairs|wall|fence|fence_gate|planks|log|wood|leaves|button|door|trapdoor)$/.test(name)) return 'block-items/derived';
    return 'unclassified';
}
export function planFamilies(queue) {
    const groups=new Map();
    for(const e of queue.entries || [])if(e.target.includes('/models/item/')&&e.disposition!=='resolved') {
        const family=itemFamily(e.target);if(!groups.has(family))groups.set(family,[]);groups.get(family).push(e);
    }
    return {schema:1,queueFingerprint:queue.fingerprint,scope:'Routing candidates; family assignment requires review, especially unclassified and stateful items',
        families:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([family,entries])=>({family,count:entries.length,
            batches:Array.from({length:Math.ceil(entries.length/6)},(_,i)=>entries.slice(i*6,i*6+6).map(e=>({id:e.resource,target:e.target,disposition:e.disposition,candidates:e.candidates || []})))}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
    const result=planFamilies(JSON.parse(readFileSync(join(repoRoot,'work/queue.json'),'utf8')));
    mkdirSync(join(repoRoot,'work'),{recursive:true});writeFileSync(join(repoRoot,'work/item-families.json'),JSON.stringify(result,null,2)+'\n');
    for(const family of result.families)console.log(`${family.family.padEnd(30)} ${family.count} items / ${family.batches.length} review sets`);
}
