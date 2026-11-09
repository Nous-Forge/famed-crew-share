'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),moduleFile=path.join(root,'content-pipeline/shared/source-connection.cjs');
const source=fs.readFileSync(moduleFile,'utf8');
function loader(change){
  const module={exports:{}};
  const fakeFs={readFileSync(file){
    const bytes=fs.readFileSync(file);
    return change?change(String(file),bytes):bytes;
  }};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='node:fs'?fakeFs:require(name),Buffer});
  return module.exports.loadDesign;
}
test('reads exact packaged GDD and original card rows with provenance',()=>{
  const d=loader()(root);assert.equal(d.cardSources.length,16);assert.equal(d.sources.length,3);
  assert.equal(d.pins.find(p=>p.key==='boss.name').value,'Ogre');
  assert.equal(d.roleGuidance.roles.length,4);
});
test('altered GDD bytes are rejected',()=>{
  assert.throws(()=>loader((p,b)=>p.endsWith('FAMED-GDD-source.txt')?Buffer.concat([b,Buffer.from('tamper')]):b)(root),/hash mismatch/);
});
test('altered original card source bytes are rejected',()=>{
  assert.throws(()=>loader((p,b)=>p.endsWith('cards-source.json')?Buffer.concat([b,Buffer.from('tamper')]):b)(root),/Card source hash mismatch/);
});
test('missing source is rejected',()=>{
  assert.throws(()=>loader((p,b)=>{if(p.endsWith('cards-source.json'))throw Error('Missing fixture source');return b;})(root),/Missing fixture source/);
});
test('source traversal outside package is rejected',()=>{
  assert.throws(()=>loader((p,b)=>{
    if(!p.endsWith('content-contract.json'))return b;
    const c=JSON.parse(b);c.source.path='../outside.txt';return Buffer.from(JSON.stringify(c));
  })(root),/must stay inside/);
});
