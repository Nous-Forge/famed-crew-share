'use strict';

// Evidence-bound authored language. This is a finite factual grammar, not an
// unrestricted judgment of natural language, tabletop rules, or literary tone.
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const equal=(a,b)=>canonical(a)===canonical(b);
const EVENTS=['start','play','hurt','win'];
const ROLES=['Captain','Pathfinder','Lorekeeper','Vaultwarden'];
const DIRECTIONS={
  Captain:'Captain leadership should make a choice legible and help the team act together.',
  Pathfinder:'Pathfinder movement and evasion should clarify risk and position.',
  Lorekeeper:'Lorekeeper knowledge should explain rather than invent world facts.',
  Vaultwarden:'Vaultwarden resourcefulness should make resource and artifact choices readable.'
};
const VOICES={
  Captain:{start:'Crew, take your places.',play:'On my mark. We act together.',hurt:'Hold formation.',win:'We leave together.'},
  Pathfinder:{start:'Check the approach.',play:'There. An opening.',hurt:'Keep a way clear.',win:'The way ahead is clear.'},
  Lorekeeper:{start:'Watch the pattern.',play:'Read the intent before we act.',hurt:'Keep watching the next move.',win:'I will record what worked.'},
  Vaultwarden:{start:'Our reserves are ready.',play:'Use what we need. Waste nothing.',hurt:'Keep something in reserve.',win:'Count the crew. Check the reserves.'}
};
const CALM='Captain leadership should make a choice legible and help the team act together with calm commands.';
const CALM_VOICE={start:'Crew, gather calmly.',play:'Stay calm. We act together.',hurt:'Stay calm and hold formation.',win:'Count the crew. Leave together calmly.'};
const LIMITS='Exact factual/structural checks against pinned sources and approved controlled language. Free-form tone, full lore, balance and faithful tabletop conversion require separate review. Unknown source directions hold rather than silently using stale templates.';

function renderPrototypeText(card){
  if(!card||!Number.isSafeInteger(card.cost)||card.cost<0||!['enemy','self','ally','allies'].includes(card.target)||!card.effect||Array.isArray(card.effect))throw Error('HOLD: invalid prototype text contract');
  const verbs={damage:n=>`deal ${n} damage`,block:n=>`gain ${n} block`,heal:n=>`restore ${n} HP`,draw:n=>`draw ${n} card${n===1?'':'s'}`};
  const parts=Object.entries(card.effect).map(([kind,n])=>{
    if(!verbs[kind]||!Number.isSafeInteger(n)||n<0)throw Error('HOLD: undocumented prototype effect');
    return verbs[kind](n);
  });
  if(!parts.length)throw Error('HOLD: empty prototype effect');
  return `Digital prototype: ${parts.join('; ')}. Target: ${card.target}. Cost: ${card.cost} energy. These simplified effects do not replace the printed rules.`;
}

function directionFor(design,role,options={}){
  let row;
  if(options.deriveRoleDirections&&options.ragContext)row=options.deriveRoleDirections(options.ragContext,role);
  else row=(design.retrievalEvidence||[]).find(r=>r.role===role);
  if(!row||!Array.isArray(row.evidence)||row.evidence.length!==2||!row.trace||!row.trace.corpusHash)throw Error('HOLD: actual pinned RAG direction and identity required for '+role);
  if(row.evidence.some(e=>e.authority!=='current-packaged-design'||e.sourceId!=='current-gdd'||!e.quote||!/^[a-f0-9]{64}$/.test(e.sha256||'')))throw Error('HOLD: invalid retrieved role evidence');
  const roleLine={Captain:453,Pathfinder:455,Lorekeeper:457,Vaultwarden:459}[role];
  if(row.evidence[0].locator!=='Original GDD line 461'||row.evidence[1].locator!==`Original GDD line ${roleLine}`||!row.evidence[1].quote.startsWith(role+' |'))throw Error('HOLD: incorrect role evidence locator');
  const text=String(row.text).replace(/\s+/g,' ').trim();
  if(row.evidence[0].quote!==text)throw Error('HOLD: direction differs from actual retrieved passage');
  if(text!==DIRECTIONS[role]&&!(role==='Captain'&&text===CALM))throw Error('HOLD: unreviewed role writing direction');
  return {...row,text};
}

function generateCrewDialogue(design,options={}){
  const roles=design.pins.find(p=>p.key==='crew.roles')?.value;
  if(!equal(roles,ROLES))throw Error('HOLD: unsupported crew identity');
  return roles.map(role=>{
    const row=directionFor(design,role,options);
    return {role,description:row.text,voice:clone(role==='Captain'&&row.text===CALM?CALM_VOICE:VOICES[role]),
      sourceStatus:'Authored event-line templates conditioned on actual retrieved and pinned GDD role directions; factual grammar checked, literary tone reviewed separately.',
      sourceEvidence:row.evidence.map(e=>({sourceId:e.sourceId,filename:e.filename,sha256:e.sha256,originalSha256:e.originalSha256,locator:e.locator,quote:e.quote})),
      retrievalTrace:clone(row.trace),generationMethod:'Actual local RAG retrieval selects an approved source-bound writing mode. The retained calm-command fixture selects a distinct Captain mode.'};
  });
}

function reviewSemanticArtifacts(artifacts,data,design,options={}){
  let checks=0;const findings=[];
  const add=(ok,file,path,code,actual,expected,source,repairable=false)=>{
    checks++;if(!ok)findings.push({file,path,jsonPath:'$'+path.map(p=>typeof p==='number'?`[${p}]`:'.'+p).join(''),code,actual:clone(actual),expected:clone(expected),source,repairable});
  };
  const cards=artifacts&&artifacts['card-text.json'];
  const expectedCrew=generateCrewDialogue(design,options);
  add(Array.isArray(cards)&&cards.length===16,'card-text.json',[],'card-array',cards?.length,16,'Verified 16-card source');
  const ids=Array.isArray(cards)?cards.map(c=>c&&c.id):[];
  add(ids.length===new Set(ids).size,'card-text.json',[],'unique-card-identity',ids,'16 unique source IDs','Verified source identities');
  const sourceFile=design.sources.find(s=>s.path.endsWith('cards-source.json'));
  if(!sourceFile)throw Error('HOLD: missing pinned card source');
  if(Array.isArray(cards))cards.forEach((card,i)=>{
    const proto=data.cards.find(c=>c.id===card?.id),original=design.cardSources.find(c=>c.id===card?.id);
    const unique=ids.filter(id=>id===card?.id).length===1;
    add(!!proto&&!!original,'card-text.json',[i,'id'],'known-card',card?.id,'Verified original/prototype ID','Card sources');
    if(!proto||!original)return;
    add(equal(card.prototypeText,renderPrototypeText(proto)),'card-text.json',[i,'prototypeText'],'false-prototype-text',card.prototypeText,renderPrototypeText(proto),{prototypeId:proto.id,kind:'declared digital effect/cost/target'},unique);
    const cite={path:sourceFile.path,sha256:sourceFile.sha256,id:original.id,field:'D_text',originalRecord:original.provenance.originalRecord};
    add(equal(card.sourceEvidence,cite),'card-text.json',[i,'sourceEvidence'],'unsupported-card-citation',card.sourceEvidence,cite,sourceFile,unique);
  });
  const crew=artifacts&&artifacts['crew-dialogue.json'];
  add(Array.isArray(crew)&&crew.length===4,'crew-dialogue.json',[],'crew-array',crew?.length,4,'Verified four crew roles');
  const actualRoles=Array.isArray(crew)?crew.map(c=>c&&c.role):[];
  add(actualRoles.length===new Set(actualRoles).size,'crew-dialogue.json',[],'unique-role',actualRoles,ROLES,'Verified crew identities');
  if(Array.isArray(crew))crew.forEach((entry,i)=>{
    const expected=expectedCrew.find(c=>c.role===entry?.role),unique=actualRoles.filter(r=>r===entry?.role).length===1;
    add(!!expected,'crew-dialogue.json',[i,'role'],'unknown-speaker',entry?.role,ROLES,'Verified GDD role table');
    if(!expected)return;
    add(equal(entry.description,expected.description),'crew-dialogue.json',[i,'description'],'unsupported-role-description',entry.description,expected.description,expected.sourceEvidence,unique);
    add(equal(entry.sourceEvidence,expected.sourceEvidence),'crew-dialogue.json',[i,'sourceEvidence'],'unsupported-role-citation',entry.sourceEvidence,expected.sourceEvidence,expected.sourceEvidence,unique);
    add(equal(entry.retrievalTrace,expected.retrievalTrace),'crew-dialogue.json',[i,'retrievalTrace'],'unsupported-retrieval-trace',entry.retrievalTrace,expected.retrievalTrace,expected.sourceEvidence,unique);
    add(entry.voice&&equal(Object.keys(entry.voice).sort(),[...EVENTS].sort()),'crew-dialogue.json',[i,'voice'],'unsupported-dialogue-event',entry.voice&&Object.keys(entry.voice),EVENTS,'No loss dialogue exists');
    if(!entry.voice||typeof entry.voice!=='object')return;
    for(const event of EVENTS){
      const line=entry.voice[event];
      add(line===expected.voice[event],'crew-dialogue.json',[i,'voice',event],'unsupported-dialogue-fact-or-mode',line,expected.voice[event],expected.sourceEvidence,unique);
      const sentences=typeof line==='string'?line.match(/[^.!?]+[.!?]?/g)||[]:[];
      add(sentences.length>=1&&sentences.length<=2&&sentences.every(s=>(s.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g)||[]).length<=8),'crew-dialogue.json',[i,'voice',event],'dialogue-readability',line,'1–2 sentences, each <=8 words',expected.sourceEvidence,unique);
    }
  });
  return {verdict:findings.length?'HOLD':'PASS',checks,findings,limits:LIMITS};
}

function repairSemanticArtifacts(artifacts,data,design,options={}){
  const result=clone(artifacts),before=reviewSemanticArtifacts(result,data,design,options);
  if(before.findings.some(f=>!f.repairable))return {artifacts:result,before,after:before,changes:[],blocked:true};
  const changes=[];
  for(const f of before.findings){
    let target=result[f.file];for(const p of f.path.slice(0,-1))target=target[p];
    target[f.path.at(-1)]=clone(f.expected);
    changes.push({file:f.file,jsonPath:f.jsonPath,code:f.code,before:f.actual,after:clone(f.expected),source:f.source});
  }
  const after=reviewSemanticArtifacts(result,data,design,options);
  return {artifacts:result,before,after,changes,blocked:after.verdict!=='PASS'};
}
module.exports={renderPrototypeText,generateCrewDialogue,reviewSemanticArtifacts,repairSemanticArtifacts,EVENTS,ROLES,LIMITS};
