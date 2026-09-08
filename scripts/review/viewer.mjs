// Copyright (C) 2026 Jacob Repp
// SPDX-License-Identifier: GPL-3.0-or-later
import * as THREE from 'three';
const cohort=JSON.parse(document.querySelector('#cohort-data').textContent);
const $=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const decisions={}, renderers=[];
let angle='iso', display='studio';
function download(name,value,type='application/json') {
    const url=URL.createObjectURL(new Blob([value],{type})),link=$('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.querySelector('#title').textContent=cohort.title;
document.querySelector('#description').textContent=cohort.description;
document.querySelector('#count').textContent=`${cohort.entries.length} assets · ${cohort.snapshot.slice(0,10)}`;
document.querySelector('#export').onclick=()=>download(`${cohort.id}-decisions.json`,JSON.stringify({schema:1,cohort:cohort.id,snapshot:cohort.snapshot,renderer:cohort.renderer,acceptance:'review-notes-only',entries:cohort.entries.map(e=>({id:e.id,snapshot:e.snapshot,dependencies:e.dependencies,...decisions[e.id]}))},null,2));
document.querySelector('#view').onchange=e=>{angle=e.target.value;renderers.forEach(r=>r.draw());};
document.querySelector('#display').onchange=e=>{display=e.target.value;renderers.forEach(r=>r.rebuild());};
const textureCache=new Map();
async function getTexture(texture) {
    if (!textureCache.has(texture.target)) {
        const map=await new THREE.TextureLoader().loadAsync(texture.data);
        map.magFilter=THREE.NearestFilter;map.minFilter=THREE.NearestFilter;map.generateMipmaps=false;map.encoding=THREE.sRGBEncoding;
        textureCache.set(texture.target,map);
    }
    return textureCache.get(texture.target);
}
function defaultUV(el,dir) {
    const [x,y,z]=el.from,[X,Y,Z]=el.to;
    return {north:[16-X,16-Y,16-x,16-y],south:[x,16-Y,X,16-y],east:[16-Z,16-Y,16-z,16-y],west:[z,16-Y,Z,16-y],up:[x,z,X,Z],down:[x,16-Z,X,16-z]}[dir];
}
function geometry(el,dir,face) {
    const [x,y,z]=el.from,[X,Y,Z]=el.to;
    const corners={north:[[x,y,z],[x,Y,z],[X,Y,z],[X,y,z]],south:[[X,y,Z],[X,Y,Z],[x,Y,Z],[x,y,Z]],
        east:[[X,y,z],[X,Y,z],[X,Y,Z],[X,y,Z]],west:[[x,y,Z],[x,Y,Z],[x,Y,z],[x,y,z]],
        up:[[x,Y,z],[x,Y,Z],[X,Y,Z],[X,Y,z]],down:[[x,y,Z],[x,y,z],[X,y,z],[X,y,Z]]}[dir];
    const [u,v,U,V]=face.uv || defaultUV(el,dir);
    const uv=(dir==='up'||dir==='down')?[[u/16,1-v/16],[u/16,1-V/16],[U/16,1-V/16],[U/16,1-v/16]]:[[U/16,1-V/16],[U/16,1-v/16],[u/16,1-v/16],[u/16,1-V/16]];
    const shift=(face.rotation || 0)/90;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(corners.flat(),3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv.map((_,i)=>uv[(i+shift)%4]).flat(),2));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return g;
}
function modelGroup(model,maps) {
    const group=new THREE.Group();
    for (const el of model.elements) {
        const element=new THREE.Group();
        for (const [dir,face] of Object.entries(el.faces)) {
            const material=new THREE.MeshLambertMaterial({map:maps.get(face.texture),alphaTest:0.1,side:THREE.FrontSide});
            if (el.shade===false) {material.emissive.set(0xffffff);material.emissiveMap=maps.get(face.texture);material.color.set(0x000000);}
            element.add(new THREE.Mesh(geometry(el,dir,face),material));
        }
        if (el.rotation) {
            const r=el.rotation,origin=new THREE.Vector3(...r.origin);element.children.forEach(mesh=>mesh.position.sub(origin));element.position.copy(origin);
            element.rotation[r.axis]=THREE.MathUtils.degToRad(r.angle);
            if(r.rescale)for(const axis of ['x','y','z'])if(axis!==r.axis)element.scale[axis]=1/Math.cos(THREE.MathUtils.degToRad(r.angle));
        }
        group.add(element);
    }
    for (const [i,layer] of (model.layers || []).entries()) {
        const plane=new THREE.Mesh(new THREE.PlaneGeometry(16,16),new THREE.MeshBasicMaterial({map:maps.get(layer),alphaTest:0.1,side:THREE.DoubleSide}));
        plane.position.set(8,8,8+i*0.02);group.add(plane);
    }
    const centered=new THREE.Group();group.position.set(-8,-8,-8);centered.add(group);
    centered.rotation.set(-THREE.MathUtils.degToRad(model.x || 0),-THREE.MathUtils.degToRad(model.y || 0),0,'YXZ');
    if (display!=='studio') {
        const transform=model.display?.[display];
        if(transform){const wrapper=new THREE.Group();wrapper.add(centered);wrapper.rotation.set(...(transform.rotation || [0,0,0]).map(THREE.MathUtils.degToRad));wrapper.position.fromArray(transform.translation || [0,0,0]);wrapper.scale.fromArray(transform.scale || [1,1,1]);return wrapper;}
    }
    return centered;
}
async function card(entry,index) {
    const card=$('article','card');card.dataset.id=entry.id;
    const head=$('div','card-head');head.append($('span','number',String(index+1).padStart(2,'0')),$('h2','',entry.name));card.append(head,$('p','focus',entry.focus));
    const stage=$('div','stage');card.append(stage);
    const viewSelect=$('select','state');viewSelect.setAttribute('aria-label',`${entry.name} state`);
    entry.views.forEach((v,i)=>{const option=$('option','',v.label);option.value=i;viewSelect.append(option);});
    if(entry.views.length)card.append(viewSelect);
    const diagnostics=$('div','diagnostics');
    entry.issues.forEach(i=>diagnostics.append($('p','error',i)));
    entry.warnings.forEach(i=>diagnostics.append($('p','warning',i)));
    if(entry.activeFeedback.length)diagnostics.append($('p','warning','Open scene feedback · '+entry.activeFeedback.map(f=>f.id).join(', ')));
    card.append(diagnostics);
    const swatches=$('div','swatches');
    entry.textures.forEach(tex=>{
        const figure=$('figure','swatch'),image=$('img');image.src=tex.data;image.alt=tex.target;image.width=48;image.height=48;
        figure.append(image,$('figcaption','',tex.target.split('/').at(-1)));figure.tabIndex=0;figure.title='Inspect texture and tiling';
        const inspect=()=>{
            const dialog=document.querySelector('dialog'),body=dialog.querySelector('.texture-detail');body.replaceChildren($('h2','',tex.target.split('/').at(-1)));
            const native=$('img','native');native.src=tex.data;native.width=tex.width;native.height=tex.height;
            const large=$('img','enlarged');large.src=tex.data;large.alt=tex.target;
            const tile=$('div','tiled');tile.style.backgroundImage=`url("${tex.data}")`;tile.style.backgroundSize=`${tex.width*4}px ${tex.height*4}px`;
            body.append($('p','',`${tex.width} × ${tex.height} · original pixels, enlarged, and repeated`),native,large,tile);dialog.showModal();
        };
        figure.onclick=inspect;figure.onkeydown=e=>{if(e.key==='Enter')inspect();};swatches.append(figure);
    });
    card.append(swatches);
    const controls=$('div','decision'),status=$('select');status.setAttribute('aria-label',`${entry.name} review decision`);
    for(const [value,label] of [['unreviewed','Unreviewed'],['looks-good','Looks good in sheet'],['needs-work','Needs work'],['in-game-check','Needs in-game check']]){const option=$('option','',label);option.value=value;status.append(option);}
    const note=$('textarea');note.placeholder='What should change?';note.setAttribute('aria-label',`${entry.name} review notes`);
    decisions[entry.id]={status:'unreviewed',note:''};status.onchange=()=>{decisions[entry.id].status=status.value;card.dataset.decision=status.value;};note.oninput=()=>decisions[entry.id].note=note.value;
    controls.append(status,note);card.append(controls);
    const details=$('details'),summary=$('summary','','Source and validation');details.append(summary);for(const source of entry.sources || []){details.append($('p','',`${source.source} · ${source.group || 'family source'}`));if(source.data){const link=$('a','','Download editable Blockbench source');link.href=source.data;link.download=source.source.split('/').at(-1);details.append(link);}}details.append($('p','',entry.reviewSummary),$('code','',entry.id),$('pre','',entry.dependencies.map(d=>`${d.target}\n${d.sha256}`).join('\n')));card.append(details);
    document.querySelector('#cards').append(card);
    if(!entry.views.length){stage.append($('span','empty',entry.kind==='texture'?'Texture review':'Preview unavailable'));return;}
    try {
        const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(360,240);renderer.outputEncoding=THREE.sRGBEncoding;
        stage.append(renderer.domElement);renderer.domElement.setAttribute('aria-label',`${entry.name} model preview`);
        const maps=new Map();for(const tex of entry.textures)maps.set(tex.target,await getTexture(tex));
        const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,0.75));const light=new THREE.DirectionalLight(0xffffff,0.55);light.position.set(-30,50,40);scene.add(light);
        const camera=new THREE.OrthographicCamera(-24,24,16,-16,0.1,200);let object,drag=0;
        const draw=()=>{
            const position=display!=='studio'?[0,0,55]:{iso:[32,24,36],front:[0,0,55],back:[0,0,-55],side:[55,0,0],top:[0,55,0.001]}[angle];
            camera.position.fromArray(position);camera.lookAt(0,0,0);object.rotation.y=drag;renderer.render(scene,camera);
        };
        const transformNotice=$('p','warning');diagnostics.append(transformNotice);
        const rebuild=()=>{
            transformNotice.textContent=display!=='studio' && entry.views[Number(viewSelect.value)].models.some(m=>!m.display?.[display])?'This display transform is absent from the source; preview uses identity.':'';
            if(object){scene.remove(object);object.traverse(n=>{if(n.isMesh){n.geometry.dispose();n.material.dispose();}});}
            object=new THREE.Group();for(const model of entry.views[Number(viewSelect.value)].models)object.add(modelGroup(model,maps));scene.add(object);draw();
        };
        viewSelect.onchange=rebuild;
        let pointer;
        renderer.domElement.onpointerdown=e=>{pointer=e.clientX;renderer.domElement.setPointerCapture(e.pointerId);};
        renderer.domElement.onpointermove=e=>{if(pointer!==undefined){drag+=(e.clientX-pointer)*0.01;pointer=e.clientX;draw();}};
        renderer.domElement.onpointerup=()=>pointer=undefined;renderer.domElement.onpointercancel=()=>pointer=undefined;
        const save=$('button','save-image','Save view');save.onclick=()=>{draw();const link=$('a');link.href=renderer.domElement.toDataURL('image/png');link.download=entry.id.replace(':','-')+'.png';link.click();};stage.append(save);
        rebuild();renderers.push({draw,rebuild});card.dataset.rendered='true';
    } catch(error) {stage.replaceChildren($('span','error',`Preview failed: ${error.message}`));card.dataset.rendered='failed';}
}
document.querySelector('dialog button').onclick=()=>document.querySelector('dialog').close();
(async()=>{for(const [i,entry] of cohort.entries.entries())await card(entry,i);document.body.dataset.ready='true';})();
