'use strict';

// Reviews the three generated file payloads, independently of generation.
// It never reads a prompt as executable instructions and never performs I/O.
const LIMITS = 'Deterministic source and structure checks, not a language-model judgment of tone, complete lore, balance, or faithful tabletop mechanics. Digital effects are compared with the labeled prototype configuration, not promoted to printed rules.';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : object(value) ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const equal = (a, b) => canonical(a) === canonical(b);
const meaningful = value => typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 : object(value) && Object.keys(value).length > 0;
function normalizePrintedText(text) {
  return String(text).replace(/<(bold|italic|small_italic|small|b|i)>/gi, '').replace(/<\/(bold|italic|small_italic|small|b|i)>/gi, '').replace(/<([A-Za-z0-9_]+)\s*\/>/g, '[$1]').replace(/\s+/g, ' ').trim();
}
function pathText(parts) {
  return '$' + parts.map(p => typeof p === 'number' ? '[' + p + ']' : '.' + p).join('');
}

function reviewArtifacts(artifacts, data, design) {
  const findings = [];
  let checks = 0;
  function check(ok, file, parts, code, actual, expected, source, repairable = false) {
    checks++;
    if (!ok) findings.push({file, jsonPath:pathText(parts), path:parts, code, actual:actual === undefined ? null : clone(actual), expected:expected === undefined ? null : clone(expected), source, evidence:'Compared actual generated file field with the cited source or explicit structural rule.', repairable, severity:'error'});
  }
  const pinRows = design && Array.isArray(design.pins) ? design.pins : [];
  const pins = new Map(pinRows.filter(object).map(p => [p.key, p]));
  const bossPin = pins.get('boss.name');
  const rolePin = pins.get('crew.roles');
  const handPin = pins.get('prototype.handSize');
  const sources = design && design.cardSources;
  check(object(artifacts), '(inputs)', [], 'artifact-map', typeof artifacts, 'object with three artifact filenames', 'Package contract');
  check(Array.isArray(sources) && sources.length === 16 && new Set(sources.map(c => c && c.id)).size === 16, '(inputs)', [], 'card-source-contract', sources && sources.length, '16 unique original CSV source rows', 'Verified packaged original card CSV extraction');
  check(Array.isArray(sources) && sources.every(c => object(c) && typeof c.id === 'string' && typeof c.display_name === 'string' && typeof c.D_text === 'string'), '(inputs)', [], 'card-source-fields', null, 'Original ID, display name and Dungeon text strings', 'Verified packaged original card CSV extraction');
  check(!!bossPin && typeof bossPin.value === 'string' && bossPin.value.length > 0 && !!rolePin && !!handPin && Number.isSafeInteger(handPin.value) && handPin.value > 0 && Array.isArray(rolePin.value) && rolePin.value.length === 4 && rolePin.value.every(r => typeof r === 'string' && r.length > 0) && new Set(rolePin.value).size === 4, '(inputs)', [], 'design-pins', null, 'Boss, four distinct roles and hand-size evidence', 'Verified game-design passages');
  check(data && Array.isArray(data.cards) && data.cards.length === 16 && new Set(data.cards.map(c => c && c.id)).size === 16 && data.cards.every(c => object(c) && typeof c.id === 'string' && object(c.effect) && Array.isArray(c.prototype_fields)), '(inputs)', [], 'prototype-card-contract', null, '16 unique prototype cards with effect and prototype labels', 'Labeled digital prototype configuration');
  check(data && object(data.boss) && object(data.rules), '(inputs)', [], 'prototype-boss-contract', null, 'Boss and rules prototype objects', 'Labeled digital prototype configuration');
  if (findings.length) return {verdict:'HOLD',checks,findings,limits:LIMITS};
  const cardSources = new Map(sources.map(c => [c.id, c]));
  const prototypes = new Map(data.cards.map(c => [c.id,c]));
  const cardsFile = 'card-text.json';
  const cards = artifacts[cardsFile];
  check(Array.isArray(cards) && cards.length === 16, cardsFile, [], 'card-count', Array.isArray(cards) ? cards.length : typeof cards, 16, '16 verified original skill rows');
  if (Array.isArray(cards)) {
    const ids = cards.map(c => c && c.id);
    check(new Set(ids).size === ids.length, cardsFile, [], 'duplicate-card-id', ids, 'Unique original card IDs', 'Original CSV card IDs');
    for (const expectedId of cardSources.keys()) check(ids.includes(expectedId), cardsFile, [], 'missing-card-id', ids, expectedId, 'Original CSV card IDs');
    cards.forEach((c, i) => {
      if (!object(c)) { check(false,cardsFile,[i],'card-shape',c,'object','Card output schema'); return; }
      const source = cardSources.get(c.id), proto = prototypes.get(c.id);
      check(!!source && !!proto, cardsFile,[i,'id'],'unknown-card-id',c.id,'An original CSV ID with a labeled prototype mapping','Original CSV and prototype IDs');
      if (!source || !proto) return;
      const unique = ids.filter(id => id === c.id).length === 1;
      const cite = {kind:'original-card-csv',id:c.id,provenance:source.provenance || null};
      check(equal(c.name,source.display_name),cardsFile,[i,'name'],'card-name',c.name,source.display_name,cite,unique);
      check(equal(c.printedSourceText,source.D_text),cardsFile,[i,'printedSourceText'],'printed-text',c.printedSourceText,source.D_text,cite,unique);
      check(equal(c.readablePrintedText,normalizePrintedText(source.D_text)),cardsFile,[i,'readablePrintedText'],'readable-printed-text',c.readablePrintedText,normalizePrintedText(source.D_text),cite,unique);
      check(equal(c.digitalEffect,proto.effect),cardsFile,[i,'digitalEffect'],'digital-prototype-effect',c.digitalEffect,proto.effect,'Labeled prototype configuration: '+c.id,unique);
      for (const [field,expected] of [['digitalCost',proto.cost],['digitalTarget',proto.target],['digitalType',proto.type]]) check(equal(c[field],expected),cardsFile,[i,field],'digital-prototype-field',c[field],expected,'Labeled prototype configuration: '+c.id,unique);
      check(equal(c.prototypeFields,proto.prototype_fields),cardsFile,[i,'prototypeFields'],'prototype-labels',c.prototypeFields,proto.prototype_fields,'Labeled prototype configuration: '+c.id,unique);
      check(typeof c.prototypeText === 'string' && /\bprototype\b/i.test(c.prototypeText),cardsFile,[i,'prototypeText'],'prototype-disclosure',c.prototypeText,'Nonempty text explicitly labeled prototype','Printed and prototype rules must remain separate');
      check(meaningful(c.sourceStatus),cardsFile,[i,'sourceStatus'],'source-status',c.sourceStatus,'Nonempty source/prototype status','Output provenance contract');
      check(meaningful(c.sourceEvidence),cardsFile,[i,'sourceEvidence'],'source-evidence',c.sourceEvidence,'Source evidence for this card','Output provenance contract');
    });
  }
  const crewFile='crew-dialogue.json',crew=artifacts[crewFile],roles=rolePin.value;
  check(Array.isArray(crew) && crew.length===roles.length,crewFile,[],'crew-count',Array.isArray(crew)?crew.length:typeof crew,roles.length,rolePin.source);
  if(Array.isArray(crew)){
    const actualRoles=crew.map(c=>c&&c.role);
    check(new Set(actualRoles).size===actualRoles.length,crewFile,[],'duplicate-role',actualRoles,roles,rolePin.source);
    for(const role of roles)check(actualRoles.includes(role),crewFile,[],'missing-role',actualRoles,role,rolePin.source);
    crew.forEach((c,i)=>{
      if(!object(c)){check(false,crewFile,[i],'crew-shape',c,'object','Crew output schema');return;}
      check(roles.includes(c.role),crewFile,[i,'role'],'unknown-role',c.role,roles,rolePin.source);
      check(typeof c.description==='string' && c.description.trim().length>0 && c.description.length<=400,crewFile,[i,'description'],'crew-description',c.description,'1–400 characters','Declared output readability limit');
      check(object(c.voice),crewFile,[i,'voice'],'voice-shape',c.voice,'start, play, hurt and win text','Crew event schema');
      for(const event of ['start','play','hurt','win']){
        const line=c.voice&&c.voice[event];
        check(typeof line==='string' && line.trim().length>0 && line.length<=160,crewFile,[i,'voice',event],'voice-line',line,'1–160 characters','Declared event-line readability limit');
      }
      check(meaningful(c.sourceStatus),crewFile,[i,'sourceStatus'],'source-status',c.sourceStatus,'Nonempty content-review status','Output provenance contract');
      check(meaningful(c.sourceEvidence),crewFile,[i,'sourceEvidence'],'source-evidence',c.sourceEvidence,'GDD role evidence','Output provenance contract');
    });
  }
  const bossFile='boss-rules.json',boss=artifacts[bossFile];
  check(object(boss)&&object(boss.boss)&&object(boss.rules),bossFile,[],'boss-shape',null,'Boss and rules objects','Boss output schema');
  if(object(boss)&&object(boss.boss)&&object(boss.rules)){
    const expectedBoss={...clone(data.boss),name:bossPin.value};
    const expectedRules={...clone(data.rules),handSize:handPin.value};
    function compareLeaves(actual,expected,parts,source){
      if(object(expected)){
        for(const [key,value]of Object.entries(expected)){
          if(object(value)&&object(actual&&actual[key]))compareLeaves(actual[key],value,parts.concat(key),source);
          else check(equal(actual&&actual[key],value),bossFile,parts.concat(key),'boss-rule-field',actual&&actual[key],value,source,true);
        }
        const unknown=object(actual)?Object.keys(actual).filter(k=>!Object.hasOwn(expected,k)):[];
        for(const key of unknown)check(false,bossFile,parts.concat(key),'unsupported-boss-rule-field',actual[key],'No undocumented rule field',source);
      }
    }
    compareLeaves(boss.boss,expectedBoss,['boss'],{gameDesign:bossPin.source,prototype:'Labeled prototype boss configuration'});
    compareLeaves(boss.rules,expectedRules,['rules'],{gameDesign:handPin.source,prototype:'Labeled prototype rules configuration'});
    check(meaningful(boss.sourceStatus),bossFile,['sourceStatus'],'source-status',boss.sourceStatus,'Nonempty prototype status','Output provenance contract');
    check(meaningful(boss.sourceEvidence),bossFile,['sourceEvidence'],'source-evidence',boss.sourceEvidence,'GDD boss/rules evidence','Output provenance contract');
  }
  return {verdict:findings.length?'HOLD':'PASS',checks,findings,limits:LIMITS};
}

function repairArtifacts(artifacts,data,design){
  const repaired=clone(artifacts),before=reviewArtifacts(repaired,data,design);
  if(before.findings.some(f=>!f.repairable))return {artifacts:repaired,changes:[],before,after:before,blocked:true};
  const changes=[];
  for(const finding of before.findings){
    let target=repaired[finding.file];
    for(const segment of finding.path.slice(0,-1))target=target[segment];
    const key=finding.path[finding.path.length-1];
    target[key]=clone(finding.expected);
    changes.push({file:finding.file,jsonPath:finding.jsonPath,before:finding.actual,after:clone(finding.expected),code:finding.code,source:finding.source});
  }
  const after=reviewArtifacts(repaired,data,design);
  return {artifacts:repaired,changes,before,after,blocked:after.verdict!=='PASS'};
}
module.exports={reviewArtifacts,repairArtifacts,normalizePrintedText,LIMITS};
