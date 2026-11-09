'use strict';
const {normalizePrintedText}=require('./artifact-critic.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));

// These short authored templates express the GDD role directions. The runtime
// expands them with verified role identities; it does not call a language model.
const voices={
  Captain:{start:'Crew, take your places.',play:'On my mark. We act together.',hurt:'Hold formation.',win:'Count the crew. We leave together.'},
  Pathfinder:{start:'Watch the approach.',play:'There. An opening.',hurt:'Keep a way clear.',win:'The way ahead is clear.'},
  Lorekeeper:{start:'Watch the pattern.',play:'Read the intent before we act.',hurt:'Keep watching the next move.',win:'I will record what worked.'},
  Vaultwarden:{start:'Our reserves are ready.',play:'Use what we need. Waste nothing.',hurt:'Keep something in reserve.',win:'Count the crew before the spoils.'}
};
function prototypeText(c){
  const words={damage:n=>`deal ${n} damage`,block:n=>`gain ${n} block`,heal:n=>`restore ${n} HP`,draw:n=>`draw ${n} card${n===1?'':'s'}`};
  const effects=Object.entries(c.effect).map(([k,v])=>{
    if(!words[k])throw Error('Undocumented prototype effect: '+k);
    return words[k](v);
  });
  return `Digital prototype: ${effects.join('; ')}. Target: ${c.target}. Cost: ${c.cost} energy. These simplified effects do not replace the printed rules.`;
}
function generateArtifacts(data,design){
  const originals=new Map(design.cardSources.map(c=>[c.id,c]));
  const csv=design.sources.find(s=>s.path.endsWith('cards-source.json'));
  if(!csv)throw Error('Missing original card-source evidence');
  const cards=data.cards.map(c=>{
    const src=originals.get(c.id);if(!src)throw Error('No original card source: '+c.id);
    return {id:c.id,name:src.display_name,printedSourceText:src.D_text,
      readablePrintedText:normalizePrintedText(src.D_text),prototypeText:prototypeText(c),
      digitalCost:c.cost,digitalTarget:c.target,digitalType:c.type,digitalEffect:clone(c.effect),
      prototypeFields:clone(c.prototype_fields),
      sourceStatus:'Original printed Dungeon text preserved; digital fields are separately labeled prototype adaptations.',
      sourceEvidence:{path:csv.path,sha256:csv.sha256,id:c.id,field:'D_text',originalRecord:src.provenance.originalRecord},
      unresolvedSourceTokens:(src.D_text.match(/\{\{[^}]*\}\}/g)||[]),
      generationMethod:'Source text normalization plus explicit prototype effect templates; unresolved source variables remain visible.'};
  });
  const roles=design.pins.find(p=>p.key==='crew.roles').value;
  const crew=roles.map(role=>{
    const guide=design.roleGuidance.roles.find(g=>g.role===role);
    if(!guide||!voices[role])throw Error('Missing role writing direction: '+role);
    return {role,description:guide.text,voice:clone(voices[role]),
      sourceStatus:'New short text lines authored from GDD role directions; no voice audio or automated tone approval is claimed.',
      sourceEvidence:[guide.source,design.roleGuidance.writingDirection.source],
      generationMethod:'Authored event-line templates keyed to verified GDD roles; human review of tone remains separate.'};
  });
  return {'card-text.json':cards,'crew-dialogue.json':crew,
    'boss-rules.json':{boss:clone(data.boss),rules:clone(data.rules),
      sourceStatus:'Provisional Ogre encounter; numerical effects are the labeled digital prototype configuration.',
      sourceEvidence:design.pins.map(p=>({key:p.key,source:p.source,sourceStatus:p.sourceStatus})),
      generationMethod:'Structured encounter configuration checked against extracted design facts.'}};
}
module.exports={generateArtifacts};
