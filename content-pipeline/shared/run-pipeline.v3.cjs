'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadDesign}=require('./source-connection.cjs');
const {generateArtifacts}=require('./generate-content.cjs');
const C=require('./artifact-critic.cjs'),P=require('./pipeline.v2.js');
const root=path.resolve(__dirname,'../..'),args=process.argv.slice(2);
if(args.some(a=>a!=='--demo-faults')||new Set(args).size!==args.length)throw Error('Usage: node run-content.cjs [--demo-faults]');
const demo=args.includes('--demo-faults'),events=[];
function event(stage){events.push({stage,at:new Date().toISOString()});}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
event('Read and verify GDD and original card-source evidence');
const design=loadDesign(root);
const inputBytes=fs.readFileSync(path.join(__dirname,'content.v2.json')),data=JSON.parse(inputBytes);
const errors=P.validate(data);if(errors.length)throw Error(errors.join(', '));
data.claims=design.pins;
const sourceCheck=P.critic(data,[{key:'boss.name',value:data.boss.name},{key:'crew.roles',value:data.crew.map(c=>c.role)},{key:'prototype.handSize',value:data.rules.handSize}]);
if(sourceCheck.some(c=>c.verdict!=='accepted'))throw Error('Prototype configuration contradicts packaged design');
event('Generate three draft content files from verified source rows and explicit writing templates');
const drafts=generateArtifacts(data,design);
if(demo){drafts['boss-rules.json'].boss.name='Bauglor';drafts['card-text.json'][0].printedSourceText='Deal 999 damage. Invented demonstration text.';event('Deliberately alter two actual draft fields for the documented critic demonstration');}
const out=path.join(__dirname,'runs-v3',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(path.join(out,'drafts'),{recursive:true});
function write(relative,value){const file=path.join(out,relative);fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
const names=Object.keys(drafts);
for(const name of names)write(path.join('drafts',name),drafts[name]);
function readSet(folder){return Object.fromEntries(names.map(name=>[name,JSON.parse(fs.readFileSync(path.join(out,folder,name),'utf8'))]));}
event('Read the retained draft files from disk and inspect their actual fields');
const retainedDrafts=readSet('drafts'),repair=C.repairArtifacts(retainedDrafts,data,design);
write('critic-before.json',repair.before);
write('repairs.json',repair.changes);
if(repair.blocked){write('review-required.json',{result:'HOLD',findings:repair.before.findings,limits:C.LIMITS});throw Error('Content held for review; no final outputs released. See '+out);}
event('Repair only fields supported by exact source evidence; preserve original drafts');
for(const name of names)write(name,repair.artifacts[name]);
event('Re-read final files from disk and run the artifact critic again');
const final=C.reviewArtifacts(readSet(''),data,design);
write('critic-after.json',final);
if(final.verdict!=='PASS')throw Error('Final file recheck failed; do not consume this run: '+out);
event('Release the three source-checked output files');
write('critic-trace.json',{schemaVersion:3,mode:demo?'explicit fault demonstration':'normal generation',demoFaults:demo,
  input:{path:'content-pipeline/shared/content.v2.json',sha256:sha(inputBytes)},
  designSources:design.sources,designProvenance:design.provenance,cardSourceProvenance:design.cardSourceProvenance,
  sourceCheck,events,before:repair.before,changes:repair.changes,after:final,
  outputSha256:Object.fromEntries(names.map(name=>[name,sha(fs.readFileSync(path.join(out,name)))])),
  modelCalls:0,limits:C.LIMITS,generationLimits:'Source normalization, explicit authored dialogue templates and prototype configuration assembly; no fresh model generation. Unresolved card source variables are retained, not invented.'});
console.log(out);
