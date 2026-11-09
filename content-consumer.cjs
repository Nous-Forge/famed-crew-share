'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./content-pipeline/shared/artifact-critic.cjs');
const P=require('./content-pipeline/shared/pipeline.v2.js');
const E=require('./content-pipeline/snippets/combat-engine.v2.js');
const {loadDesign}=require('./content-pipeline/shared/source-connection.cjs');
function consume(folder){
  const design=loadDesign(__dirname),data=JSON.parse(fs.readFileSync(path.join(__dirname,'content-pipeline/shared/content.v2.json')));
  const names=['card-text.json','crew-dialogue.json','boss-rules.json'];
  const artifacts=Object.fromEntries(names.map(n=>[n,JSON.parse(fs.readFileSync(path.join(folder,n),'utf8'))]));
  const report=C.reviewArtifacts(artifacts,data,design);
  if(report.verdict!=='PASS')throw Error('Refusing unapproved content: '+JSON.stringify(report.findings));
  const cards=artifacts['card-text.json'],crew=artifacts['crew-dialogue.json'],boss=artifacts['boss-rules.json'];
  const derived={...data,cards:cards.map(c=>({id:c.id,name:c.name,text:c.prototypeText,printedText:c.printedSourceText,cost:c.digitalCost,type:c.digitalType,target:c.digitalTarget,effect:c.digitalEffect})),
    crew:data.crew.map(c=>({...c,...crew.find(x=>x.role===c.role)})),boss:boss.boss,rules:boss.rules};
  let state=E.createGame(P.makeConfig(derived,derived.rules.seed));
  const roundBefore=state.round;
  state=P.botBatch(state,derived.crew.map(c=>c.role));
  if(!state.over&&state.round<=roundBefore)throw Error('Generated content did not complete a crew phase');
  return {result:'PASS',kind:'finite prototype engine consumption check',cardsLoaded:cards.length,crewLoaded:crew.length,
    bossLoaded:boss.boss.name,roundBefore,roundAfter:state.round,gameOver:state.over,stateHash:P.hash(state),
    dialogueEventsLoaded:crew.length*4,
    fileSha256:Object.fromEntries(names.map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,n))).digest('hex')])),
    limits:'Loads generated text, voices and prototype configuration into the existing engine and runs one crew phase. No UI, sound, internet multiplayer or full-game acceptance claim.'};
}
if(require.main===module){
  if(process.argv.length!==3)throw Error('Usage: node content-consumer.cjs PATH_TO_RUN');
  console.log(JSON.stringify(consume(path.resolve(process.argv[2])),null,2));
}
module.exports={consume};
