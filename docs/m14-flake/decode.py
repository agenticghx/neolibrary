import json, sys
def dec(v, refs=None):
    if refs is None: refs = {}
    if not isinstance(v, dict): return v
    if 'n' in v: return v['n']
    if 's' in v: return v['s']
    if 'b' in v: return v['b']
    if 'v' in v:
        return {'null': None, 'undefined': None, 'NaN': float('nan'), 'Infinity': float('inf'), '-Infinity': float('-inf'), '-0': -0.0}[v['v']]
    if 'a' in v:
        out = []
        if 'id' in v: refs[v['id']] = out
        for x in v['a']: out.append(dec(x, refs))
        return out
    if 'o' in v:
        out = {}
        if 'id' in v: refs[v['id']] = out
        for kv in v['o']: out[kv['k']] = dec(kv['v'], refs)
        return out
    if 'ref' in v: return refs[v['ref']]
    if 'd' in v: return v['d']
    return v
def load(tracefile, callid):
    for line in open(tracefile):
        e = json.loads(line)
        if e['type']=='after' and e.get('callId')==callid:
            return dec(e['result']['value'])
