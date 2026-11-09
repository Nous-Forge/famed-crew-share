'use strict';
const path=require('node:path');
const {loadDesign}=require('./source-connection.cjs');
const R=require('./rag-retrieval.cjs');
function loadRuntimeContext(root,options={}){
  const design=loadDesign(root);
  const corpus=R.loadRagCorpus(options.ragRoot||path.join(root,'docs/rag'));
  const roles=design.pins.find(p=>p.key==='crew.roles').value;
  const retrieval=roles.map(role=>R.deriveRoleDirections(corpus,role));
  const directionRows=retrieval.map(r=>({role:r.role,text:r.text,
    source:r.evidence.map(e=>`${e.filename} ${e.locator}`).join('; '),
    evidence:r.evidence,trace:r.trace}));
  return {...design,roleGuidance:{...design.roleGuidance,roles:directionRows},
    ragContext:corpus,retrievalEvidence:retrieval,
    ragManifest:{corpusHash:corpus.corpusHash,sourceCount:corpus.manifest.sources.length,passageCount:corpus.passages.length},
    retrievalLimits:'Local authority-first lexical retrieval over reviewed pinned passages; historical sources do not override current design. Generation receives the retrieved role direction. No hosted embedding service or full-document reasoning is claimed.'};
}
module.exports={loadRuntimeContext};
