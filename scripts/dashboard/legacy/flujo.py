import json,csv,re,datetime as dt,sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from _paths import ENTRADAS
HOY=dt.date(2026,11,8)
B=json.load(open(ENTRADAS/'base_mwt.json'));BM={}
for x in B['expedientes']: BM.setdefault(re.sub(r'^PF ','',x['proforma_codigo']),x)
EC={r['proforma']:r for r in csv.DictReader(open('ds_en_curso.csv'))}
PC={r['proforma']:r for r in csv.DictReader(open('ds_por_cobrar.csv'))}
MED={('aéreo','prod'):44,('aéreo','prep'):10.5,('aéreo','tran'):1.5,('marítimo','prod'):83,('marítimo','prep'):10,('marítimo','tran'):24.5,('sin dato','prod'):74,('sin dato','prep'):17,('sin dato','tran'):28}
TASA={'Sonepar':0.07,'Eguisa / SIASA':0.0606}
def d(s): return dt.date.fromisoformat(s[:10]) if s else None
def liq(due):  # pago del cliente en el mes M -> liquidación de Bianca a inicios de M+1 -> depósito Payoneer a mediados de M+1
    y,m=(due.year,due.month+1) if due.month<12 else (due.year+1,1)
    return dt.date(y,m,15)
rows=[]
def add(pf,cli,concepto,fecha,usd,base,supuesto,certeza):
    rows.append(dict(proforma=pf,cliente=cli,concepto=concepto,fecha=fecha.isoformat() if fecha else '',mes=fecha.strftime('%Y-%m') if fecha else 'sin fecha',usd=round(usd,2),base=base,supuesto=supuesto,certeza=certeza))
# 1. Liquidada en FE-2611, falta depósito
fe=sum(float(PC[p]['monto']) for p in PC if PC[p]['situacion'].startswith('Liquidada'))-831.29
add('FE-2611','Marluvas (liquidación de octubre)','Comisión',dt.date(2026,11,15),fe*0.99,f'FE-2611: comisiones {fe+831.29:,.2f} menos devolución de premio 831,29; menos 1 % de Payoneer','Liquidada el 06/11; depósito a mediados de mes como en meses anteriores','alta')
# 2. Comisión de pedidos embarcados o por embarcar
for pf,e in EC.items():
    if e['negocio']!='comision' or pf in('2336-2025','2372-2025','2415-2026'): continue
    if PC.get(pf,{}).get('situacion','').startswith('Liquidada'): continue
    x=BM.get(pf); f=(x or {}).get('finanzas') or {}
    cli=e['cliente']; tasa=TASA.get(cli,f.get('commission_rate') or 0.1); cred=int(f.get('credit_days_cliente') or 90)
    valor=float(e['usd']); modo=e['modo'] if e['modo'] in('aéreo','marítimo') else 'sin dato'
    ship=d((x or {}).get('shipment_date') or '')
    est=''
    if not ship:
        desde=d(e['desde']); dias=float(e['dias_en_etapa'] or 0)
        if e['etapa']=='en producción': ship=desde+dt.timedelta(days=max(MED[(modo,'prod')]-dias,7)+MED[(modo,'prep')])
        else: ship=desde+dt.timedelta(days=max(MED[(modo,'prep')]-dias,7))
        ship=max(ship,HOY+dt.timedelta(days=7)); est=f'salida estimada {ship:%d/%m/%Y} con la mediana de {e["etapa"].replace("en ","")}; '
    due=ship+dt.timedelta(days=cred); dep=liq(due)
    certeza='media' if e['etapa'] in('en destino','en tránsito') else 'baja'
    if pf=='2484-2026': certeza='baja'
    sup=f'{est}salida {ship:%d/%m/%Y} + {cred} días de crédito = pago del cliente {due:%d/%m/%Y}; liquidación a inicios del mes siguiente'
    if pf=='2484-2026': sup+='; reclamo por faltante: el pago puede quedar retenido'
    add(pf,cli,'Comisión',dep,valor*tasa*0.99,f'{tasa:.2%} de US$ {valor:,.2f}, menos 1 % de Payoneer'.replace(',','X').replace('.',',').replace('X','.'),sup,certeza)
# 3. Reventa
add('2473-2026','Sondel','Reventa',dt.date(2026,12,21),float(PC['2473-2026']['monto']),'FE 137','FE a 60 días','alta')
add('2488-2026','Sondel','Reventa',dt.date(2027,1,5),float(PC['2488-2026']['monto']),'FE 139','FE a 60 días, vence 05/01/2027','alta')
e=EC['2515-2026'];desde=d(e['desde'])
ship=max(desde+dt.timedelta(days=77.5-float(e['dias_en_etapa'])+14.5),HOY+dt.timedelta(days=7))
costo=3543.90*1.037
add('2515-2026','Sondel','Pago a Marluvas',ship+dt.timedelta(days=15),-costo,'Costo Marluvas 3.543,90 + 3,7 % de flete y seguro (proporción de 2473 y 2488)',f'Muito Work compra a 15 días de la factura de Marluvas (credit_days_mwt de mwt.one; así se pagaron 2473 y 2488); salida estimada {ship:%d/%m/%Y}','media')
add('2515-2026','Sondel','Reventa',ship+dt.timedelta(days=88),4690*1.39,'Estimado: precio a Sondel 4.690 × 1,39 (relación FE/precio de 2473 y 2488)','FE unos 28 días después de la salida, a 60 días','baja')
# Cuentas por cobrar a Sondel en Factura Profesional al 31-10 (ENT_CXC_CXP_2026_10)
FX=454.257852
for fe,venc,usd,nota,cert in [('FE 132',dt.date(2026,11,15),190.80,'Vencida el 19/10; mismo monto que la FE 138','media'),
                              ('FE 134',dt.date(2026,11,15),7355.05,'Lote 2480/2491; vencía el 02/11. Confirmar si ya entró en Promerica','media'),
                              ('FE 135',dt.date(2026,12,1),2260931.12/FX,'CRC 2.260.931,12 al tipo de cambio de mwt.one (454,26)','alta'),
                              ('FE 136',dt.date(2026,12,1),836.20,'Vence 01/12','alta'),
                              ('FE 138',dt.date(2026,12,22),190.80,'Vence 22/12. Mismo monto que la FE 132: confirmar que no es duplicado','baja')]:
    add(fe,'Sondel','Reventa',venc,usd,'Cuentas por cobrar de Factura Profesional al 31/10/2026',nota,cert)
# 4. Sin fecha
for pf in('2457-2026','2458-2026','2336-2025','2190-2024','2255-2024','2260-2024'):
    r=PC[pf];add(pf,r['cliente'],'Comisión por reclamar',None,float(r['monto'])*0.99,r['base'],r['accion'] or 'Pedir a Bianca que entre en la próxima liquidación','baja')
for pf in('2372-2025','2380-2025'):
    r=PC[pf];add(pf,r['cliente'],'Comisión en la aseguradora',None,float(r['monto'])*0.99,r['base'],'Depende del siniestro de Comtek','baja')
for pf in('2278-2025','2256-2024'):
    r=PC[pf];add(pf,r['cliente'],'Reventa vieja sin cobro',None,float(r['monto']),r['base'],'Facturada hace más de un año sin cobro visible','baja')
rows.sort(key=lambda r:(r['fecha'] or '9999',r['proforma']))
with open('ds_flujo.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,list(rows[0]));w.writeheader();w.writerows(rows)
import collections
t=collections.defaultdict(float)
for r in rows: t[(r['mes'],r['concepto'])]+=r['usd']
for k in sorted(t): print(k,round(t[k],2))
