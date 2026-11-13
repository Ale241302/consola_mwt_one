"""Tests puros de `apps.expedientes.codigo_expediente` (POL_CODIGO_OC v1.4).

No tocan la base: solo las funciones de armado y parseo. El consumo del
correlativo y la lectura del cliente se prueban en el flujo del wizard.
"""
import pytest

from apps.expedientes import codigo_expediente as c

pytestmark = [pytest.mark.expedientes, pytest.mark.no_db]


class TestFormatoOc:
    def test_consecutivo_estandar(self):
        assert c.formatear_oc("MAR", "UMMIE", "GT", 4, 2025) == "MAR-UMMIE-GT-04-25"

    def test_nombre_largo_no_rebasa(self):
        assert c.formatear_oc("MAR", "IMPORTACIONES", "HN", 3, 2026) == "MAR-IMPORTACIONES-HN-03-26"

    def test_anio_se_toma_de_dos_digitos(self):
        assert c.formatear_oc("MAR", "SONDEL", "CR", 1, "2026").endswith("-26")

    def test_anio_admite_date(self):
        from datetime import date

        assert c.formatear_oc("MAR", "SONDEL", "CR", 1, date(2026, 11, 9)).endswith("-26")
        assert c.siguiente_nn(["MAR-UMMIE-GT-01-25"], "MAR", "GT", date(2025, 7, 1)) == 2

    @pytest.mark.parametrize("codigo", [
        "MAR-UMMIE-GT-04-25",
        "PO MAR-UMMIE-GT-04-25",
        "po mar-ummie-gt-04-25",
    ])
    def test_parsear_acepta_con_y_sin_po(self, codigo):
        partes = c.parsear_oc(codigo)
        assert partes["cliente"] == "UMMIE"
        assert partes["pais"] == "GT"
        assert partes["nn"] == 4
        assert partes["anio"] == 2025

    @pytest.mark.parametrize("codigo", ["505289", "PO 504983", "", None])
    def test_parsear_rechaza_lo_que_no_es_consecutivo(self, codigo):
        assert c.parsear_oc(codigo) is None

    def test_siguiente_nn_no_reutiliza(self):
        codigos = ["MAR-UMMIE-GT-01-25", "PO MAR-UMMIE-GT-03-25", "BAZ"]
        assert c.siguiente_nn(codigos, "MAR", "GT", 2025) == 4

    def test_siguiente_nn_ignora_otro_anio(self):
        codigos = ["MAR-UMMIE-GT-09-24", "MAR-UMMIE-GT-02-25"]
        assert c.siguiente_nn(codigos, "MAR", "GT", 2025) == 3


class TestMarca:
    def test_parsea_codigo_completo(self):
        partes = c.parsear_codigo_marca("MAR-UMMIE-GT-04-25")
        assert partes == {
            "prv": "MAR", "cliente": "UMMIE", "pais": "GT",
            "nn": 4, "anio": 2025, "codigo": "MAR-UMMIE-GT-04-25",
        }

    def test_acepta_consecutivo_de_seis_digitos(self):
        partes = c.parsear_codigo_marca("MAR-SONDEL-CR-505515-26")
        assert partes["nn"] == 505515
        assert partes["anio"] == 2026

    def test_acepta_lugar_iata_de_tres_letras(self):
        partes = c.parsear_codigo_marca("MAR-SONDEL-SJO-505516-26")
        assert partes["pais"] == "SJO"
        assert partes["nn"] == 505516

    def test_acepta_prefijo_po(self):
        assert c.parsear_codigo_marca("PO MAR-UMMIE-GT-04-25")["nn"] == 4

    @pytest.mark.parametrize("codigo", ["MAR-UMMIE-GT-04", "505515", "", None])
    def test_rechaza_lo_que_no_cumple(self, codigo):
        assert c.parsear_codigo_marca(codigo) is None


# ─────────────────────────────────────────────────────────────────────
# G26 · el lugar del código depende del tipo de transporte
# ─────────────────────────────────────────────────────────────────────
class TestLugarPorTransporte:
    SONDEL = {"pais_iso2": "CR", "airport_iata": "SJO"}

    @pytest.mark.parametrize("fm,tm", [
        ("AIR", None), (None, "AEREO"), (None, "aéreo"), ("air", "AEREO"),
    ])
    def test_es_aereo(self, fm, tm):
        assert c.es_aereo(fm, tm) is True

    @pytest.mark.parametrize("fm,tm", [
        ("SEA", None), (None, "MARITIMO"), (None, "TERRESTRE"), (None, None),
        ("", ""),
    ])
    def test_no_es_aereo(self, fm, tm):
        assert c.es_aereo(fm, tm) is False

    def test_maritimo_usa_pais(self):
        assert c.lugar_de(self.SONDEL, freight_mode="SEA") == "CR"
        assert c.lugar_de(self.SONDEL, transport_mode="MARITIMO") == "CR"

    def test_aereo_usa_iata_del_cliente(self):
        assert c.lugar_de(self.SONDEL, freight_mode="AIR") == "SJO"
        assert c.lugar_de(self.SONDEL, transport_mode="AEREO") == "SJO"

    def test_aereo_sin_iata_cae_al_pais(self):
        cliente = {"pais_iso2": "CR", "airport_iata": None}
        assert c.lugar_de(cliente, freight_mode="AIR") == "CR"

    def test_iata_del_payload_manda(self):
        assert c.lugar_de(self.SONDEL, freight_mode="AIR", iata="sjo") == "SJO"
        assert c.lugar_de(self.SONDEL, freight_mode="AIR", iata="PTY") == "PTY"

    def test_formatea_con_iata(self):
        assert c.formatear_oc("MAR", "SONDEL", "SJO", 505516, 2026) == \
            "MAR-SONDEL-SJO-505516-26"
        assert c.formatear_oc("MAR", "SONDEL", "CR", 505516, 2026) == \
            "MAR-SONDEL-CR-505516-26"


class TestNombreCorto:
    @pytest.mark.parametrize("razon,esperado", [
        ("COMERCIALIZADORA UMMIE, S.A.", "UMMIE"),
        ("DISTRIBUIDORA COMTEK S.A.S.", "COMTEK"),
        ("EQUIPOS Y GUANTES INDUSTRIALES S.A.", "EGUISA"),
        ("GRUPO SOLUCIONES DE INGENIERIA Y AUTOMATIZACION S.A.", "SIASA"),
        ("IMPORTACIONES Y COMPRAS S DE RL", "IMPORTACIONES"),
        ("SonDel Honduras S.A. de C.V.", "SONDEL"),
        ("SONEPAR COLOMBIA S.A.S.", "SONEPAR"),
        ("PRO CUSTOMER CORP.", "PROCUSTOMER"),
        ("Muito Work Limitada", "MUITO"),
        ("IMPORCOMP S.A.", "IMPORCOMP"),
    ])
    def test_tabla_de_la_politica(self, razon, esperado):
        assert c.cliente_corto(razon_social=razon) == esperado

    def test_fallback_primera_palabra_util(self):
        assert c.cliente_corto(razon_social="ACME DEL SUR S.A.") == "ACME"


class TestCodigoExpediente:
    def test_sin_oc_usa_el_consecutivo_tal_cual(self):
        codigo = c.armar_codigo_expediente(
            prv="MAR", cliente="UMMIE", pais="GT",
            po_number="MAR-UMMIE-GT-04-25", origen="consecutivo",
        )
        assert codigo == "EXP-MAR-UMMIE-GT-04-25"

    def test_oc_del_cliente_lleva_contexto(self):
        codigo = c.armar_codigo_expediente(
            prv="MAR", cliente="SONEPAR", pais="CO",
            po_number="110020844", origen="cliente",
        )
        assert codigo == "EXP-MAR-SONEPAR-CO-110020844"

    def test_quita_prefijo_po_del_numero(self):
        codigo = c.armar_codigo_expediente(
            prv="MAR", cliente="SONDEL", pais="CR",
            po_number="PO 505515", origen="cliente",
        )
        assert codigo == "EXP-MAR-SONDEL-CR-505515"

    def test_con_proforma_usa_el_destino(self):
        codigo = c.armar_codigo_expediente(
            prv="MAR", cliente="SONEPAR", pais="CO",
            po_number="110020844", origen="cliente",
            proforma="2371-2025", destino="BOG",
        )
        assert codigo == "EXP-MAR-SONEPAR-BOG-2371-2025"

    def test_nunca_pasa_de_32(self):
        codigo = c.armar_codigo_expediente(
            prv="MAR", cliente="IMPORTACIONES", pais="HN",
            po_number="1234567890", origen="cliente",
        )
        assert len(codigo) <= c.LARGO_MAX_CODIGO
        assert codigo == "EXP-IMPORTACIONES-HN-1234567890"

    def test_codigo_armado_del_mcp_no_se_prefija(self):
        # El harness crea con po_number = {PRV}-{CLIENTE}-{DES}-{proforma}.
        codigo = c.armar_codigo_expediente(
            prv="MAR", cliente="IMPORCOMP", pais="GT",
            po_number="MAR-IMPORCOMP-GUA-2296-2025", origen="cliente",
        )
        assert codigo == "EXP-MAR-IMPORCOMP-GUA-2296-2025"

    def test_proforma_sola_no_se_prefija(self):
        codigo = c.armar_codigo_expediente(
            prv="MAR", cliente="IMPORCOMP", pais="GT",
            po_number="2514-2026", origen="cliente",
        )
        assert codigo == "EXP-2514-2026"
