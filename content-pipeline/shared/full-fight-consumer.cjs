'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const NAMES=['card-text.json','crew-dialogue.json','boss-rules.json'];

function loadRun(folder,options={}){
  const root=path.resolve(options.rootDir||path.join(__dirname,'../..'));
  const shared=path.join(root,'content-pipeline/shared');
  const {loadRuntimeContext}=require(path.join(shared,'load-runtime-context.cjs'));
  const C=require(path.join(shared,'artifact-critic.cjs'));
  const S=options.semanticModule||require(path.join(shared,'semantic-text.cjs'));
  const P=require(path.join(shared,'pipeline.v2.js'));
  const E=require(path.join(root,'content-pipeline/snippets/combat-engine.v2.js'));
  const dataBytes=fs.readFileSync(path.join(shared,'content.v2.json'));
  const data=JSON.parse(dataBytes),design=loadRuntimeContext(root);
  const artifactBytes=Object.fromEntries(NAMES.map(n=>[n,fs.readFileSync(path.join(folder,n))]));
  const artifacts=Object.fromEntries(NAMES.map(n=>[n,JSON.parse(artifactBytes[n].toString('utf8'))]));
  const fileSha256=Object.fromEntries(NAMES.map(n=>[n,digest(artifactBytes[n])]));
  const report=C.reviewArtifacts(artifacts,data,design),semantic=S.reviewSemanticArtifacts(artifacts,data,design);
  if(report.verdict!=='PASS'||semantic.verdict!=='PASS')throw Error('HOLD: consumer refused inconsistent generated content');
  const trace=JSON.parse(fs.readFileSync(path.join(folder,'critic-trace.json'),'utf8'));
  if(trace.after?.verdict!=='PASS'||trace.input?.sha256!==digest(dataBytes)||NAMES.some(n=>trace.outputSha256?.[n]!==fileSha256[n]))throw Error('HOLD: missing/stale final release evidence');
  const cards=artifacts['card-text.json'],crew=artifacts['crew-dialogue.json'],boss=artifacts['boss-rules.json'];
  const derived={...data,
    cards:cards.map(c=>({id:c.id,name:c.name,text:c.prototypeText,printedText:c.printedSourceText,cost:c.digitalCost,type:c.digitalType,target:c.digitalTarget,effect:c.digitalEffect})),
    crew:data.crew.map(c=>({...c,...crew.find(v=>v.role===c.role)})),boss:boss.boss,rules:boss.rules};
  return {root,folder:path.resolve(folder),data:derived,artifacts,fileSha256,design,P,E,semanticChecks:semantic.checks};
}

function runScenario(loaded,options={}){
  const strategy=options.strategy||'win';
  if(!['win','loss'].includes(strategy))throw Error('Unsupported encounter strategy');
  const maxActions=options.maxActions||2000,maxObservedRounds=options.maxObservedRounds||40;
  if(!Number.isSafeInteger(maxActions)||maxActions<1||!Number.isSafeInteger(maxObservedRounds)||maxObservedRounds<1)throw Error('Invalid finite encounter cap');
  const {data,P,E}=loaded;
  const seed=options.seed===undefined?data.rules.seed:options.seed;
  if(!Number.isSafeInteger(seed))throw Error('Invalid deterministic seed');
  let state=E.createGame(P.makeConfig(data,seed));
  const actions=[],dialogue=[],engineEvents=[],perks=[];
  const voiceRows=loaded.artifacts['crew-dialogue.json'];
  const emit=(role,event,round,trigger)=>{
    const text=voiceRows.find(v=>v.role===role)?.voice[event];
    if(!text)throw Error('Missing generated dialogue for actual event');
    dialogue.push({role,event,round,text,trigger,file:'crew-dialogue.json',fileSha256:loaded.fileSha256['crew-dialogue.json']});
  };
  function observeLogs(entries){
    for(const log of entries){
      engineEvents.push(log);
      if(log.data?.perk||/\(perk, prototype\)/.test(log.text)){
        const actor=log.data?.seat!==undefined?state.crew[log.data.seat]:state.crew.find(m=>log.text.startsWith(m.name+' '));
        const kind=log.data?.perk||(/ empowers /.test(log.text)?'empower-grant':/gives a potion/.test(log.text)?'potion':actor?.role==='Captain'?'round-start-block':'prototype-perk');
        perks.push({round:log.round,role:actor?.role||null,kind,engineLog:log});
      }
    }
  }
  observeLogs(state.log);
  for(const member of state.crew)emit(member.role,'start',state.round,{kind:'engine-created-crew',seat:member.seat});
  function act(role,action){
    if(actions.length>=maxActions)throw Error('HOLD: encounter action cap reached');
    const before=state,next=E.applyAction(before,role,action);
    if(!next.last.ok)throw Error('Illegal scripted action: '+role+' '+JSON.stringify(action)+' '+next.last.reason);
    const logs=next.log.slice(before.log.length);
    state=next;
    actions.push({n:actions.length+1,round:before.round,role,action,accepted:true,stateHash:P.hash(state)});
    observeLogs(logs);
    if(action.type==='play'){
      const play=logs.find(l=>l.data?.card===action.cardId);
      if(!play)throw Error('Missing actual card-play event');
      emit(role,'play',play.round,{kind:'accepted-card-play',cardId:action.cardId,engineLog:play.n});
    }
    for(const old of before.crew){
      const current=state.crew.find(c=>c.role===old.role);
      if(current.hp<old.hp)emit(old.role,'hurt',before.round,{kind:'actual-hp-loss',before:old.hp,after:current.hp});
    }
    if(!before.over&&state.over&&state.winner==='crew')for(const member of state.crew.filter(c=>c.hp>0))emit(member.role,'win',before.round,{kind:'actual-terminal-crew-victory'});
  }
  const livingUnready=()=>state.crew.filter(c=>c.hp>0&&!c.ready);
  function beginWinningRound(){
    const lore=state.crew.find(c=>c.role==='Lorekeeper');
    if(lore&&lore.hp>0&&!lore.ready&&!lore.perkUsed){
      const ally=livingUnready().filter(c=>c.role!=='Lorekeeper').sort((a,b)=>a.seat-b.seat)[0];
      if(ally)act('Lorekeeper',{type:'empower',target:ally.role});
    }
    const vault=state.crew.find(c=>c.role==='Vaultwarden');
    if(!state.over&&vault&&vault.hp>0&&!vault.ready&&!vault.perkUsed){
      const target=state.crew.filter(c=>c.hp>0).sort((a,b)=>(b.maxHp-b.hp)-(a.maxHp-a.hp)||a.seat-b.seat)[0];
      act('Vaultwarden',{type:'potion',target:target.role});
    }
  }
  while(!state.over){
    if(state.round>maxObservedRounds)throw Error('HOLD: observed round cap reached before terminal result');
    const round=state.round;
    if(strategy==='win')beginWinningRound();
    while(!state.over&&state.round===round){
      const member=livingUnready().sort((a,b)=>a.seat-b.seat)[0];
      if(!member)throw Error('HOLD: engine did not advance after all crew became ready');
      if(strategy==='loss'){act(member.role,{type:'end_turn'});continue;}
      const cards=member.hand.map(id=>state.cards[id]).filter(c=>c.cost<=member.energy);
      cards.sort((a,b)=>(b.effect.damage||0)-(a.effect.damage||0)||(b.effect.heal||0)-(a.effect.heal||0)||(b.effect.draw||0)-(a.effect.draw||0)||a.id.localeCompare(b.id));
      if(!cards.length){act(member.role,{type:'end_turn'});continue;}
      const card=cards[0];
      const ally=state.crew.filter(c=>c.hp>0).sort((a,b)=>(b.maxHp-b.hp)-(a.maxHp-a.hp)||a.seat-b.seat)[0];
      act(member.role,{type:'play',cardId:card.id,target:card.target==='enemy'?'boss':card.target==='self'?member.role:ally.role});
    }
  }
  const expectedWinner=strategy==='win'?'crew':'boss';
  if(state.winner!==expectedWinner)throw Error(`HOLD: ${strategy} scenario ended with ${state.winner}, not ${expectedWinner}`);
  if(strategy==='loss'&&dialogue.some(d=>d.event==='win'||d.event==='loss'))throw Error('Loss emitted unsupported terminal dialogue');
  const bossActions=engineEvents.filter(l=>l.data?.move&&l.tab==='combat');
  if(!bossActions.length)throw Error('No actual boss action demonstrated');
  if(strategy==='win'&&!dialogue.some(d=>d.event==='play'))throw Error('No actual generated-card play');
  const observedPerkRoles=[...new Set(perks.map(p=>p.role).filter(Boolean))];
  return {result:'PASS',kind:'complete deterministic generated-content encounter',strategy,seed,
    terminal:true,winner:state.winner,terminalRound:state.round,actionsTaken:actions.length,stateHash:P.hash(state),
    inputFileSha256:loaded.fileSha256,cardsLoaded:data.cards.length,crewLoaded:data.crew.length,bossLoaded:data.boss.name,
    dialogue,dialogueCounts:Object.fromEntries(['start','play','hurt','win','loss'].map(e=>[e,dialogue.filter(d=>d.event===e).length])),
    bossActions,perkEvidence:perks,perkRolesObserved:observedPerkRoles,perkRolesNotDemonstrated:['Captain','Pathfinder','Lorekeeper','Vaultwarden'].filter(r=>!observedPerkRoles.includes(r)),
    actions,engineEvents,limits:'Headless valid-action engine encounter using generated files, not a browser/UI/audio/multiplayer or human playtest. Loss strategy deliberately ends legal turns; no loss line exists. Numerical effects remain labeled prototype adaptations.'};
}

function consumeFullFights(folder,options={}){
  const loaded=loadRun(folder,options);
  const win=runScenario(loaded,{strategy:'win',seed:options.seed});
  const loss=runScenario(loaded,{strategy:'loss',seed:options.seed});
  return {result:'PASS',capturedAt:new Date().toISOString(),inputFileSha256:loaded.fileSha256,semanticChecks:loaded.semanticChecks,win,loss};
}
if(require.main===module){
  if(process.argv.length<3||process.argv.length>4)throw Error('Usage: node full-fight-consumer.cjs RUN_FOLDER [PACKAGE_ROOT]');
  console.log(JSON.stringify(consumeFullFights(process.argv[2],{rootDir:process.argv[3]}),null,2));
}
module.exports={loadRun,runScenario,consumeFullFights};
