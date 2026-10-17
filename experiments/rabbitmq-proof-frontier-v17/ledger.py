#!/usr/bin/env python3
"""Local crash-consistent SQLite proof ledger for an isolated GitHub Actions job.
Never store AMQP secrets. For cross-run survival use a separate durable service:
a runner's local filesystem disappears after CI finishes.
"""
import json,sqlite3,sys
req=json.load(sys.stdin);action=req['action'];path=req['db']
con=sqlite3.connect(path,timeout=5,isolation_level=None)
con.execute('PRAGMA journal_mode=DELETE')
con.execute('PRAGMA synchronous=FULL')
con.execute('PRAGMA busy_timeout=5000')
con.execute('CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, root_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT "pending", attempts INTEGER NOT NULL DEFAULT 0, min_cost INTEGER, explored INTEGER, schedule_json TEXT, schedule_hash TEXT)')
con.execute('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id TEXT NOT NULL, kind TEXT NOT NULL, receipt TEXT)')
def rows():
 return [{'id':r[0],'root':json.loads(r[1]),'status':r[2],'attempts':r[3],
  'cost':r[4],'explored':r[5],'schedule':json.loads(r[6]) if r[6] else None,'hash':r[7]}
  for r in con.execute('SELECT id,root_json,status,attempts,min_cost,explored,schedule_json,schedule_hash FROM branches ORDER BY id')]
out={}
try:
 con.execute('BEGIN IMMEDIATE')
 if action=='init':
  for root in req['roots']:
   con.execute('INSERT INTO branches(id,root_json) VALUES(?,?)',(root['id'],json.dumps(root['entry'],separators=(',',':'))))
  out={'initialized':len(req['roots'])}
 elif action=='inspect':
  out={'branches':rows()}
 elif action=='claim':
  id=req['id']; row=con.execute('SELECT status,attempts FROM branches WHERE id=?',(id,)).fetchone()
  if not row:raise ValueError('UNKNOWN_BRANCH')
  if row[0]!='done':
   con.execute('UPDATE branches SET attempts=attempts+1 WHERE id=?',(id,))
   con.execute('INSERT INTO events(branch_id,kind) VALUES(?,"claim")',(id,))
  out={'done':row[0]=='done','attempts':row[1]+(row[0]!='done')}
 elif action=='complete':
  id=req['id']; row=con.execute('SELECT status,min_cost,schedule_hash FROM branches WHERE id=?',(id,)).fetchone()
  if not row:raise ValueError('UNKNOWN_BRANCH')
  if row[0]=='done':
   if row[1]!=req['cost'] or row[2]!=req['hash']:raise ValueError('CONFLICTING_DUPLICATE')
   out={'committed':False,'duplicate':True}
  else:
   if not isinstance(req['cost'],int) or req['cost']<0 or not isinstance(req['explored'],int) or req['explored']<1:
    raise ValueError('INVALID_COMPLETE_RESULT')
   con.execute('UPDATE branches SET status="done",min_cost=?,explored=?,schedule_json=?,schedule_hash=? WHERE id=?',
     (req['cost'],req['explored'],json.dumps(req['schedule'],separators=(',',':')),req['hash'],id))
   con.execute('INSERT INTO events(branch_id,kind,receipt) VALUES(?,"complete",?)',(id,req['hash']))
   out={'committed':True,'duplicate':False}
 elif action=='summary':
  allrows=rows();pending=[x for x in allrows if x['status']!='done'];done=[x for x in allrows if x['status']=='done']
  incumbent=req.get('verifiedIncumbentCost')
  upper=min([x['cost'] for x in done]+([incumbent] if isinstance(incumbent,int) else []),default=None)
  # Every unfinished root has the universally safe 0 lower bound;
  # each completed root has an exhaustive, independently verifiable minimum.
  lower=min(([0] if pending else [])+[x['cost'] for x in done],default=None)
  if upper is None or lower is None:raise ValueError('MISSING_VERIFIED_INCUMBENT')
  out={'lower':min(lower,upper),'upper':upper,
   'gap':upper-min(lower,upper),'optimal':len(pending)==0 and lower==upper,
   'total':len(allrows),'pending':len(pending),'completed':len(done),
   'claims':sum(x['attempts'] for x in allrows),
   'explored':sum(x['explored'] or 0 for x in done),
   'branches':allrows,
   'duplicateCommitEvents':con.execute('SELECT COUNT(*) FROM events WHERE kind="complete"').fetchone()[0]}
 else:raise ValueError('BAD_ACTION')
 con.commit()
 print(json.dumps(out,separators=(',',':')))
except Exception as e:
 con.rollback()
 print(json.dumps({'error':type(e).__name__+':'+str(e)}))
 sys.exit(3)
finally:con.close()
