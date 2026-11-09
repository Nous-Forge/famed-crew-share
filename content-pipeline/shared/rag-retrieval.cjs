'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const words=x=>(String(x).toLowerCase().match(/[a-z0-9]+/g)||[]);
function loadRagCorpus(root){
  root=path.resolve(root); const manifest=JSON.parse(fs.readFileSync(path.join(root,'source-manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.sources))throw Error('HOLD: invalid RAG manifest');
  const passages=[];
  for(const src of manifest.sources){
    const file=path.resolve(root,src.path);
    if(!file.startsWith(root+path.sep))throw Error('HOLD: source escapes RAG root');
    const bytes=fs.readFileSync(file);if(hash(bytes)!==src.sha256)throw Error('HOLD: RAG source hash mismatch '+src.id);
    const pack=JSON.parse(bytes.toString('utf8'));
    if(pack.originalSha256!==src.originalSha256||!Array.isArray(pack.passages))throw Error('HOLD: source provenance mismatch');
    for(const [i,p]of pack.passages.entries()){
      if(!p.quote||!p.locator)throw Error('HOLD: incomplete passage');
      const tokens=words(p.quote);passages.push({...p,id:src.id+':'+i,sourceId:src.id,filename:src.filename,version:src.version,sha256:src.sha256,originalSha256:src.originalSha256,authority:src.authority,priority:src.priority,tokens});
    }
  }
  return {manifest,passages,corpusHash:hash(JSON.stringify(manifest)),root};
}
function retrieve(context,query,filters={}){
  if(!context||!Array.isArray(context.passages))throw Error('HOLD: verified RAG context required');
  const q=[...new Set(words(query))];if(!q.length)throw Error('HOLD: empty retrieval query');
  const pool=context.passages.filter(p=>(!filters.role||p.role===filters.role)&&(!filters.kind||p.kind===filters.kind)&&(!filters.authority||p.authority===filters.authority)&&(!filters.sourceId||p.sourceId===filters.sourceId));
  const avg=pool.reduce((n,p)=>n+p.tokens.length,0)/(pool.length||1);
  const ranked=pool.map(p=>{
    let score=0;const matchedTerms=[];
    for(const t of q){const tf=p.tokens.filter(w=>w===t).length;if(!tf)continue;
      const df=pool.filter(d=>d.tokens.includes(t)).length,idf=Math.log(1+(pool.length-df+0.5)/(df+0.5));
      score+=idf*tf*2.2/(tf+1.2*(0.25+0.75*p.tokens.length/(avg||1)));matchedTerms.push(t);
    }
    return {...p,score:Number(score.toFixed(8)),matchedTerms};
  }).filter(p=>p.score>0).sort((a,b)=>b.priority-a.priority||b.score-a.score||a.id.localeCompare(b.id));
  const selected=ranked.slice(0,filters.limit||5).map(({tokens,...p})=>p);
  return {passages:selected,trace:{query,filters,candidates:pool.length,selectedIds:selected.map(p=>p.id),algorithm:'authority-first BM25 k1=1.2 b=0.75; stable passage ID tie break',corpusHash:context.corpusHash}};
}
function deriveRoleDirections(context,role){
  if(!['Captain','Pathfinder','Lorekeeper','Vaultwarden'].includes(role))throw Error('HOLD: unsupported role');
  const direction=retrieve(context,role+' writing leadership movement knowledge resourcefulness',{role,kind:'roleDirection',authority:'current-packaged-design',limit:2});
  if(direction.passages.length!==1)throw Error('HOLD: missing or ambiguous current direction for '+role);
  const identity=retrieve(context,role+' crew role',{role,kind:'roleIdentity',authority:'current-packaged-design',limit:2});
  if(identity.passages.length!==1)throw Error('HOLD: missing or ambiguous identity for '+role);
  return {role,text:direction.passages[0].quote,evidence:[...direction.passages,...identity.passages],trace:direction.trace};
}
module.exports={loadRagCorpus,retrieve,deriveRoleDirections};
