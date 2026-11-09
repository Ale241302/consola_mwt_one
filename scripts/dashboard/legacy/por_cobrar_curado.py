import csv
H=['proforma','negocio','cliente','situacion','monto','base','dias','evidencia','accion']
R=[
('2457-2026','comision','Pro Customer','Cliente pagó, falta la comisión',625.10,'10% de US$ 6.251,00','36','Pro Customer pagó US$ 7.157,75 (2457+2458) el 03/10; Bianca lo identificó el 05/10. Bianca no lo incluyó en la liquidación de octubre (03/11 y 06/11).','Pedir que entre en la liquidación de noviembre'),
('2458-2026','comision','Pro Customer','Cliente pagó, falta la comisión',90.68,'10% de US$ 906,75','36','Mismo pago del 03/10 que 2457.','Junto con 2457'),
('2336-2025','comision','Ummie','Cliente pagó, falta la comisión',57.52,'10% de US$ 575,20','','Al 28/01/2026 Ummie solo debía 2361, así que 2336 está pagada. No aparece en ninguna liquidación de Bianca (revisadas de feb 2025 a oct 2026).','Preguntar a Bianca'),
('2190-2024','comision','Comtek','Cliente pagó, comisión por confirmar',1426.93,'5% de US$ 28.538,50 (calzado de reposición)','744','Factura 2190 por US$ 47.528,10 pagada completa el 25/10/2024 (SWIFT «COMTEK 2190 2024»). Incluye la línea 2196 (14.163,60, ya liquidada: 708,18) y plantillas (4.826, devueltas en el acuerdo Sodexo). El calzado de reposición (28.538,50) no aparece en ninguna liquidación.','Preguntar a Bianca si la reposición paga comisión; si sí, cobrar US$ 1.426,93'),
('2255-2024','comision','Ummie','Sin dato de pago del cliente',520.64,'10% de US$ 5.206,40','','Bianca cobró a Ummie el 14/04/2025 (vencida 13/03/2025). No aparece en ninguna liquidación hasta oct 2026.','Preguntar a Bianca si Ummie pagó'),
('2260-2024','comision','Ummie','Sin dato de pago del cliente',504.60,'10% de US$ 5.046,00','','Bianca cobró a Ummie el 25/04/2025 (vencida 22/04/2025). No aparece en ninguna liquidación hasta oct 2026.','Preguntar a Bianca si Ummie pagó'),
('2372-2025','comision','Comtek','Cliente no pagó: en la aseguradora',812.81,'7% de US$ 11.611,60 (factura 2380)','','Facturada dentro de la factura 2380 del 10/02/2026 y embarcada el 26/02 (QT4052). Comtek no pagó; siniestro notificado a la aseguradora el 06-07/08/2026.','Preguntar a Bianca el estado del siniestro'),
('2193-2024','comision','Comtek','No corresponde comisión',0,'—','','Proforma de mayo 2024 sin pedido ni embarque: ningún correo la menciona desde junio 2024.',''),
('2350-2025','comision','Comtek','No corresponde comisión',0,'—','','Los 3.060 pares se devolvieron el 12/11/2025. La proforma 2380 incluía 970 de ellos, pero la factura 2380 no los trae: no se reembarcaron.',''),
('2380-2025','comision','Comtek','Cliente no pagó: en la aseguradora',142.09,'10% de US$ 1.420,92 (105 pares 70B22-E-BP + 6 pares de 2415; tasa de 2415 supuesta)','','Factura 2380 del 10/02/2026 por US$ 13.032,52 = 2372 + 105 pares de 2341 + 2415. Sin carpeta ni expediente propio. Siniestro notificado el 06-07/08/2026.','Crear carpeta y expediente; preguntar a Bianca'),
# liquidadas, falta depósito
('2468-2026','comision','Sondel','Liquidada, falta el depósito',3502.78,'10% de US$ 35.027,80 (2456+2468)','','Liquidación de octubre de Bianca; FE-2611 del 06/11/2026.','Esperar depósito Payoneer (mediados de nov)'),
('2466-2026','comision','Sondel Honduras','Liquidada, falta el depósito',414.80,'10% de US$ 4.148,00','','FE-2611 del 06/11/2026.',''),
('2465-2026','comision','Sonepar','Liquidada, falta el depósito',468.27,'10% de US$ 4.758,85 (con NC comercial de US$ 500)','','FE-2611 del 06/11/2026.',''),
('2478-2026','comision','Ummie','Liquidada, falta el depósito',239.72,'10% de US$ 2.397,15','','FE-2611 del 06/11/2026. mwt.one lo cerró solo, sin depósito.',''),
# esperando
('2484-2026','comision','Sonepar','Esperando pago del cliente',3439.80,'7% de US$ 49.140,05','53','Llegó el 16/09; crédito 90 días. Reclamo: Sonepar pide NC y reenvío de 100 pares faltantes (04/11); el pago puede quedar retenido.','Seguir la NC de Marluvas'),
('2479-2026','comision','Ummie','Esperando pago del cliente',409.40,'10% de US$ 4.094,00','66','Llegó el 03/09; crédito 90 días.',''),
('2513-2026','comision','Eguisa / SIASA','Esperando pago del cliente',23.57,'6,06% de US$ 389,00','33','Sin pago del cliente.',''),
('2472-2026','comision','Sondel','Esperando pago del cliente',8187.52,'10% de US$ 81.875,20','30','Llegó el 09/10.',''),
('2486-2026','comision','Sondel','Esperando pago del cliente',1430.70,'10% de US$ 14.307,00','30','Llegó el 09/10 con 2472.',''),
('2487-2026','comision','Sondel','Esperando pago del cliente',2865.83,'10% de US$ 28.658,30','11','Llegó el 28/10.',''),
# ya liquidadas (verificado en correos)
('2364-2025','comision','Sonepar','Ya liquidada',0,'US$ 1.949,46 al 7% (+ 2364-B US$ 9,82)','','Liquidación de marzo 2026 de Bianca (02/04/2026), depósito del 14/04/2026.',''),
('2361-2025','comision','Ummie','Ya liquidada',0,'US$ 997,04 al 10%','','Liquidación de marzo 2026.',''),
('2371-2025','comision','Sonepar','Ya liquidada',0,'US$ 451,04 al 7%','','Liquidación de marzo 2026.',''),
('2339-2025','comision','Ummie','Ya liquidada',0,'US$ 297,89 al 4,12%','','Liquidación de diciembre 2025: la línea «Ummie 2331» de la factura era 2339.',''),
('2225-2024','comision','Sondel','Ya liquidada',0,'US$ 74,13 por 2225+2228','','Factura de comisión del 05/11/2024 (depósito US$ 1.586,18 del 14/11/2024).',''),
('2228-2024','comision','Sondel','Ya liquidada',0,'incluida en los US$ 74,13','','Junto con 2225.',''),
('2248-2024','comision','Comtek','Ya liquidada',0,'US$ 401,92 al 1,55% por 2248+2249','','Liquidación de junio 2025 (pago de Comtek de US$ 25.930,00).',''),
('2196-2024','comision','Comtek','Ya liquidada',0,'US$ 708,18 al 5% de 14.163,60','','Facturada dentro de la factura comercial 2190 y pagada el 25/10/2024; comisión en la factura del 05/11/2024.',''),
# no corresponde
('2395-2025','reventa','Sondel','No corresponde comisión',0,'—','','Es reventa de Muito Work: FE a Sondel del 03/03/2026 cobrada el 29/04 y 07/05/2026.',''),
('2185-2024','comision','Comtek','No corresponde comisión',0,'—','','El cliente no pagó y Marluvas pidió nota de crédito (uid 6173).',''),
('2341-2025','comision','Comtek','No corresponde comisión',0,'—','','Líneas canceladas; los 105 pares pasaron a 2380-2025.',''),
('2348-2025','comision','Importaciones y Compras','No corresponde comisión',0,'—','','Cancelada; siguió como 2354-2025, ya liquidada.',''),
('2351-2025','comision','Importaciones y Compras','No corresponde comisión',0,'—','','Cancelada; siguió como 2355-2025, ya liquidada.',''),
('2165-2024','comision','Importaciones y Compras','No corresponde comisión',0,'—','','Cotización que no pasó a pedido.',''),
('2258-2024','comision','Importaciones y Compras','No corresponde comisión',0,'—','','Sin pedido confirmado.',''),
('2401-2025','comision','Sonepar','No corresponde comisión',0,'—','','Misma PO que 2405-2026, ya liquidada.',''),
('2467-2026','comision','Comtek','No corresponde comisión',0,'—','','4.485 pares, US$ 30.581,85. Cancelado el 16/09/2026 a pedido de Muito Work, tras el impago de la factura 2380; Marluvas descontó el premio (US$ 831,29) en la FE-2611.',''),
('2416-2026','comision','Ummie','No corresponde comisión',0,'—','','Proforma que no pasó a pedido: mismos SKU y precios que 2429-2026. Anulada en mwt.one el 08/11.',''),
# reventa
('2473-2026','reventa','Sondel','Facturada a Sondel, sin cobro',26697.26,'FE 137 del 22/10/2026','24','FE 137 a 60 días (vence cerca del 21/12). Muito Work ya pagó a Marluvas (13/10).',''),
('2488-2026','reventa','Sondel','Facturada a Sondel, sin cobro',22044.27,'FE 139 del 06/11/2026 (con IVA)','11','FE 139 a 60 días, vence 05/01/2027. Impuestos pagados; entrega en coordinación.',''),
('2362-2025','reventa','Sondel','Ya cobrada',0,'FE 112 del 26/11/2025 (US$ 6.502,64)','','Sondel pagó US$ 6.095,84 el 15/01/2026 (Promerica). Diferencia US$ 406,80 sin documento.','Confirmar la rebaja de US$ 406,80'),
('2278-2025','reventa','Importaciones y Compras','Facturada, sin cobro visible',5750.00,'proforma 2278-2025','','Reventa a Importaciones y Compras (Honduras), llegada 11/03/2025. Cobro sin identificar en ATV ni en el correo; En destino abierta en mwt.one.','Confirmar el cobro'),
('2256-2024','reventa','Pro Customer','Facturada, sin cobro visible',4993.40,'costo Marluvas','','Venta triangular: Muito Work pagó a Marluvas el 18/02/2025; Pro Customer no había pagado al 05/04/2025.','Confirmar con Pro Customer'),
]
w=csv.writer(open('ds_por_cobrar.csv','w',newline=''));w.writerow(H);[w.writerow(r) for r in R]
import collections
t=collections.defaultdict(float)
for r in R:t[(r[1],r[3])]+=r[4]
for k,v in t.items():print(k,round(v,2))
