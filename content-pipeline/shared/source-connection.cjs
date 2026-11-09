'use strict';

// Reads the packaged GDD excerpt before content generation. No model or network calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function loadDesign(rootDir) {
  const root = path.resolve(rootDir);
  const contractPath = path.join(root, 'docs/game-design/content-contract.json');
  const contractBytes = fs.readFileSync(contractPath);
  const contract = JSON.parse(contractBytes);
  if (contract.schemaVersion !== 1) throw Error('Unsupported game design contract');
  const sourcePath = path.resolve(root, contract.source.path);
  if (!sourcePath.startsWith(root + path.sep)) throw Error('Design source must stay inside the package');
  const sourceBytes = fs.readFileSync(sourcePath);
  if (digest(sourceBytes) !== contract.source.sha256) throw Error('Game design source hash mismatch');
  const sourceText = sourceBytes.toString('utf8');
  const evidence = contract.evidence;
  if (!evidence || !Array.isArray(evidence.roles) || evidence.roles.length !== 4) throw Error('Missing design evidence');
  for (const item of [evidence.boss, evidence.handSize, ...evidence.roles, evidence.roleWritingDirection, evidence.prototypePerks]) {
    if (!item || typeof item.quote !== 'string' || !item.quote.length || !Number.isSafeInteger(item.originalLine)) throw Error('Invalid design evidence');
    if (!sourceText.includes(item.quote)) throw Error('Design evidence quote missing from source');
  }
  const bossMatch = /^The current boss is provisionally the ([A-Za-z][A-Za-z -]*)\./.exec(evidence.boss.quote);
  if (!bossMatch) throw Error('Unable to derive provisional boss from game design');
  const roles = evidence.roles.map(item => {
    const match = /^([A-Za-z]+) \|/.exec(item.quote);
    if (!match) throw Error('Unable to derive role from game design');
    return match[1];
  });
  if (new Set(roles).size !== 4) throw Error('Design requires four distinct crew roles');
  const numberWords = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const handMatch = /\ba ([a-z]+)-card fan\b/.exec(evidence.handSize.quote);
  const handSize = handMatch && numberWords[handMatch[1]];
  if (!handSize) throw Error('Unable to derive prototype hand size from game design');
  const cite = item => `${contract.source.path} (original GDD line ${item.originalLine})`;
  if (!contract.cardSource || !Array.isArray(contract.cardSource.selectedIds) || contract.cardSource.selectedIds.length !== 16 || new Set(contract.cardSource.selectedIds).size !== 16) throw Error('Missing 16-card source contract');
  const cardSourcePath = path.resolve(root, contract.cardSource.path);
  if (!cardSourcePath.startsWith(root + path.sep)) throw Error('Card source must stay inside the package');
  const cardSourceBytes = fs.readFileSync(cardSourcePath);
  if (digest(cardSourceBytes) !== contract.cardSource.sha256) throw Error('Card source hash mismatch');
  const cardExtract = JSON.parse(cardSourceBytes);
  if (cardExtract.schemaVersion !== 1 || !Array.isArray(cardExtract.cards) || cardExtract.cards.length !== 16 || !cardExtract.provenance) throw Error('Invalid original card source schema');
  if (cardExtract.provenance.originalSha256 !== contract.cardSource.originalSha256 || cardExtract.provenance.originalFilename !== contract.cardSource.originalFilename) throw Error('Original card provenance mismatch');
  const cardIds = new Set();
  for (const card of cardExtract.cards) {
    if (typeof card.id !== 'string' || !/^SK\d+_\d+$/.test(card.id) || cardIds.has(card.id) || !contract.cardSource.selectedIds.includes(card.id)) throw Error('Invalid or duplicate original card ID');
    cardIds.add(card.id);
    for (const field of ['display_name','L_text','E_text','D_text']) if (typeof card[field] !== 'string' || !card[field].length) throw Error(`Missing original card text: ${card.id} ${field}`);
    if (!card.context || typeof card.context !== 'object' || Array.isArray(card.context)) throw Error('Missing original card context');
    for (const phase of ['L','E','D']) {
      for (const suffix of ['Phase','TargetClass','TargetQualifier','TargetCount','EffectType','EffectValue','EffectQuantity','EffectIntensity','DurationType']) {
        if (typeof card.context[`${phase}_${suffix}`] !== 'string') throw Error(`Missing original card context: ${card.id} ${phase}_${suffix}`);
      }
    }
    const origin = card.provenance;
    if (!origin || !Number.isSafeInteger(origin.originalRecord) || origin.originalRecord < 1 || !Number.isSafeInteger(origin.originalStartLine) || origin.originalStartLine < 2 || !Number.isSafeInteger(origin.originalEndLine) || origin.originalEndLine < origin.originalStartLine) throw Error('Invalid original card row reference');
  }
  const roleSentences = evidence.roleWritingDirection.quote.match(/[^.!?]+[.!?]/g) || [];
  const roleDirections = roles.map(role => {
    const directions = roleSentences.map(s=>s.trim()).filter(s=>s.startsWith(role+' '));
    if (directions.length !== 1) throw Error(`Missing unique role writing direction: ${role}`);
    return {role,text:directions[0],source:cite(evidence.roleWritingDirection)};
  });
  return {
    pins: [
      {key:'boss.name',value:bossMatch[1],source:cite(evidence.boss),sourceStatus:'Provisional digital encounter; canonical boss identity not verified'},
      {key:'crew.roles',value:roles,source:evidence.roles.map(cite).join('; '),sourceStatus:'Crew roles from the packaged FAMED GDD excerpt'},
      {key:'prototype.handSize',value:handSize,source:cite(evidence.handSize),sourceStatus:'Digital prototype policy; not the tabletop hand limit'}
    ],
    cardSources:cardExtract.cards,
    cardSourceProvenance:cardExtract.provenance,
    roleGuidance:{
      writingDirection:{text:evidence.roleWritingDirection.quote,source:cite(evidence.roleWritingDirection)},
      prototypePerks:{text:evidence.prototypePerks.quote,source:cite(evidence.prototypePerks)},
      roles:roleDirections,
      limits:'Writing directions describe intended voices. Perks are approved digital adaptations in the retained review, not verified tabletop mechanics or a claim of implemented behavior.'
    },
    sources:[{path:contract.source.path,sha256:digest(sourceBytes)},{path:contract.cardSource.path,sha256:digest(cardSourceBytes)},{path:'docs/game-design/content-contract.json',sha256:digest(contractBytes)}],
    provenance:contract.provenance,
    limits:'Deterministic extraction of three documented design claims and 16 original card records. The excerpt is not the complete GDD. Original text is retained verbatim; source reading does not certify prototype mechanics, balance, dialogue quality, or canonical website facts.'
  };
}

module.exports = {loadDesign};
