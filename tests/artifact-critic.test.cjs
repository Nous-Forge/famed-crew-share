'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const data=require('../content-pipeline/shared/content.v2.json');
const C=require('../content-pipeline/shared/artifact-critic.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
// Unit fixtures exercise the critic. Source-extraction integrity is tested by
// the package runner separately; these retained source columns are test inputs.
const design={pins:clone(data.claims),cardSources:data.cards.map(c=>({id:c.id,display_name:c.src.display_name,D_text:c.src.D_text,provenance:{fixture:'retained original CSV columns'}}))};
function clean(){return {
  'card-text.json':data.cards.map(c=>({id:c.id,name:c.src.display_name,printedSourceText:c.src.D_text,readablePrintedText:C.normalizePrintedText(c.src.D_text),prototypeText:'Prototype: '+c.text,digitalEffect:clone(c.effect),digitalCost:c.cost,digitalTarget:c.target,digitalType:c.type,prototypeFields:clone(c.prototype_fields),sourceStatus:'Printed source plus labeled digital prototype',sourceEvidence:{id:c.id}})),
  'crew-dialogue.json':data.crew.map(c=>({role:c.role,description:c.description,voice:clone(c.voice),sourceStatus:'Prepared role dialogue',sourceEvidence:{role:c.role}})),
  'boss-rules.json':{boss:clone(data.boss),rules:clone(data.rules),sourceStatus:'Digital prototype',sourceEvidence:{design:'fixture'}}
};}
test('all generated artifacts pass exact source and declared structural checks',()=>{
  const report=C.reviewArtifacts(clean(),data,design);
  assert.equal(report.verdict,'PASS');assert.ok(report.checks>220);assert.equal(report.findings.length,0);
});
test('actual printed text and boss fields are rejected, repaired and rechecked without mutating drafts',()=>{
  const draft=clean();draft['card-text.json'][0].printedSourceText='Invented source effect';draft['boss-rules.json'].boss.name='Bauglor';
  const before=clone(draft),result=C.repairArtifacts(draft,data,design);
  assert.equal(result.before.verdict,'HOLD');assert.equal(result.before.findings.length,2);
  assert.equal(result.after.verdict,'PASS');assert.equal(result.changes.length,2);assert.equal(result.blocked,false);
  assert.deepEqual(draft,before);assert.equal(result.artifacts['card-text.json'][0].printedSourceText,design.cardSources[0].D_text);assert.equal(result.artifacts['boss-rules.json'].boss.name,'Ogre');
});
test('card printed text is checked against original source evidence, not an altered prototype snapshot',()=>{
  const altered=clone(data);altered.cards[0].printedText='Altered prepared text';
  const artifacts=clean();artifacts['card-text.json'][0].printedSourceText='Altered prepared text';
  const result=C.repairArtifacts(artifacts,altered,design);
  assert.equal(result.artifacts['card-text.json'][0].printedSourceText,design.cardSources[0].D_text);assert.equal(result.after.verdict,'PASS');
});
test('unknown speaker blocks release and all automatic repair rather than inventing a mapping',()=>{
  const draft=clean();draft['crew-dialogue.json'][0].role='Invented speaker';draft['boss-rules.json'].boss.name='Bauglor';
  const result=C.repairArtifacts(draft,data,design);
  assert.equal(result.blocked,true);assert.equal(result.changes.length,0);assert.deepEqual(result.artifacts,draft);
  assert.ok(result.before.findings.some(f=>f.code==='unknown-role'&&!f.repairable));
});
test('missing and duplicate card records are held',()=>{
  for(const mutate of [x=>x.pop(),x=>x[1]=clone(x[0])]){
    const draft=clean();mutate(draft['card-text.json']);const result=C.repairArtifacts(draft,data,design);
    assert.equal(result.blocked,true);assert.equal(result.changes.length,0);
  }
});
test('explicit prototype cost, target, type and effects are repaired from labeled configuration',()=>{
  const draft=clean(),card=draft['card-text.json'][0];card.digitalCost=999;card.digitalTarget='unverified';card.digitalType='invented';card.digitalEffect={damage:999};
  const result=C.repairArtifacts(draft,data,design);
  assert.equal(result.blocked,false);assert.equal(result.changes.length,4);assert.equal(result.after.verdict,'PASS');
});
test('unsupported boss rule fields and excessive dialogue are held',()=>{
  for(const mutate of [x=>x['boss-rules.json'].boss.secretPower=999,x=>x['crew-dialogue.json'][0].voice.start='x'.repeat(161)]){
    const draft=clean();mutate(draft);const result=C.repairArtifacts(draft,data,design);assert.equal(result.blocked,true);assert.equal(result.changes.length,0);
  }
});
test('missing source and review metadata are held',()=>{
  const missingDesign={...design,cardSources:[]};assert.equal(C.reviewArtifacts(clean(),data,missingDesign).verdict,'HOLD');
  const draft=clean();delete draft['card-text.json'][0].sourceEvidence;assert.equal(C.repairArtifacts(draft,data,design).blocked,true);
});
test('malformed source contracts fail closed as HOLD',()=>{
  for(const bad of [null,{}, {...design,pins:{}},{...design,cardSources:[null,...design.cardSources.slice(1)]}]){
    assert.equal(C.reviewArtifacts(clean(),data,bad).verdict,'HOLD');
  }
  assert.equal(C.repairArtifacts(undefined,data,design).blocked,true);
});
