'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),P=require('./pipeline.v2.js');
const design=require('./source-connection.cjs').loadDesign(path.resolve(__dirname,'../..'));
const input=path.join(__dirname,'content.v2.json'),bytes=fs.readFileSync(input),data=JSON.parse(bytes),errors=P.validate(data);if(errors.length)throw Error(errors.join(', '));
data.claims=design.pins;
const actual=[{key:'boss.name',value:data.boss.name},{key:'crew.roles',value:data.crew.map(c=>c.role)},{key:'prototype.handSize',value:data.rules.handSize}];
const sourceCheck=P.critic(data,actual);if(sourceCheck.some(c=>c.verdict!=='accepted'))throw Error('Content does not match the packaged GDD: '+JSON.stringify(sourceCheck));
const at=new Date().toISOString(),out=path.join(__dirname,'runs-v2',at.replace(/[:.]/g,'-'));fs.mkdirSync(out,{recursive:true});function write(name,value){fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
const draft=[{key:'boss.name',value:'Bauglor'},{key:'crew.roles',value:data.crew.map(c=>c.role)},{key:'prototype.handSize',value:5}],before=P.critic(data,draft),repaired=before.map(c=>({key:c.key,value:c.verdict==='rejected'?c.expected:c.value})),after=P.critic(data,repaired);if(before.filter(c=>c.verdict==='rejected').length!==1||after.some(c=>c.verdict!=='accepted'))throw Error('Critic loop failed');
write('card-text.json',data.cards.map(c=>({id:c.id,name:c.name,prototypeText:c.text,printedSourceText:c.printedText,sourceFields:c.src,prototypeFields:c.prototype_fields,sourceStatus:c.sourceStatus})));
write('crew-dialogue.json',data.crew.map(c=>({role:c.role,description:c.description,voice:c.voice,sourceStatus:c.sourceStatus})));
write('boss-rules.json',{boss:data.boss,rules:data.rules,claims:repaired,sourceStatus:data.sourceStatus});
write('critic-trace.json',{capturedAt:at,input:'content-pipeline/shared/content.v2.json',sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),designSources:design.sources,designProvenance:design.provenance,originalSourcePins:data.sources,sourceCheck,stages:['read packaged GDD excerpt and verify source evidence','derive three design pins from source passages','read source-derived content snapshot','validate16skills/24decks/HPpolicy','compare content against GDD pins','generate3outputs','plant false boss-name fact','critic rejects','repair to GDD provisional boss pin','critic rechecks all3claims'],before,after,tokens:null,cost:null,canonicalSiteVerified:false,limits:design.limits});console.log(out);
