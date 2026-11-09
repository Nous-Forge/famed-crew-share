'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),fixture=path.resolve(process.argv[3]||path.join(__dirname,'fixtures/captain-calm-final14'));
const shared=path.join(root,'content-pipeline/shared');
const {loadRuntimeContext}=require(path.join(shared,'load-runtime-context.cjs'));
const G=require(path.join(shared,'generate-content.cjs')),S=require(path.join(shared,'semantic-text.cjs')),F=require(path.join(shared,'full-fight-consumer.cjs'));
const data=JSON.parse(fs.readFileSync(path.join(shared,'content.v2.json')));
const design=loadRuntimeContext(root),altered=loadRuntimeContext(root,{ragRoot:fixture});
function generate(d){const a=G.generateArtifacts(data,d);a['crew-dialogue.json']=S.generateCrewDialogue(d);a['card-text.json'].forEach(c=>c.prototypeText=S.renderPrototypeText(data.cards.find(p=>p.id===c.id)));return a;}
const baseline=generate(design),variant=generate(altered),results=[];
function test(name,fn){fn();results.push({name,result:'PASS'});}
test('source change affects four Captain lines and leaves twelve other lines and card/boss values unchanged',()=>{
 assert.notDeepEqual(baseline['crew-dialogue.json'][0].voice,variant['crew-dialogue.json'][0].voice);
 for(let i=1;i<4;i++)assert.deepEqual(baseline['crew-dialogue.json'][i].voice,variant['crew-dialogue.json'][i].voice);
 assert.deepEqual(baseline['card-text.json'],variant['card-text.json']);assert.deepEqual(baseline['boss-rules.json'],variant['boss-rules.json']);
 assert.equal(S.reviewSemanticArtifacts(variant,data,altered).verdict,'PASS');
});
test('false tooltip and unsupported loot dialogue are caught and exact source-backed repair passes',()=>{
 const a=structuredClone(baseline);a['card-text.json'][0].prototypeText='Deal 999 damage.';a['crew-dialogue.json'][3].voice.win='Take the gold and spoils.';
 const r=S.repairSemanticArtifacts(a,data,design);assert.equal(r.before.verdict,'HOLD');assert.equal(r.after.verdict,'PASS');assert.equal(r.changes.length,2);
});
test('unknown speaker and unsupported loss event require review',()=>{
 for(const mutate of [a=>a['crew-dialogue.json'][0].role='Unknown',a=>a['crew-dialogue.json'][0].voice.loss='We lost.']){
 const a=structuredClone(baseline);mutate(a);assert.equal(S.repairSemanticArtifacts(a,data,design).blocked,true);}
});
const runs=path.join(shared,'runs-v4');const run=fs.readdirSync(runs).sort().at(-1),folder=path.join(runs,run);
let fights;
test('clean extracted entrypoint outputs drive both complete encounters with all four perks and correct terminal dialogue',()=>{
 fights=F.consumeFullFights(folder,{rootDir:root});assert.equal(fights.win.winner,'crew');assert.equal(fights.loss.winner,'boss');
 assert.deepEqual([...fights.win.perkRolesObserved].sort(),['Captain','Lorekeeper','Pathfinder','Vaultwarden']);
 assert.equal(fights.loss.dialogueCounts.win,0);assert.equal(fights.loss.dialogueCounts.loss,0);
});
const result={result:'PASS',root,tests:results,sourceChange:{baseline:design.ragManifest,variant:altered.ragManifest},fights};
const out=path.join(root,'integrated-verification-'+Date.now()+'.json');fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({result:'PASS',tests:results.length,evidence:out,winRound:fights.win.terminalRound,lossRound:fights.loss.terminalRound}));
