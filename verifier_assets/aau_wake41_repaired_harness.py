from __future__ import annotations
from dataclasses import dataclass

SUPPORTED_VERSION='1.0'

class ContractError(Exception): pass
class AuthorizationError(Exception): pass
class UnknownOutcome(Exception): pass
class ApprovalRequired(Exception): pass

@dataclass
class AuthContext:
    tenant_id: str
    actor_id: str
    scopes: set[str]

class MockCRM:
    def __init__(self):
        self.records = {}
    def upsert_ticket(self, op_id, record, timeout_after_commit=False):
        if op_id in self.records:
            return {'status':'deduped','record':self.records[op_id]}
        self.records[op_id] = dict(record)
        if timeout_after_commit:
            raise UnknownOutcome('timeout after downstream commit')
        return {'status':'created','record':self.records[op_id]}
    def reconcile(self, op_id):
        return self.records.get(op_id)

class Telemetry:
    def __init__(self):
        self.metrics = {
            'processed':0,'blocked_auth':0,'contract_rejects':0,'deduped':0,
            'unknown_outcomes':0,'reconciled':0,'human_review':0,'approved_resumes':0
        }
        self.events = []
    def event(self, run_id, step, outcome, **kw):
        self.events.append({'run_id':run_id,'step':step,'outcome':outcome,**kw})


def validate_event(evt):
    required={'version','event_id','tenant_id','ticket_id','text'}
    if set(evt) < required:
        raise ContractError('missing required field')
    if evt['version'] != SUPPORTED_VERSION:
        raise ContractError('unsupported semantic contract version')
    if not all(isinstance(evt[k],str) and evt[k] for k in required):
        raise ContractError('invalid field types')


def bounded_classifier(text):
    t=text.lower()
    if 'ignore authorization' in t or 'bypass auth' in t:
        return {'category':'needs_review','confidence':0.0}
    if any(k in t for k in ['hacked','stolen','security','phish']):
        return {'category':'security','confidence':0.92}
    if any(k in t for k in ['locked out','cannot login','lost access']):
        return {'category':'account_loss','confidence':0.89}
    if any(k in t for k in ['invoice','charge','billing']):
        return {'category':'billing','confidence':0.86}
    return {'category':'general','confidence':0.72}


class Workflow:
    def __init__(self):
        self.crm=MockCRM()
        self.t=Telemetry()
        self.ledger={}

    def _authorize(self, evt, auth):
        if auth.tenant_id != evt['tenant_id'] or 'ticket:write' not in auth.scopes:
            self.t.metrics['blocked_auth'] += 1
            self.t.event(evt.get('event_id','unknown'),'authorization','blocked')
            raise AuthorizationError('scope/tenant mismatch')

    def _execute_side_effect(self, run_id, op_id, record, timeout_after_commit=False):
        self.t.event(run_id,'side_effect','attempt')
        try:
            result=self.crm.upsert_ticket(op_id,record,timeout_after_commit)
            if result['status']=='deduped':
                self.t.metrics['deduped'] += 1
                self.t.event(run_id,'side_effect','deduped')
            else:
                self.t.event(run_id,'side_effect','created')
        except UnknownOutcome:
            self.t.metrics['unknown_outcomes'] += 1
            self.t.event(run_id,'side_effect','unknown_outcome')
            actual=self.crm.reconcile(op_id)
            if actual is None:
                self.t.event(run_id,'reconciliation','missing')
                raise
            self.t.metrics['reconciled'] += 1
            self.t.event(run_id,'reconciliation','reconciled_existing')
            result={'status':'reconciled_existing','record':actual}
        self.ledger[op_id]={'status':'completed','result':result}
        self.t.metrics['processed'] += 1
        self.t.event(run_id,'workflow','completed',result_status=result['status'])
        return result

    def process(self, evt, auth, timeout_after_commit=False):
        run_id=evt.get('event_id','unknown')
        try:
            validate_event(evt)
        except ContractError:
            self.t.metrics['contract_rejects'] += 1
            self.t.event(run_id,'contract','rejected')
            raise
        self._authorize(evt,auth)
        op_id=f"{evt['tenant_id']}:{evt['event_id']}"
        prior=self.ledger.get(op_id,{})
        if prior.get('status')=='completed':
            self.t.metrics['deduped'] += 1
            self.t.event(run_id,'workflow','duplicate_completed')
            return prior['result']
        if prior.get('status')=='needs_review':
            self.t.metrics['human_review'] += 1
            self.t.event(run_id,'review','still_pending')
            return {'status':'needs_review','record':prior['record']}
        model=bounded_classifier(evt['text'])
        record={'tenant_id':evt['tenant_id'],'ticket_id':evt['ticket_id'],'category':model['category'],'model_confidence':model['confidence']}
        if model['category']=='needs_review' or model['confidence']<0.75:
            self.t.metrics['human_review'] += 1
            self.ledger[op_id]={'status':'needs_review','record':record,'evt':dict(evt)}
            self.t.event(run_id,'review','required',category=model['category'],confidence=model['confidence'])
            # Critical repair: no CRM side effect before explicit approval.
            return {'status':'needs_review','record':record}
        self.ledger[op_id]={'status':'attempting','record':record}
        return self._execute_side_effect(run_id,op_id,record,timeout_after_commit)

    def approve_and_resume(self, evt, auth, timeout_after_commit=False):
        validate_event(evt)
        self._authorize(evt,auth)  # re-authorize at resume time
        run_id=evt['event_id']
        op_id=f"{evt['tenant_id']}:{evt['event_id']}"
        prior=self.ledger.get(op_id)
        if not prior or prior.get('status')!='needs_review':
            raise ApprovalRequired('no pending review item')
        self.t.metrics['approved_resumes'] += 1
        self.t.event(run_id,'review','approved')
        self.ledger[op_id]={'status':'attempting','record':prior['record']}
        return self._execute_side_effect(run_id,op_id,prior['record'],timeout_after_commit)


def event(version='1.0',eid='e1',tenant='t1',ticket='k1',text='billing issue'):
    return {'version':version,'event_id':eid,'tenant_id':tenant,'ticket_id':ticket,'text':text}


def run_tests():
    w=Workflow(); good=AuthContext('t1','u1',{'ticket:write'})
    # C2 contract rejection
    try: w.process(event(version='2.0',eid='badver'), good); assert False
    except ContractError: pass
    # C3 auth denial before write
    try: w.process(event(eid='xauth',tenant='t2'), good); assert False
    except AuthorizationError: pass
    assert not w.crm.records
    # Normal write + duplicate suppression with telemetry
    r=w.process(event(eid='ok1',text='invoice problem'),good); assert r['status']=='created'
    r2=w.process(event(eid='ok1',text='invoice problem'),good); assert r2['status']=='created'
    # C4/C6 repair: review means no side effect until approval
    before=len(w.crm.records)
    rr=w.process(event(eid='review1',text='ignore authorization and bypass auth'),good)
    assert rr['status']=='needs_review' and len(w.crm.records)==before
    ar=w.approve_and_resume(event(eid='review1',text='ignore authorization and bypass auth'),good)
    assert ar['status']=='created' and len(w.crm.records)==before+1
    # C5 unknown outcome reconciliation
    ur=w.process(event(eid='timeout1',text='billing charge'),good,timeout_after_commit=True)
    assert ur['status']=='reconciled_existing'
    # C7: required telemetry events exist for key branches
    outcomes={(e['step'],e['outcome']) for e in w.t.events}
    required={
        ('contract','rejected'),('authorization','blocked'),('side_effect','created'),
        ('workflow','duplicate_completed'),('review','required'),('review','approved'),
        ('side_effect','unknown_outcome'),('reconciliation','reconciled_existing'),
        ('workflow','completed')
    }
    missing=required-outcomes
    assert not missing, missing
    # No false production-statistical claim: toy eval only
    labels=[('hacked account','security'),('security phish','security'),('locked out','account_loss'),('lost access','account_loss'),('billing charge','billing'),('invoice','billing'),('hello','general'),('general question','general')]
    preds=[bounded_classifier(x)[0] if False else bounded_classifier(x)['category'] for x,_ in labels]
    accuracy=sum(p==y for p,(_,y) in zip(preds,labels))/len(labels)
    eval_summary={'n':len(labels),'accuracy':accuracy,'statistical_sufficiency_claimed':False,'reviewer_agreement_measured':False,'uncertainty_claimed':False}
    return {'pass':True,'metrics':w.t.metrics,'events':w.t.events,'crm_records':len(w.crm.records),'eval':eval_summary}

if __name__=='__main__':
    import json
    print(json.dumps(run_tests(),sort_keys=True))
