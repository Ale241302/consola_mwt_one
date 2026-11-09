import json, collections
from decimal import Decimal, ROUND_HALF_UP
R='/home/claude/dash/raw/'
PH={'R':'REGISTRO','PR':'PRODUCCION','PP':'PREPARACION','D':'DESPACHO','T':'TRANSITO','ED':'EN_DESTINO','C':'CERRADO'}
def num(x):
    return None if x=='' else float(x)
lista=[]
for ln in open(R+'lista.txt',encoding='utf-8'):
    f=ln.rstrip('\n').split('|')
    lista.append(dict(proforma_codigo=f[0],client_name=f[1],client_country=f[2],modo_operacion=f[3],estado=f[4],
        freight_mode=f[5] or None,operator_name=f[6],shipment_date=f[7] or None,eta=f[8] or None,
        total_client=num(f[9]),total_mwt=num(f[10]),order_value=num(f[11]),total_invoiced=num(f[12]),total_paid=num(f[13]),
        product_count=int(f[14]),fusion_label=f[15] or None,oc_codigos=[f[16]]))
det=[];cur=None
for ln in open(R+'det.txt',encoding='utf-8'):
    f=ln.rstrip('\n').split('|')
    if f[0]=='E':
        cur=dict(codigo=f[1],uuid=f[2],estado=f[3],phases=None,lineas=[]);det.append(cur)
    elif f[0]=='P':
        pd={}
        for seg in f[1].split(';'):
            k,rest=seg.split(':',1); sd,rest2=rest.split('>',1); ed,days=rest2.rsplit(':',1)
            o={}
            if sd!='~': o['start']=sd or None
            if ed!='~': o['end']=ed or None
            if days!='~': o['days']=int(days) if days else None
            pd[PH.get(k,k)]=o
        cur['phases']=pd
    elif f[0]=='L':
        sku,name,price,sizes=f[1],f[2],f[3],f[4]; zero=len(f)>5 and f[5]=='0'
        for sq in sizes.split(','):
            sz,q=sq.rsplit(':',1)
            tot=Decimal('0.00') if zero else (Decimal(q)*Decimal(price)).quantize(Decimal('0.01'),ROUND_HALF_UP)
            cur['lineas'].append(dict(sku=sku,modelo=name or None,talla=sz,cantidad=float(q),precio_unitario=float(price),total=float(tot)))
com=json.load(open(R+'comisiones.json'))['results']
comby={c['expediente_id']:c for c in com}
errores=[]
# match lista to det by code + estado order
pool=collections.defaultdict(list)
for d in det: pool[d['codigo']].append(d)
out=[]
for e in lista:
    cands=pool[e['proforma_codigo']]
    m=[d for d in cands if d['estado']==e['estado']] or cands
    d=m[0]; cands.remove(d)
    c=comby.get(d['uuid'])
    fin=None
    if c:
        fin={k:c.get(k) for k in ['proforma_codigo','commission_rate','commission_amount','devengo_estado','fecha_facturada','total_qty','credit_days_cliente']}
        for k in ['commission_rate','commission_amount','total_qty']:
            if fin[k] is not None: fin[k]=float(fin[k])
    else:
        errores.append(dict(codigo=e['proforma_codigo'],paso='finanzas',detalle='sin registro en finanzas_comisiones'))
    r=dict(proforma_codigo=e['proforma_codigo'],uuid=d['uuid'])
    r.update({k:e[k] for k in ['client_name','client_country','modo_operacion','estado','freight_mode','operator_name','shipment_date','eta','total_client','total_mwt','order_value','total_invoiced','total_paid','fusion_label','oc_codigos']})
    r['product_count']=e['product_count']
    r['phase_durations']=d['phases']
    r['lineas']=d['lineas']
    r['finanzas']=fin
    if d['phases'] is None: errores.append(dict(codigo=e['proforma_codigo'],paso='fases',detalle='sin phase_durations'))
    if not d['lineas']: errores.append(dict(codigo=e['proforma_codigo'],paso='lineas',detalle='sin lineas'))
    # checks
    if c and abs(float(c['total_qty'])-sum(l['cantidad'] for l in d['lineas']))>0.01:
        errores.append(dict(codigo=e['proforma_codigo'],paso='verificacion',detalle=f"pares en lineas {sum(l['cantidad'] for l in d['lineas'])} != total_qty finanzas {c['total_qty']}"))
    out.append(r)
for code,v in pool.items():
    for d in v: errores.append(dict(codigo=code,paso='cruce',detalle='detalle sin expediente en lista'))
clientes=[{"id":"2358fd1c-eeec-46ff-8dd0-69ff40800367","razon_social":"COMERCIALIZADORA UMMIE, S.A."},
{"id":"bb5b7f8b-59ea-4a68-9abf-11abc06ed840","razon_social":"DISTRIBUIDORA COMTEK S.A.S."},
{"id":"a79dfc89-cfea-4ce5-9bca-b77186a77d83","razon_social":"EQUIPOS Y GUANTES INDUSTRIALES S.A."},
{"id":"bf1d7f65-2be8-476b-8160-93e53ea42759","razon_social":"GRUPO SOLUCIONES DE INGENIERIA Y AUTOMATIZACION S.A."},
{"id":"c1b0b3d8-ea15-466e-b8a3-60d9d42c2816","razon_social":"IMPORCOMP S.A."},
{"id":"340fabff-64c0-45fb-a67c-dab6dea26ae2","razon_social":"IMPORTACIONES Y COMPRAS S DE RL"},
{"id":"5525986c-3b09-4d13-bf8f-43ccaa2deae3","razon_social":"Muito Work Limitada"},
{"id":"1f11421f-c48e-498c-8f2e-c7d1d032fbd7","razon_social":"PRO CUSTOMER CORP."},
{"id":"1b8846c4-3d5c-40ac-a3e6-3f313ed51849","razon_social":"SonDel Honduras S.A. de C.V."},
{"id":"c588c410-468a-4d54-b676-3bec174eb39d","razon_social":"Sondel S.A."},
{"id":"5f696777-d0e6-4cb7-a16f-64c830f0e310","razon_social":"SONEPAR COLOMBIA S.A.S."}]
pais={e['client_name']:e['client_country'] for e in lista}
for c in clientes:
    c['pais']=None; c['pais_segun_expedientes']=pais.get(c['razon_social']); c['segmento']='C'; c['estado']='ACTIVO'
errores.append(dict(codigo='*',paso='clientes',detalle="cliente_listar no devuelve 'pais'; se agrega pais_segun_expedientes. Sin is_parent=all omite SonDel Honduras (se uso is_parent=all)."))
errores.append(dict(codigo='2498-2026',paso='fases',detalle='primer expediente_obtener dio Bad Gateway; reintento OK'))
errores.append(dict(codigo='2478-2026 (CERRADO)',paso='uuid',detalle='listar/buscar no exponen UUID; se obtuvo desde finanzas_comisiones (9eb65937-...) y con el se leyeron fases y lineas'))
json.dump(dict(expedientes=out,clientes=clientes,errores=errores),open('/home/claude/dash/base_mwt.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(len(out), sum(1 for r in out if r['phase_durations']), sum(1 for r in out if r['lineas']), sum(l['cantidad'] for r in out for l in r['lineas']), sum(1 for r in out if r['finanzas']))
# value check
for r in out:
    s=sum(l['total'] for l in r['lineas'])
    if abs(s-r['total_mwt'])>0.05 and abs(s-r['total_client'])>0.05: print('valor',r['proforma_codigo'],r['estado'],round(s,2),r['total_mwt'],r['total_client'])
for x in errores: print(x)
