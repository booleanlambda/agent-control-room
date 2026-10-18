import sys,json,itertools

def solve():
    data=json.load(sys.stdin)
    controls=data['controls']
    required=set(data.get('requiredTags',[]))
    mandatory=set(data.get('mandatory',[]))
    
    ctrl_by_id={c['id']:c for c in controls}
    ids=sorted(ctrl_by_id.keys())
    
    # Validate mandatory IDs exist
    for mid in mandatory:
        if mid not in ctrl_by_id:
            print(json.dumps({"selected":[],"cost":0}))
            return
    
    best_cost=float('inf')
    best_sel=None
    
    n=len(ids)
    # iterate all subsets
    for mask in range(1<<n):
        cost=0
        covered=set()
        sel=[]
        for i in range(n):
            if mask>>i & 1:
                cid=ids[i]
                c=ctrl_by_id[cid]
                cost+=c['cost']
                covered.update(c.get('tags',[]))
                sel.append(cid)
        # Compute transitive closure of requires dependencies
        sel_set=set(sel)
        closure=set(sel)
        changed=True
        while changed:
            changed=False
            for cid in list(closure):
                for req in ctrl_by_id[cid].get('requires',[]):
                    if req not in closure:
                        closure.add(req)
                        changed=True
        # If closure expanded beyond selected set, this subset is invalid (dependencies not self-contained)
        if closure!=sel_set:
            continue
        # Check exclusions: no selected control may have an excluded ID also selected
        valid_exclusions=True
        for cid in sel_set:
            for excl in ctrl_by_id[cid].get('excludes',[]):
                if excl in sel_set:
                    valid_exclusions=False
                    break
            if not valid_exclusions:
                break
        if not valid_exclusions:
            continue
        # Add closure costs if any missing (but closure==sel_set means all deps already included)
        # Count tags among selected controls for atLeast and atMost constraints
        tag_counts={}
        for cid in sel_set:
            for t in ctrl_by_id[cid].get('tags',[]):
                tag_counts[t]=tag_counts.get(t,0)+1
        at_least_ok=True
        for al in data.get('atLeast',[]):
            if tag_counts.get(al['tag'],0)<al['count']:
                at_least_ok=False
                break
        at_most_ok=True
        for am in data.get('atMost',[]):
            if tag_counts.get(am['tag'],0)>am['count']:
                at_most_ok=False
                break
        # Check exact tag counts: every {tag,count} requires exactly that many selected controls with the tag
        exact_ok=True
        for ex in data.get('exactly',[]):
            if tag_counts.get(ex['tag'],0)!=ex['count']:
                exact_ok=False
                break
        # Check anyOf constraints: for each group at least one ID must be selected
        any_of_ok=True
        for group in data.get('anyOf',[]):
            if not any(gid in sel_set for gid in group):
                any_of_ok=False
                break
        # Check requiresAny constraints: every {id,oneOf} requires at least one oneOf ID when id is selected
        requires_any_ok=True
        for ra in data.get('requiresAny',[]):
            if ra['id'] in sel_set:
                if not any(alt in sel_set for alt in ra['oneOf']):
                    requires_any_ok=False
                    break
        # Check mandatory inclusion AND required tag coverage AND atLeast AND atMost AND anyOf AND requiresAny constraints AND budget
        budget=data.get('budget',None)
        if mandatory<=sel_set and required<=covered and at_least_ok and at_most_ok and any_of_ok and (budget is None or cost<=budget):
            if cost<best_cost or (cost==best_cost and (best_sel is None or sel[:]<best_sel)):
                best_cost=cost
                best_sel=sel[:]
    
    if best_sel is None:
        print(json.dumps({"selected":[],"cost":None}))
    else:
        print(json.dumps({"selected":sorted(best_sel),"cost":best_cost}))

if __name__=='__main__':
    solve()
