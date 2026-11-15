'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assess,repair}=require('../lib/ai/quality.cjs');
const {PROFILES,ranges,cleanPlan,localPlan}=require('../lib/ai/engine.cjs');
const {DEFAULT}=require('../lib/studio3.cjs'),{catalog}=require('../lib/textures.cjs');
const context={profile:'strong',seed:123,analysis:{meanLuma:100,audio:{available:false}},audioAllowed:false,geometryAllowed:false,timeAllowed:false,textures:catalog,settingsRanges:ranges('strong'),...PROFILES.strong};
const trial=(effect=5)=>({analysis:{mae:{mean:10},ssim:{mean:0.9}},controlAnalysis:{mae:{mean:effect}},newBlack:false,newFlicker:false,audioClipping:false});
test('strong requires measurable effects independently of quality; invalid metrics fail closed',()=>{
 assert.deepEqual(assess(trial(.1),PROFILES.strong).issues.map(x=>x.code),['weak']);
 assert.equal(assess(trial(5),PROFILES.strong).eligible,true);
 const r=trial();r.analysis.ssim.mean=.5;r.audioClipping=true;
 assert.deepEqual(assess(r,PROFILES.strong).issues.map(x=>x.code),['ssim','audio']);
 r.analysis.ssim.mean=NaN;assert.equal(assess(r,PROFILES.strong).issues[0].code,'measurement');
});
test('strong styles differ; no geometry, speed or audio without permission',()=>{
 const plans=cleanPlan(localPlan(context),context,{},123);assert.equal(plans.length,3);
 assert.equal(new Set(plans.map(p=>JSON.stringify(p.settings.layers.map(l=>[l.textureId,l.opacity,l.mode])))).size,3);
 for(const p of plans){assert.equal(p.settings.scale,100);assert.equal(p.settings.speed,1);assert.equal(p.settings.volume,DEFAULT.volume);assert.ok(p.settings.layers.length<=3);assert.ok(p.settings.layers.every(l=>l.opacity>=10));}
 const allowed={...context,geometryAllowed:true};assert.equal(cleanPlan(localPlan(allowed),allowed,{},123)[2].settings.scale,105);
});
test('audio repair does not weaken image; weak image repair preserves permissions and noise',()=>{
 const c=cleanPlan(localPlan(context),context,{},123)[0];
 const fixed=repair(c,[{code:'audio'}],{...context,audioAllowed:true},DEFAULT);
 assert.equal(fixed.settings.contrast,c.settings.contrast);assert.deepEqual(fixed.settings.layers,c.settings.layers);assert.ok(fixed.settings.volume<c.settings.volume);
 const weak=repair(c,[{code:'weak'}],context,DEFAULT);
 assert.equal(weak.settings.scale,100);assert.equal(weak.settings.pixel,c.settings.pixel);assert.equal(weak.settings.speed,1);
 assert.ok(weak.settings.layers[0].opacity>c.settings.layers[0].opacity);
 assert.equal(c.settings.layers[0].opacity,14);
 assert.equal(repair(c,[{code:'audio'}],context,DEFAULT),null);
 assert.equal(repair(c,[{code:'measurement'}],context,DEFAULT),null);
});
test('quality repair keeps required strength and does not treat missing data as success',()=>{
 const c=cleanPlan(localPlan({...context,geometryAllowed:true}),{...context,geometryAllowed:true},{},123)[2];
 const fixed=repair(c,[{code:'ssim'}],context,DEFAULT);
 assert.equal(fixed.settings.scale,102.5);assert.equal(PROFILES.strong.minEffectMAE,4);
 assert.equal(assess(trial(.1),PROFILES.strong).eligible,false);
});
test('safety errors remain blocking even when visual strength is sufficient',()=>{
 for(const key of ['newBlack','newFlicker','audioClipping']){const r=trial(14);r[key]=true;assert.equal(assess(r,PROFILES.strong).eligible,false);}
});
