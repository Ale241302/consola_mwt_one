import json,csv,re,datetime as dt,statistics as st,collections,sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from _paths import ENTRADAS, SALIDAS, preparar
from ledger import L
preparar()
HOY=dt.date(2026,11,8)
B=json.load(open(ENTRADAS/'base_mwt.json'))
C=json.load(open(ENTRADAS/'carpetas.json'))
CC={r['proforma']:r for r in csv.DictReader(open(ENTRADAS/'cobro_cruce.csv',encoding='utf-8-sig'))}
def ncli(n):
    n=n.lower()
    for k,v in [('honduras','Sondel Honduras'),('sondel','Sondel'),('imporcomp','Imporcomp'),('importaciones','Importaciones y Compras'),('ummie','Ummie'),('comtek','Comtek'),('pro customer','Pro Customer'),('equipos y guantes','Eguisa / SIASA'),('grupo soluciones','Eguisa / SIASA'),('sonepar','Sonepar')]:
        if k in n: return v
    return n
PAIS={'Sondel':'Costa Rica','Sondel Honduras':'Honduras','Imporcomp':'Guatemala','Ummie':'Guatemala','Eguisa / SIASA':'Guatemala','Comtek':'Colombia','Sonepar':'Colombia','Importaciones y Compras':'Honduras','Pro Customer':'Panamá','Magnesita':'Perú','Agrofortres':'Sin dato','Sin identificar':'Sin dato','Sondel (no confirmado)':'Costa Rica'}
def key(p): return re.sub(r'^PF[ -]?','',p.strip()) if re.match(r'^PF \d',p) else p.strip()
def d(s): return dt.date.fromisoformat(s) if s else None
ped={}
for c in C:
    cli=c['cliente'].replace('Sondel (supuesto)','Sondel (no confirmado)')
    ped[c['proforma']]=dict(proforma=c['proforma'],anio=c['anio'],negocio=c['negocio'],cliente=cli,usd=c['usd'],usd_fuente=c['usd_fuente'] or 'sin monto',en_mwt='no',estado='sin cargar en mwt.one',modo='',pares=None,registro='',salida='',llegada='',cierre='')
seen=collections.Counter()
for x in B['expedientes']:
    k=key(x['proforma_codigo']); seen[k]+=1
    if seen[k]>1: k=k+' (2)'
    ph=x['phase_durations'] or {}
    g=lambda f,s: (ph.get(f) or {}).get(s)
    neg='reventa' if x['modo_operacion']=='FULL' else 'comision'
    cli=ncli(x['client_name'])
    r=ped.get(k) or ped.get(key(x['proforma_codigo'])) if seen[key(x['proforma_codigo'])]==1 else None
    kb=key(x['proforma_codigo']); anio=int(kb[-4:]) if re.search(r'20\d\d$',kb) else int(kb.split('-')[1])
    est={'CERRADO':'cerrado','EN_DESTINO':'en destino','TRANSITO':'en tránsito','PRODUCCION':'en producción','REGISTRO':'registrado','PREPARACION':'en preparación','DESPACHO':'en despacho'}[x['estado']]
    ped[k]=dict(proforma=k,anio=anio,negocio=neg,cliente=cli,usd=round(x['total_client'],2),usd_fuente='mwt.one (líneas)',en_mwt='sí',estado=est,
        modo={'AIR':'aéreo','SEA':'marítimo'}.get(x['freight_mode'],'sin dato'),pares=sum(l['cantidad'] for l in x['lineas'] if l.get('sku')!='801048'),
        registro=g('REGISTRO','start') or '',salida=g('TRANSITO','start') or '',llegada=g('EN_DESTINO','start') or '',cierre=(g('CERRADO','end') if x['estado']=='CERRADO' else '') or '',
        _ph=ph,_x=x)
for p in ped.values():
    p['pais']=PAIS.get(p['cliente'],'Sin dato')
    if p['proforma'] in ('2395-2025','2256-2024'): p['negocio']='reventa'

# ---- D1 · códigos PF- que son el mismo pedido que su proforma canónica
# 2491-2026 existe como carpeta (02 M Muito Work\...\2491-2026 PO 20330) y se
# cargó en mwt.one como "PF-2026-0001". Son el MISMO pedido: sin esta fusión la
# ficha lo cuenta dos veces (60) y la tabla por cliente una (59).
RENOMBRES_PF={'PF-2026-0001':'2491-2026'}
for _origen,_canonico in list(RENOMBRES_PF.items()):
    if _origen not in ped: continue
    _datos=ped.pop(_origen)
    if _canonico in ped:
        for _k in ('usd','usd_fuente','en_mwt','estado','modo','pares','registro','salida','llegada','cierre'):
            ped[_canonico][_k]=_datos[_k]
        ped[_canonico]['_x']=_datos.get('_x') or ped[_canonico].get('_x')
        ped[_canonico]['_ph']=_datos.get('_ph') or ped[_canonico].get('_ph')
        print('D1 fusionado',_origen,'->',_canonico)
    else:
        _datos['proforma']=_canonico
        ped[_canonico]=_datos
        print('D1 renombrado',_origen,'->',_canonico)

# ---- dataset pedidos
cols=['proforma','anio','negocio','cliente','pais','usd','usd_fuente','en_mwt','estado','modo','pares','registro','salida','llegada','cierre']
with open('ds_pedidos.csv','w',newline='') as f:
    w=csv.DictWriter(f,cols,extrasaction='ignore');w.writeheader();[w.writerow(p) for p in sorted(ped.values(),key=lambda p:p['proforma'])]
print('pedidos',len(ped),collections.Counter((p['anio'],p['en_mwt']) for p in ped.values()))
# ---- comisiones
with open('ds_comisiones.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['fecha','mes','anio','factura','cliente','proformas','usd','tipo','confianza'])
    for r in L: w.writerow([r[0],r[0][:7],int(r[0][:4]),r[1],r[2],r[3],round(r[4],2),r[5],r[6]])
# ---- por cobrar comision: enviados sin linea en facturas de comision
inv=set()
for r in L:
    for n in re.findall(r'\b(2\d{3})\b',r[3]): inv.add(n)
pc=[]
for p in ped.values():
    if p['negocio']!='comision' or p['anio']<2024: continue
    n=p['proforma'][:4]
    if n in inv: continue
    if p['en_mwt']=='sí':
        if p['estado'] not in('en destino','cerrado'): continue
        ref=p['llegada'] or p['salida']
    else:
        cr=CC.get(p['proforma'],{})
        if p['usd_fuente']!='factura': continue  # sin factura Marluvas no hay evidencia de envio
        ref=''
    rate=(p['_x']['finanzas'] or {}).get('commission_rate') if p.get('_x') else None
    rate=rate or 0.10
    dias=(HOY-d(ref)).days if ref else None
    pc.append(dict(proforma=p['proforma'],cliente=p['cliente'],usd_pedido=p['usd'],tasa=rate,comision_estimada=round((p['usd'] or 0)*rate,2),estado=p['estado'],llegada=ref,dias=dias))
pc.sort(key=lambda r:-(r['dias'] or 0))
with open('ds_por_cobrar.csv','w',newline='') as f:
    w=csv.DictWriter(f,list(pc[0]));w.writeheader();[w.writerow(r) for r in pc]
print('por cobrar',len(pc),round(sum(r['comision_estimada'] for r in pc),2))
for r in pc: print(r)
json.dump({k:{kk:vv for kk,vv in v.items() if kk!='_x'} for k,v in ped.items()},open('ped.json','w'),default=str)
# ---- reventa abierta
for p in ped.values():
    if p['negocio']=='reventa' and p['en_mwt']=='sí' and p['estado']!='cerrado' and p['llegada']:
        pc.append(dict(proforma=p['proforma'],cliente=p['cliente'],usd_pedido=p['usd'],tasa='',comision_estimada='',estado=p['estado'],llegada=p['llegada'],dias=(HOY-d(p['llegada'])).days))
for r in pc:
    r['negocio']='reventa' if r['tasa']=='' else 'comision'
    r['monto']=r['usd_pedido'] if r['negocio']=='reventa' else r['comision_estimada']
    lim=91 if r['negocio']=='comision' else 51
    r['situacion']='sin fecha de llegada en mwt.one' if r['dias'] is None else ('dentro del plazo habitual' if r['dias']<=lim else 'pasado del plazo habitual')
with open('ds_por_cobrar.csv','w',newline='') as f:
    cols=['proforma','negocio','cliente','estado','llegada','dias','usd_pedido','tasa','monto','situacion']
    w=csv.DictWriter(f,cols,extrasaction='ignore');w.writeheader();[w.writerow(r) for r in pc]
# ---- tiempos por etapa (cerrados)
ET=[('PRODUCCION','Producción'),('PREPARACION','Preparación'),('TRANSITO','Tránsito')]
agg=collections.defaultdict(list)
for p in ped.values():
    if p['en_mwt']!='sí' or p['estado']!='cerrado' or p['proforma'].startswith('PF-'): continue
    ph=p['_ph']
    for e,lab in ET:
        v=(ph.get(e) or {}).get('days')
        if v is not None: agg[(p['negocio'],p['modo'],lab)].append(v)
    if p['llegada'] and p['cierre'] and d(p['cierre'])>=d(p['llegada']):
        agg[(p['negocio'],p['modo'],'Llegada a cobro')].append((d(p['cierre'])-d(p['llegada'])).days)
    if p['registro'] and p['cierre']:
        agg[(p['negocio'],p['modo'],'Ciclo completo')].append((d(p['cierre'])-d(p['registro'])).days)
rows=[]
for (n,m,e),v in sorted(agg.items()):
    rows.append(dict(negocio=n,modo=m,etapa=e,expedientes=len(v),mediana=st.median(v),promedio=round(st.mean(v),1)))
with open('ds_tiempos.csv','w',newline='') as f:
    w=csv.DictWriter(f,list(rows[0]));w.writeheader();[w.writerow(r) for r in rows]
MED={(r['negocio'],r['modo'],r['etapa']):r['mediana'] for r in rows}
# ---- en curso
EST={'en producción':('PRODUCCION','Producción'),'en preparación':('PREPARACION','Preparación'),'en tránsito':('TRANSITO','Tránsito'),'en destino':('EN_DESTINO','Llegada a cobro'),'registrado':('REGISTRO',None)}
ec=[]
for p in ped.values():
    if p['en_mwt']!='sí' or p['estado']=='cerrado': continue
    code,lab=EST[p['estado']]
    st_=(p['_ph'].get(code) or {}).get('start')
    dias=(HOY-d(st_)).days if st_ else None
    med=MED.get((p['negocio'],p['modo'],lab)) if lab else None
    if med is None and lab:
        vs=[r['mediana'] for r in rows if r['negocio']==p['negocio'] and r['etapa']==lab]
        med=st.median(vs) if vs else None
    sit='sin referencia' if med is None or dias is None else ('atrasado' if dias>1.5*max(med,7) else 'en plazo')
    ec.append(dict(proforma=p['proforma'],negocio=p['negocio'],cliente=p['cliente'],etapa=p['estado'],modo=p['modo'],desde=st_ or '',dias_en_etapa=dias,mediana_etapa=med if med is not None else '',situacion=sit,usd=p['usd'],pares=p['pares']))
ALIAS={'2491-2026':'cargado como PF-2026-0001','2400-2026':'cargado dentro de 2405-2026','2478B-2026':'cargado como segundo expediente 2478-2026','2467-2026':'cancelado el 16/09/2026','2416-2026':'anulada el 08/11/2026','2380-2025':'sin expediente'}
for p in ped.values():
    if p['en_mwt']=='no' and p['anio']==2026 and p['proforma'] not in ALIAS:
        ec.append(dict(proforma=p['proforma'],negocio=p['negocio'],cliente=p['cliente'],etapa='sin cargar en mwt.one',modo='',desde='',dias_en_etapa='',mediana_etapa='',situacion='sin cargar',usd=p['usd'] or '',pares=''))
ORD={'atrasado':0,'sin cargar':1,'sin referencia':2,'en plazo':3}
ec.sort(key=lambda r:(ORD[r['situacion']],-(r['dias_en_etapa'] or 0)))
with open('ds_en_curso.csv','w',newline='') as f:
    w=csv.DictWriter(f,list(ec[0]));w.writeheader();[w.writerow(r) for r in ec]
print('en curso');[print(r) for r in ec]
print('tiempos');[print(r) for r in rows]
# ---- clientes por año
ca=collections.defaultdict(lambda: dict(pedidos=0,usd=0.0,usd_prof=0.0,sin_monto=0,comision=0.0))
for p in ped.values():
    if p['proforma'].startswith('PF-'): continue
    k=(p['cliente'],p['negocio'],p['anio']); ca[k]['pedidos']+=1
    if not p['usd']: ca[k]['sin_monto']+=1
    elif p['usd_fuente']=='proforma': ca[k]['usd_prof']+=p['usd']
    else: ca[k]['usd']+=p['usd']
for r in L:
    if r[5]!='comision': continue
    cli=r[2]
    k=(cli,'comision',int(r[0][:4])); ca[k]['comision']+=r[4]
with open('ds_clientes_anio.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['cliente','pais','negocio','anio','pedidos','usd_confirmado','usd_solo_proforma','pedidos_sin_monto','comision_facturada'])
    for (c,n,a),v in sorted(ca.items()):
        w.writerow([c,PAIS.get(c,'Sin dato'),n,a,v['pedidos'],round(v['usd'],2),round(v['usd_prof'],2),v['sin_monto'],round(v['comision'],2)])
# ---- productos (lineas mwt.one, sin plantillas)
pr=collections.defaultdict(lambda: dict(pares=0,usd=0.0,clientes=set(),exp=set()))
for p in ped.values():
    x=p.get('_x')
    if not x or p['proforma'].startswith('PF-'): continue
    for l in x['lineas']:
        if l.get('sku')=='801048': continue
        m=(l.get('modelo') or ('SKU '+str(l.get('sku')))).strip()
        k=(m,p['anio']); pr[k]['pares']+=l['cantidad']; pr[k]['usd']+=l['cantidad']*(l.get('precio_unitario') or 0); pr[k]['clientes'].add(p['cliente']); pr[k]['exp'].add(p['proforma'])
with open('ds_productos.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['modelo','anio','pares','usd','precio_medio','clientes','expedientes'])
    for (m,a),v in sorted(pr.items(),key=lambda x:(-x[0][1],-x[1]['pares'])):
        w.writerow([m,a,int(v['pares']),round(v['usd'],2),round(v['usd']/v['pares'],2) if v['pares'] else '',', '.join(sorted(v['clientes'])),len(v['exp'])])
# ---- cobertura
cob=collections.defaultdict(lambda: dict(carpetas=0,con_monto=0,en_mwt=0,con_sap=0))
SIN_SAP={'2415-2026'}
NO_PEDIDO={'2165-2024','2258-2024','2193-2024','2341-2025','2348-2025','2350-2025','2351-2025','2400-2025','2401-2025','2416-2026','2467-2026'}
CUBIERTO={'2400-2026','2478B-2026','2491-2026'}
for p in ped.values():
    if p['proforma'].startswith('PF-') or p['proforma'] in NO_PEDIDO: continue
    cub=p['proforma'] in CUBIERTO
    c=cob[p['anio']]; c['carpetas']+=1; c['con_monto']+= 1 if (p['usd'] or cub) else 0; c['en_mwt']+= 1 if (p['en_mwt']=='sí' or cub) else 0; c['con_sap']+= 1 if ((p['en_mwt']=='sí' or cub) and p['proforma'] not in SIN_SAP) else 0
inv_by_year=collections.Counter(int(r[0][:4]) for r in L)
with open('ds_cobertura.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['anio','carpetas','con_monto','en_mwt','con_sap','pct_con_monto','pct_en_mwt'])
    for a,v in sorted(cob.items()):
        w.writerow([a,v['carpetas'],v['con_monto'],v['en_mwt'],v['con_sap'],round(v['con_monto']/v['carpetas'],3),round(v['en_mwt']/v['carpetas'],3)])

# La lista depurada de Por cobrar siempre se aplica después de regenerar (08/11/2026)
import runpy
_AQUI=str(pathlib.Path(__file__).resolve().parent)
runpy.run_path(_AQUI+'/por_cobrar_curado.py')
runpy.run_path(_AQUI+'/flujo.py')
runpy.run_path(_AQUI+'/clientes_ficha.py')
runpy.run_path(_AQUI+'/fichas.py', run_name='__main__')
