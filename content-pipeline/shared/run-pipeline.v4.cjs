'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadRuntimeContext}=require('./load-runtime-context.cjs');
const {generateArtifacts}=require('./generate-content.cjs');
const C=require('./artifact-critic.cjs'),S=require('./semantic-text.cjs'),P=require('./pipeline.v2.js');
const root=path.resolve(__dirname,'../..'),args=process.argv.slice(2);
if(args.some(a=>a!=='--demo-faults')||new Set(args).size!==args.length)throw Error('Usage: node run-content.cjs [--demo-faults]');
const demo=args.includes('--demo-faults'),events=[];
const event=stage=>events.push({stage,at:new Date().toISOString()});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
event('Verify pinned design and retrieve current role identity and writing direction from local RAG');
const design=loadRuntimeContext(root);
const inputBytes=fs.readFileSync(path.join(__dirname,'content.v2.json')),data=JSON.parse(inputBytes);
const errors=P.validate(data);if(errors.length)throw Error(errors.join(', '));
data.claims=design.pins;
const sourceCheck=P.critic(data,[{key:'boss.name',value:data.boss.name},{key:'crew.roles',value:data.crew.map(c=>c.role)},{key:'prototype.handSize',value:data.rules.handSize}]);
if(sourceCheck.some(c=>c.verdict!=='accepted'))throw Error('Prototype configuration contradicts packaged design');
event('Generate three files using verified cards, retrieved role directions and labeled prototype configuration');
const drafts=generateArtifacts(data,design);
for(let i=0;i<data.cards.length;i++)drafts['card-text.json'][i].prototypeText=S.renderPrototypeText(data.cards[i]);
drafts['crew-dialogue.json']=S.generateCrewDialogue(design);
if(demo){
 drafts['boss-rules.json'].boss.name='Bauglor';
 drafts['card-text.json'][0].printedSourceText='Deal 999 damage. Invented demonstration text.';
 drafts['card-text.json'][0].prototypeText='Digital prototype: deal 999 damage.';
 drafts['crew-dialogue.json'].find(c=>c.role==='Vaultwarden').voice.win='Count the crew before the spoils.';
 event('Introduce four explicit actual-file faults: identity, printed source, tooltip meaning and unsupported loot');
}
const out=path.join(__dirname,'runs-v4',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(path.join(out,'drafts'),{recursive:true});
function write(relative,value){fs.writeFileSync(path.join(out,relative),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
const names=Object.keys(drafts);
for(const name of names)write(path.join('drafts',name),drafts[name]);
const readSet=folder=>Object.fromEntries(names.map(name=>[name,JSON.parse(fs.readFileSync(path.join(out,folder,name),'utf8'))]));
const retained=readSet('drafts');
const beforeStructure=C.reviewArtifacts(retained,data,design),beforeSemantics=S.reviewSemanticArtifacts(retained,data,design);
const combine=(a,b)=>({verdict:a.verdict==='PASS'&&b.verdict==='PASS'?'PASS':'HOLD',checks:a.checks+b.checks,findings:[...a.findings,...b.findings],structure:a,semantics:b});
const before=combine(beforeStructure,beforeSemantics);write('critic-before.json',before);
const structural=C.repairArtifacts(retained,data,design);
const semantic=S.repairSemanticArtifacts(structural.artifacts,data,design);
const changes=[...structural.changes,...semantic.changes];write('repairs.json',changes);
if(structural.blocked||semantic.blocked){write('review-required.json',{result:'HOLD',before,limits:[C.LIMITS,S.LIMITS]});throw Error('Content held; no final outputs released: '+out);}
event('Repair only evidence-backed fields, preserving faulty original files');
for(const name of names)write(name,semantic.artifacts[name]);
const finalFiles=readSet(''),after=combine(C.reviewArtifacts(finalFiles,data,design),S.reviewSemanticArtifacts(finalFiles,data,design));
write('critic-after.json',after);
if(after.verdict!=='PASS')throw Error('Final file recheck failed: '+out);
event('Release re-read final files with structural and semantic PASS');
write('critic-trace.json',{schemaVersion:4,mode:demo?'explicit fault demonstration':'normal generation',demoFaults:demo,
 input:{path:'content-pipeline/shared/content.v2.json',sha256:sha(inputBytes)},designSources:design.sources,
 designProvenance:design.provenance,cardSourceProvenance:design.cardSourceProvenance,
 ragManifest:design.ragManifest,retrievalEvidence:design.retrievalEvidence,sourceCheck,events,before,changes,after,
 outputSha256:Object.fromEntries(names.map(name=>[name,sha(fs.readFileSync(path.join(out,name)))])),
 modelCalls:0,limits:[C.LIMITS,S.LIMITS,design.retrievalLimits],
 generationLimits:'Source normalization and authored controlled templates selected by actual retrieval. No fresh model calls or unrestricted literary judgment. Unresolved source variables remain visible.'});
console.log(out);
