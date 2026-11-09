import json,csv,re,statistics as st,collections,datetime as dt,sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from _paths import ENTRADAS

def ncli(n):
    n=n.lower()
    for k,v in [('honduras','Sondel Honduras'),('sondel','Sondel'),('imporcomp','Imporcomp'),('importaciones','Importaciones y Compras'),('ummie','Ummie'),('comtek','Comtek'),('pro customer','Pro Customer'),('equipos y guantes','Eguisa / SIASA'),('grupo soluciones','Eguisa / SIASA'),('sonepar','Sonepar')]:
        if k in n: return v
    return n
KP={'Sondel':(200000.0,145490.0,141322.0),'Sondel Honduras':(200000.0,145490.0,4168.0),'Imporcomp':(150000.0,60920.45,0.0),'Importaciones y Compras':(150000.0,60920.45,60920.45),
    'Ummie':(150000.0,5010.85,5010.85),'Comtek':(150000.0,144.12,144.12),'Sonepar':(150000.0,81248.7,81248.7),'Eguisa / SIASA':(150000.0,17917.55,17917.55),'Pro Customer':(150000.0,0.0,0.0)}
GRUPO={'Sondel':'Sondel (padre de Sondel Honduras)','Sondel Honduras':'Sondel (subsidiaria de Sondel S.A.)','Imporcomp':'Imporcomp (padre de Importaciones y Compras)','Importaciones y Compras':'Imporcomp (subsidiaria de Imporcomp S.A.)'}
TASA={'Sonepar':'7 % (liquidaciones de Bianca)','Eguisa / SIASA':'6,06 %','Comtek':'5,61 % a 10 % según pedido'}
B=json.load(open(ENTRADAS/'base_mwt.json'))
dias=collections.defaultdict(list);plazo=collections.defaultdict(list)
for x in B['expedientes']:
    if x['estado']!='CERRADO':continue
    ph=x['phase_durations'] or {}
    s=(ph.get('TRANSITO') or {}).get('start') or x.get('shipment_date');e=(ph.get('CERRADO') or {}).get('end')
    if not s or not e:continue
    dd=(dt.date.fromisoformat(e[:10])-dt.date.fromisoformat(s[:10])).days
    if dd<0 or dd>600:continue
    c=ncli(x['client_name']);dias[c].append(dd)
    cd=(x.get('finanzas') or {}).get('credit_days_cliente')
    if cd:plazo[c].append(int(cd))
CA=list(csv.DictReader(open('ds_clientes_anio.csv')))
PC=list(csv.DictReader(open('ds_por_cobrar.csv')))
FL=list(csv.DictReader(open('ds_flujo.csv')))
PE=list(csv.DictReader(open('ds_pedidos.csv')))
RES=('No corresponde','Ya liquidada','Ya cobrada','Liquidada')
out=[]
for c in sorted({r['cliente'] for r in CA if r['cliente']!='Sin desglose'}):
    anios=collections.defaultdict(lambda:dict(pedidos=0,usd=0.0,comision=0.0))
    pais=''
    for r in CA:
        if r['cliente']!=c:continue
        pais=r['pais'];a=anios[int(r['anio'])];a['pedidos']+=int(r['pedidos']);a['usd']+=float(r['usd_confirmado']);a['comision']+=float(r['comision_facturada'])
    com=sum(float(r['monto']) for r in PC if r['cliente']==c and r['negocio']=='comision' and not r['situacion'].startswith(RES))
    rev=sum(float(r['monto']) for r in PC if r['cliente']==c and r['negocio']=='reventa' and not r['situacion'].startswith(RES))
    rev+=sum(float(r['usd']) for r in FL if r['cliente']==c and r['proforma'].startswith('FE 1'))
    kp=KP.get(c)
    d=dias.get(c,[]);p=plazo.get(c,[])
    peds=sorted([r for r in PE if r['cliente']==c],key=lambda r:r['proforma'],reverse=True)
    out.append(dict(cliente=c,pais=pais,grupo=GRUPO.get(c,'Sin grupo'),tasa=TASA.get(c,'10 %'),
      credito_limite=kp[0] if kp else '',credito_usado_grupo=kp[1] if kp else '',credito_usado_propio=kp[2] if kp else '',
      plazo_dias=int(st.median(p)) if p else '',dias_pago_mediana=int(st.median(d)) if d else '',dias_pago_n=len(d),
      por_cobrar_comision=round(com,2),por_cobrar_reventa=round(rev,2),
      anios=[dict(anio=k,pedidos=v['pedidos'],usd=round(v['usd'],2),comision=round(v['comision'],2)) for k,v in sorted(anios.items())],
      pedidos=[dict(proforma=r['proforma'],anio=r['anio'],negocio=r['negocio'],estado=r['estado'],usd=r['usd']) for r in peds]))
json.dump(out,open('ds_clientes_ficha.json','w'),ensure_ascii=False)
for o in out:print(o['cliente'],o['grupo'][:20],o['dias_pago_mediana'],o['dias_pago_n'],o['plazo_dias'],o['por_cobrar_comision'],o['por_cobrar_reventa'],len(o['pedidos']))
