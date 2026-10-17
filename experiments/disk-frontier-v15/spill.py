#!/usr/bin/env python3
"""AAU v15 - SQLite-backed exact branch-and-bound frontier.

All child alternatives are inserted atomically in the same transaction as a
parent removal. On resource exhaustion the intact queue yields the certified
lower bound. No model calls; only Python stdlib sqlite3/resource/time.
"""
import json, math, os, resource, sqlite3, sys, time

def get_topology(jobs, index):
    done=set()
    order=[]
    while len(order)<len(jobs):
        ready=[i for i,j in enumerate(jobs)
               if i not in done and all(index[p] in done for p in j['parents'])]
        if not ready:
            raise ValueError("CYCLIC_OR_MISSING_DEPENDENCY")
        for i in ready:
            done.add(i)
            order.append(i)
    return order

def earliest(job,machine,previous,parent_finish):
    setup=0 if previous['last']==job['type'] else machine['setup']
    start=max(job['release'],parent_finish,previous['clock']+setup)
    windows=sorted(machine['maintenance'])
    for _ in range(len(windows)+3):
        blocked=next(((a,b) for a,b in windows
                      if start-setup < b and start+job['duration'] > a), None)
        if blocked is None:
            if start-setup<previous['clock'] or start-setup<0:
                raise ValueError("UNSAFE_SETUP_BOUNDARY")
            return start,start+job['duration']
        start=max(start+1,blocked[1]+setup)
    raise ValueError("MAINTENANCE_TRANSITION_FAILED")

def extra_activation(p,state):
    remaining={j['type'] for i,j in enumerate(p['jobs'])
               if not(state['mask']>>i)&1}
    covered=set()
    unused=[]
    for i,m in enumerate(p['machines']):
        if state['machines'][i]['used']:
            covered.update(m['types'])
        else:
            unused.append(m)
    if remaining.issubset(covered):
        return 0
    best=math.inf
    for mask in range(1,1<<len(unused)):
        types=set(covered)
        charge=0
        for i,m in enumerate(unused):
            if(mask>>i)&1:
                types.update(m['types'])
                charge+=m['activation']
        if remaining.issubset(types):
            best=min(best,charge)
    if not math.isfinite(best):
        raise ValueError("MISSING_ELIGIBLE_MACHINE")
    return best

def rank_bound(p,s,optimistic):
    forced=[[] for _ in p['machines']]
    flexible=[]
    for i,j in enumerate(p['jobs']):
        if(s['mask']>>i)&1:
            continue
        candidates=[mi for mi,m in enumerate(p['machines']) if j['type'] in m['types']]
        if len(candidates)==1:
            forced[candidates[0]].append(i)
        else:
            flexible.append(i)
    total=sum(max(0,optimistic[i]-p['jobs'][i]['due'])*p['jobs'][i]['weight']
              for i in flexible)
    for machine,indices in enumerate(forced):
        n=len(indices)
        if n==0:continue
        if n>9:
            total+=sum(max(0,optimistic[i]-p['jobs'][i]['due'])*p['jobs'][i]['weight']
                       for i in indices)
            continue
        durations=sorted(p['jobs'][i]['duration'] for i in indices)
        cumulative=[0]
        for d in durations:cumulative.append(cumulative[-1]+d)
        dp=[math.inf]*(1<<n)
        dp[0]=0
        for mask in range((1<<n)-1):
            if not math.isfinite(dp[mask]):continue
            rank=mask.bit_count()+1
            for bit,i in enumerate(indices):
                if(mask>>bit)&1:continue
                j=p['jobs'][i]
                finish=max(s['machines'][machine]['clock']+cumulative[rank],
                           j['release']+j['duration'],optimistic[i])
                penalty=max(0,finish-j['due'])*j['weight']
                nxt=mask|(1<<bit)
                dp[nxt]=min(dp[nxt],dp[mask]+penalty)
        total+=dp[-1]
    return total

def bound(p,state,topo,index,mode):
    ends=state['ends'][:]
    tardiness=0
    for i in topo:
        if(state['mask']>>i)&1:continue
        j=p['jobs'][i]
        parent_end=max([0]+[ends[index[x]] for x in j['parents']])
        ready=min((st['clock']+(0 if st['last']==j['type'] else m['setup'])
                   for st,m in zip(state['machines'],p['machines'])
                   if j['type'] in m['types']), default=math.inf)
        if not math.isfinite(ready):raise ValueError("INELIGIBLE_JOB")
        finish=max(j['release'],parent_end,ready)+j['duration']
        ends[i]=finish
        tardiness+=max(0,finish-j['due'])*j['weight']
    if mode=='forced_rank':
        tardiness=max(tardiness,rank_bound(p,state,ends))
    return state['cost']+tardiness+extra_activation(p,state)

def encode(s):
    return json.dumps(s,separators=(',',':'))

def main():
    config=json.load(sys.stdin)
    p=config['problem'];jobs=p['jobs'];machines=p['machines']
    db_path=config['dbPath']
    caps=config['caps'];cap_nodes=caps['maxExpansions']
    cap_entries=caps['maxQueueEntries'];cap_time=caps['maxWallMs'];cap_disk=caps['maxDatabaseBytes']
    mode=caps.get('boundMode','forced_rank')
    if len(jobs)>16 or len(machines)>10 or len(jobs)<1 or mode not in ('forced_rank','v12'):
        raise ValueError("BAD_SCOPE")
    index={j['id']:i for i,j in enumerate(jobs)}
    topo=get_topology(jobs,index)
    state={'mask':0,'ends':[-1]*len(jobs),
           'machines':[{'clock':0,'last':m['initialType'],'used':False} for m in machines],
           'cost':0,'path':[]}
    state['lb']=bound(p,state,topo,index,mode)
    root_lb=state['lb']
    incumbent=config['incumbent']
    upper=config['incumbentCost']
    best=incumbent
    db=sqlite3.connect(db_path)
    db.execute('PRAGMA journal_mode=DELETE')
    db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA temp_store=FILE')
    db.execute('CREATE TABLE states(id INTEGER PRIMARY KEY, lb INTEGER NOT NULL, mask INTEGER NOT NULL, data TEXT NOT NULL)')
    db.execute('CREATE INDEX queue_best ON states(lb ASC,mask DESC,id ASC)')
    db.execute('INSERT INTO states(lb,mask,data) VALUES(?,?,?)',(state['lb'],0,encode(state)))
    db.commit()
    start=time.monotonic()
    stats={'expanded':0,'generated':1,'pruned':0,'maxQueue':1,
           'diskBytesPeak':0,'physicalStatesPeak':1,'fullSolutions':0,
           'transactionRollbacks':0}
    exit_reason='running'
    whole_mask=(1<<len(jobs))-1
    def db_size():
        return sum(os.path.getsize(path) for path in (db_path,db_path+'-journal') if os.path.exists(path))
    while True:
        head=db.execute('SELECT id,lb,mask,data FROM states ORDER BY lb ASC, mask DESC,id ASC LIMIT 1').fetchone()
        if head is None or head[1]>=upper:
            exit_reason='proof_complete'
            break
        now=time.monotonic()
        if stats['expanded']>=cap_nodes:
            exit_reason='expansion_budget';break
        if (now-start)*1000>=cap_time:
            exit_reason='wall_budget';break
        if db_size()>cap_disk:
            exit_reason='disk_budget_soft';break
        ident,lower,mask,raw=head
        s=json.loads(raw)
        if mask==whole_mask:
            # A complete state with cost < upper is immediately a valid new candidate.
            # Independently re-checked by JS V6 evaluator outside this process.
            if s['cost']<upper:
                upper=s['cost']
                best={'jobs':s['path']}
                stats['fullSolutions']+=1
            db.execute('DELETE FROM states WHERE id=?',(ident,))
            db.commit();stats['expanded']+=1
            continue
        children=[]
        removed=0
        for i,j in enumerate(jobs):
            if(mask>>i)&1:continue
            parent_idx=[index[parent] for parent in j['parents']]
            if any(not ((mask>>pi)&1) for pi in parent_idx):continue
            parent_end=max([0]+[s['ends'][pi] for pi in parent_idx])
            for m,mspec in enumerate(machines):
                if j['type'] not in mspec['types']:continue
                t_end=earliest(j,mspec,s['machines'][m],parent_end)
                start_job,finish=t_end
                activation=0 if s['machines'][m]['used'] else mspec['activation']
                cost=s['cost']+activation+max(0,finish-j['due'])*j['weight']
                if cost>=upper:
                    removed+=1;continue
                child={'mask':mask|(1<<i),'ends':s['ends'][:],
                       'machines':[dict(x) for x in s['machines']],
                       'cost':cost,'path':s['path']+[{'id':j['id'],'machine':mspec['id']}]}
                child['ends'][i]=finish
                child['machines'][m]={'clock':finish,'last':j['type'],'used':True}
                child['lb']=bound(p,child,topo,index,mode)
                if child['lb']>=upper:
                    removed+=1;continue
                children.append(child)
        current_size=db.execute('SELECT COUNT(*) FROM states').fetchone()[0]
        if current_size-1+len(children)>cap_entries:
            # Atomic all-or-nothing. The original unexpanded parent stays on disk.
            stats['transactionRollbacks']+=1
            exit_reason='disk_queue_budget'
            break
        with db:
            db.execute('DELETE FROM states WHERE id=?',(ident,))
            db.executemany('INSERT INTO states(lb,mask,data) VALUES(?,?,?)',
                           [(c['lb'],c['mask'],encode(c)) for c in children])
        stats['expanded']+=1
        stats['generated']+=len(children)
        stats['pruned']+=removed
        outstanding=current_size-1+len(children)
        stats['maxQueue']=max(stats['maxQueue'],outstanding)
        stats['physicalStatesPeak']=max(stats['physicalStatesPeak'],outstanding)
        stats['diskBytesPeak']=max(stats['diskBytesPeak'],db_size())
    row=db.execute('SELECT MIN(lb),COUNT(*) FROM states').fetchone()
    remaining_lb,count=row
    low=min(upper,remaining_lb) if remaining_lb is not None else upper
    if low>upper or low<min(upper,root_lb):
        raise ValueError("INVALID_CERTIFICATE_INTERVAL")
    stats['dbBytesAtStop']=db_size()
    stats['peakRssKiB']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    stats['remainingQueue']=count
    stats['elapsedMs']=(time.monotonic()-start)*1000
    stats['sqlitePageCount']=db.execute('PRAGMA page_count').fetchone()[0]
    stats['sqlitePageBytes']=db.execute('PRAGMA page_size').fetchone()[0]
    db.close()
    json.dump({'lowerBound':low,'upperBound':upper,'gapUpper':upper-low,
      'certifiedOptimal':low==upper,'exitReason':exit_reason,
      'rootBound':root_lb,'incumbent':best,'stats':stats},sys.stdout,separators=(',',':'))
    sys.stdout.write('\n')

if __name__=='__main__':
    try: main()
    except Exception as exc:
        print(json.dumps({'error':type(exc).__name__+':'+str(exc)}))
        sys.exit(3)
