(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('../snippets/combat-engine.js'));else root.A4Pipeline=factory(root.CombatEngine);})(typeof self!=='undefined'?self:this,function(E){
  'use strict';
  function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
  function hash(s){const x=JSON.parse(JSON.stringify(s));delete x.log;delete x.last;let h=2166136261;for(const b of new TextEncoder().encode(canonical(x))){h^=b;h=Math.imul(h,16777619)>>>0;}return h.toString(16).padStart(8,'0');}
  function makeConfig(data,demoId,seed,scenarioData){
    const d=(scenarioData&&scenarioData.scenarios||[]).find(x=>x.id===demoId)||data.rules;
    if(!data.demos.some(x=>x.id===demoId))throw Error('Unknown demo');
    return {seed:seed===undefined?data.rules.seed:seed,handSize:d.handSize||data.rules.handSize,energy:d.energy||data.rules.energy,cards:data.cards,crew:data.crew.map(c=>({...c,hp:Math.round(c.hp*(d.crewHpScale||1))})),boss:{name:data.boss.name,hp:(d.hpPerSeat||data.boss.hpPerSeat)*data.crew.length,pattern:d.pattern||data.boss.pattern}};
  }
  function reduce(state,a){if(a.type==='play')return E.playCard(state,a.seat,a.cardId,a.target);if(a.type==='end')return E.bossTurn(E.endTurn(state));throw Error('Unknown action type');}
  function replay(data,demoId,seed,entries,scenarioData){let s=E.createGame(makeConfig(data,demoId,seed,scenarioData));for(const entry of entries){const a=entry.action||entry;if(a.v!==1||a.contentVersion!==data.contentVersion||a.demoId!==demoId||a.seed!==seed)throw Error('Content or room configuration mismatch');if(entry.seat&&entry.seat!==a.seat)throw Error('Actor mismatch');s=reduce(s,a);}return s;}
  function validate(data){const errors=[];if(data.schemaVersion!==1)errors.push('schemaVersion');const ids=new Set(data.cards.map(c=>c.id));if(ids.size!==data.cards.length)errors.push('duplicate cards');for(const c of data.cards){if(!c.sourceStatus||!c.text||!['enemy','self','ally','allies'].includes(c.target)||!Number.isInteger(c.cost)||c.cost<0)errors.push('card '+c.id);for(const [key,value] of Object.entries(c.effect))if(!['damage','block','heal','draw'].includes(key)||!Number.isInteger(value)||value<0)errors.push('effect '+c.id);}for(const c of data.crew)for(const id of c.deck)if(!ids.has(id))errors.push('deck '+id);if(new Set(data.crew.map(c=>c.role)).size!==4)errors.push('roles');return errors;}
  function critic(data,claims){return claims.map(c=>{const pin=data.claims.find(p=>p.key===c.key);return {...c,verdict:!pin?'unverified':canonical(c.value)===canonical(pin.value)?'accepted':'rejected',expected:pin?pin.value:null,source:pin?pin.source:null,sourceStatus:pin?pin.sourceStatus:'no pin'};});}
  return {makeConfig,reduce,replay,hash,canonical,validate,critic};
});
