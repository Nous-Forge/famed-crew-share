"""Offline validation only. No model, network, shell child, or key access."""
import csv,hashlib,json,os,re,uuid,time
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from source_policy import PINNED_CORPUS_SHA256, APPROVED_SOURCE_PATHS, resolve_source_path, SourcePolicyError
BASE=Path(__file__).resolve().parent
_STUDIO_SUFFIX=('docs','studio','assignments','a3-agent-crew')
REPO=BASE.parents[3] if tuple(BASE.parts[-4:])==_STUDIO_SUFFIX else BASE
STAGES=('data','audit','print')
class CrewError(Exception):
    def __init__(self,kind,code,message,stage=None):
        self.kind,self.code,self.message,self.stage=kind,code,message,stage
        super().__init__(message)
    def as_dict(self):return dict(kind=self.kind,code=self.code,message=self.message,stage=self.stage)
def clock():return datetime.now(ZoneInfo('America/Los_Angeles')).isoformat()
def load(p):
    try:return json.loads(Path(p).read_text(encoding='utf-8-sig'))
    except (OSError,ValueError) as e:raise CrewError('FORMAT','JSON_READ','Could not read a valid JSON input') from e
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def atomic(p,value):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    tmp=p.with_name(p.name+'.'+uuid.uuid4().hex+'.tmp')
    raw=value if isinstance(value,str) else json.dumps(value,indent=2,ensure_ascii=False)+'\n'
    with tmp.open('x',encoding='utf-8',newline='') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    for attempt in range(5):
        try:os.replace(tmp,p);break
        except PermissionError as e:
            if attempt==4:raise CrewError("INFRA","ATOMIC_REPLACE","Could not finalize output file") from e
            time.sleep(0.05*(attempt+1))
def contract():return load(BASE/'schema/FAMED_CardRow.contract.json')
def source_path(s):
    try:return resolve_source_path(s,BASE,REPO)
    except SourcePolicyError as e:raise CrewError('SOURCE',e.code,e.public_message) from e

def print_text_comparison(raw,visible,synthetic=False):
    """Compare only established plain text, without interpreting render syntax."""
    if synthetic:return 'synthetic_match' if raw==visible else 'synthetic_mismatch'
    if re.search(r'\{\{|\{%|<[^>]+>|&(?:#\w+|\w+);',raw):return 'pending'
    return 'match' if ' '.join(raw.split())==' '.join(visible.split()) else 'mismatch'

def verify_sources(supplied=None):
    manifest=BASE/'inputs/corpus.json'
    if digest(manifest)!=PINNED_CORPUS_SHA256:raise CrewError('SOURCE','CORPUS_IDENTITY','Manifest differs from independently pinned identity')
    corpus=load(manifest)
    if supplied is not None and supplied!=corpus:raise CrewError('SOURCE','CORPUS_SUBSTITUTION','Caller-supplied corpus differs from pinned manifest')
    if {s['path'] for s in corpus['sources']}!=set(APPROVED_SOURCE_PATHS):raise CrewError('SOURCE','SOURCE_INVENTORY','Source inventory mismatch')
    for s in corpus['sources']:
        p=source_path(s['path'])
        if not p.is_file() or digest(p)!=s['sha256']:raise CrewError('SOURCE','SOURCE_HASH',s['id']+' is missing or changed')
    csv_source=next(s for s in corpus['sources'] if s['version']=='Wk11')
    if digest(BASE/'inputs/skill-cards.csv')!=csv_source['sha256']:raise CrewError('SOURCE','CSV_COPY_HASH','Pinned CSV copy changed')
    return corpus

def shape(stage,answer,c=None):
    c=c or contract()
    if not isinstance(answer,dict) or set(answer)!={'rows','usage_tokens'}:raise CrewError('FORMAT','ENVELOPE','Expected rows and usage_tokens',stage)
    if type(answer['usage_tokens']) is not int or answer['usage_tokens']<0:raise CrewError('FORMAT','USAGE','Nonnegative integer usage required',stage)
    rows=answer['rows']
    if not isinstance(rows,list) or len(rows)!=6:raise CrewError('FORMAT','ROW_COUNT','Exactly six rows required',stage)
    expected=set(c['selected_card_ids']);seen=[]
    required={'data':set(c['producer_fields']),'audit':{'RowName','RuleStatus','WindowSupport','decision','cite','notes'},'print':{'RowName','CardName','PrintedTimingLabel','CombatText','legibility','cite'}}[stage]
    for row in rows:
        if not isinstance(row,dict) or set(row)!=required:raise CrewError('FORMAT','FIELDS','Unexpected or missing fields',stage)
        seen.append(row['RowName'])
        if stage=='data':
            if type(row['SupplyCopies']) is not int or row['SupplyCopies']<0:raise CrewError('FORMAT','COPIES','Integer copies required',stage)
            for key in ('EffectTags','Unmapped'):
                if not isinstance(row[key],list) or any(not isinstance(v,str) for v in row[key]):raise CrewError('FORMAT','LIST','String list required: '+key,stage)
            for key in required-{'SupplyCopies','EffectTags','Unmapped'}:
                if not isinstance(row[key],str):raise CrewError('FORMAT','TEXT','String required: '+key,stage)
            for key in ('PileAfterUse','Duration','DurationSource'):
                if row[key] not in c['enums'][key]:raise CrewError('FORMAT','ENUM','Unknown '+key,stage)
            if row['SchemaVersion']!='v1':raise CrewError('FORMAT','VERSION','SchemaVersion must be v1',stage)
        else:
            if not isinstance(row['cite'],dict) or set(row['cite'])!={'source_id','section'} or any(not isinstance(v,str) or not v for v in row['cite'].values()):raise CrewError('FORMAT','CITE','Source ID and section required',stage)
            for k in required-{'cite'}:
                if not isinstance(row[k],str):raise CrewError('FORMAT','TEXT','String required: '+k,stage)
            if stage=='print' and row['legibility'] not in ('legible','unreadable','synthetic'):raise CrewError('FORMAT','LEGIBILITY_ENUM','Unknown print legibility',stage)
            if stage=='audit':
                for key in ('RuleStatus','WindowSupport'):
                    if row[key] not in c['enums'][key]:raise CrewError('FORMAT','ENUM','Unknown '+key,stage)
                if row['RuleStatus'] in ('STOP','PENDING_OWNER') and not row['decision']:raise CrewError('FORMAT','DECISION','Decision required',stage)
    if len(set(seen))!=6 or set(seen)!=expected:raise CrewError('FORMAT','ROW_IDS','Unique pinned IDs required; TEST rows forbidden',stage)
    return rows

def validate(data,audit,printed,corpus=None,fixture_only=False):
    corpus=verify_sources(corpus);c=contract()
    d=shape('data',data,c);a=shape('audit',audit,c);p=shape('print',printed,c)
    with (BASE/'inputs/skill-cards.csv').open(encoding='utf-8-sig') as source_file:
        original={r['name']:r for r in csv.DictReader(source_file)}
    selected=load(BASE/'inputs/selected-cards.json')
    if selected!=[original[i] for i in c['selected_card_ids']]:raise CrewError('SOURCE','SELECTED_COPY','Selected rows differ from pinned CSV')
    legends=load(BASE/'schema/tag-legend.json');sources={s['id']:s for s in corpus['sources']}
    issues=[];pending=[];packed=[];print_comparisons=[];print_holds=[]
    for r,ar,pr in ((r,next(x for x in a if x['RowName']==r['RowName']),next(x for x in p if x['RowName']==r['RowName'])) for r in d):
        card=original[r['RowName']]
        for k,ck in [('CardName','display_name'),('CombatText','D_text'),('ExplorationText','E_text'),('RawTimingCode','D_Phase')]:
            if r[k]!=card[ck]:issues.append(dict(kind='SOURCE',code='EXACT_TEXT',row=r['RowName'],field=k))
        if r['SupplyCopies']!=int(card['quantity']):issues.append(dict(kind='SOURCE',code='COPIES',row=r['RowName']))
        if r['SourceSHA256']!=next(s['sha256'] for s in corpus['sources'] if s['version']=='Wk11') or r['SourcePath']!=next(s['path'] for s in corpus['sources'] if s['version']=='Wk11'):issues.append(dict(kind='SOURCE',code='ROW_PROVENANCE',row=r['RowName']))
        if r['RawTimingCode'] not in ('{{ game.vars.declare_1 }}','{{ game.vars.respond_1 }}','{{ game.vars.respond_2 }}'):issues.append(dict(kind='STOP',code='UNKNOWN_TIMING',row=r['RowName']))
        if r['PileAfterUse']!='Discard Pile':issues.append(dict(kind='SOURCE',code='PILE_RULE',row=r['RowName'],field='PileAfterUse'))
        for tag in r['EffectTags']:
            if tag not in legends['supported']:issues.append(dict(kind='SOURCE',code='UNKNOWN_TAG',row=r['RowName'],tag=tag))
        for review in (ar,pr):
            if review['cite']['source_id'] not in sources:issues.append(dict(kind='SOURCE',code='CITE_SOURCE',row=r['RowName']))
        for key in ('CardName','PrintedTimingLabel'):
            if pr[key]!=r[key]:issues.append(dict(kind='SOURCE',code='BLIND_DIFF',row=r['RowName'],field=key))
        synthetic=fixture_only and pr['legibility']=='synthetic'
        comparison=print_text_comparison(r['CombatText'],pr['CombatText'],synthetic)
        print_comparisons.append(dict(row=r['RowName'],field='CombatText',comparison=comparison,synthetic=synthetic,source_text=r['CombatText'],blind_text=pr['CombatText']))
        if comparison=='pending':
            print_holds.append(dict(kind='REVIEW',code='PENDING_PRINT_COMPARISON',row=r['RowName'],field='CombatText',message='Visible blind reading retained; exact source rendering comparison is not established'))
        elif comparison in ('mismatch','synthetic_mismatch'):
            issues.append(dict(kind='SOURCE',code='BLIND_DIFF',row=r['RowName'],field='CombatText',synthetic=synthetic))
        if pr['legibility']!='legible' and not (fixture_only and pr['legibility']=='synthetic'):issues.append(dict(kind='SOURCE',code='PRINT_NOT_LEGIBLE',row=r['RowName']))
        if ar['RuleStatus']=='STOP':issues.append(dict(kind='STOP',code='AUDIT_STOP',row=r['RowName'],decision=ar['decision']))
        if ar['RuleStatus']=='PENDING_OWNER':pending.append({'RowName':r['RowName'],'decision':ar['decision'],'cite':ar['cite']})
        # Synthetic/pending evidence has no honest frozen PrintMatch wire value.
        diagnostic_row={**r,'WindowSupport':ar['WindowSupport'],'RuleStatus':ar['RuleStatus']}
        if not synthetic and comparison!='pending':
            diagnostic_row['PrintMatch']='unreadable' if pr['legibility']!='legible' else comparison
        packed.append(diagnostic_row)
    return {'print_legibility_proven':all(x['legibility']=='legible' for x in p),'fixture_only':fixture_only,'valid':not issues and not print_holds,'csv_exportable':not issues and not print_holds and not fixture_only and len(packed)==6,'release_approved':False,'status':'STOPPED_FOR_OWNER' if any(i['kind']=='STOP' for i in issues) else 'SOURCE_BLOCKED' if issues else 'PENDING_PRINT_COMPARISON' if print_holds else 'PENDING_OWNER' if pending else 'OFFLINE_VALIDATED','issues':issues,'pending_owner':pending,'print_review_holds':print_holds,'print_comparisons':print_comparisons,'rows':packed,'note':'Offline validation is infrastructure proof only. Synthetic comparisons cannot prove print. Human gates remain open.'}

def export(run,result):
    import io
    if result['valid'] and result.get('csv_exportable',False):
        buf=io.StringIO(newline='');w=csv.DictWriter(buf,fieldnames=contract()['csv_columns'],lineterminator='\n');w.writeheader()
        for row in result['rows']:
            wire={('Name' if k=='RowName' else k):(json.dumps(v,ensure_ascii=False) if isinstance(v,list) else v) for k,v in row.items()};w.writerow(wire)
        atomic(Path(run)/'DT_Cards.csv',buf.getvalue())
    atomic(Path(run)/'validation.json',result)
    atomic(Path(run)/'qa-report.md','# Offline QA report\n\nStatus: '+result['status']+'\n\nRelease approved: false. My review (Gate 1), the independent check (Gate 2) and my sign-off (Gate 3) remain open.\n\nPending owner: '+json.dumps(result['pending_owner'],ensure_ascii=False)+'\n\nIssues: '+json.dumps(result['issues'],ensure_ascii=False)+'\n\nPrint review holds: '+json.dumps(result.get('print_review_holds',[]),ensure_ascii=False)+'\n\nPrint comparisons: '+json.dumps(result.get('print_comparisons',[]),ensure_ascii=False)+'\n\n'+footer())
def footer():return '\u00a9 2026 Piero L. S. Folly | Khi-Rho Studios | Copy GDD-HO-'+uuid.uuid4().hex[:10].upper()+' | All rights reserved.\n'
def cli(argv=None):
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('run',type=Path);ap.add_argument('--output',type=Path,required=True,help='New validation receipt directory outside the source run');ap.add_argument('--fixture-only',action='store_true');args=ap.parse_args(argv)
    try:
        run=args.run.resolve();output=args.output.resolve()
        if output==run or output.is_relative_to(run):raise CrewError('INFRA','OUTPUT_BOUNDARY','Validation output must be outside the source run')
        if output.exists():raise CrewError('INFRA','OUTPUT_EXISTS','Validation output directory already exists')
        if not run.is_dir():raise CrewError('FORMAT','RUN_INPUT','Source run directory is unavailable')
        inputs={name:run/name for name in ('rows.json','audit.json','print-match.json')}
        if any(p.is_symlink() or not p.is_file() or p.resolve().parent!=run for p in inputs.values()):raise CrewError('SOURCE','RUN_INPUT_BOUNDARY','Source run inputs must be regular files within the run')
        hashes={name:digest(p) for name,p in inputs.items()}
        res=validate(*(load(p) for p in inputs.values()),fixture_only=args.fixture_only)
        if hashes!={name:digest(p) for name,p in inputs.items()}:raise CrewError('SOURCE','RUN_INPUT_CHANGED','Source run inputs changed during validation')
        output.mkdir(parents=True,exist_ok=False)
        export(output,res)
        atomic(output/'validation-receipt.json',{'source_run':str(run),'validated_at':clock(),'input_sha256':hashes,'status':res['status'],'release_approved':False})
        print(json.dumps({'status':res['status'],'valid':res['valid'],'release_approved':False}));return 0 if res['valid'] else 3
    except CrewError as e:print(json.dumps(e.as_dict()));return 2
    except Exception:print(json.dumps(CrewError('INFRA','UNEXPECTED_VALIDATION_ERROR','Validation could not complete; source run was not modified').as_dict()));return 2

if __name__=='__main__':raise SystemExit(cli())
