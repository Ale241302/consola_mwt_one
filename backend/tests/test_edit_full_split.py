"""
Ola 5 · 2026-11-03 · Regresión del punto 7a del informe de Álvaro:
un cambio SOLO de cantidad no debe partir el expediente.

Pruebas puras (sin BD) sobre `apps.expedientes.views.decide_split`.
"""
from apps.expedientes.views import decide_split

A = {"a", "b", "c"}


def test_sin_split_ids_no_parte():
    is_split, d = decide_split(
        split_ids=[], active_line_ids=A, client_changed=False,
        split_quantities={}, new_qty_by_id={"a": 8},
        split_intent=False, has_lines_updated=True,
    )
    assert is_split is False
    assert d["subset_split"] is False


def test_cantidad_sin_marcar_linea_no_parte():
    """FE nuevo/antiguo sin checkbox: no viaja split_line_ids."""
    is_split, _ = decide_split(
        split_ids=[], active_line_ids=A, client_changed=False,
        split_quantities={}, new_qty_by_id={"a": 8},
        split_intent=False, has_lines_updated=True,
    )
    assert is_split is False


def test_una_linea_marcada_y_solo_cantidad_no_parte():
    """El caso del incidente: marcar 1 de 3 líneas y bajar 10→8.

    Antes: subset_split=True → expediente NUEVO.
    Ahora: hay lines_updated y el usuario no pidió separar → in-place.
    """
    is_split, d = decide_split(
        split_ids=["a"], active_line_ids=A, client_changed=False,
        split_quantities={"a": 8}, new_qty_by_id={"a": 8},
        split_intent=False, has_lines_updated=True,
    )
    assert is_split is False, d
    assert d["subset_split"] is True
    assert d["partial_qty_split"] is False


def test_bajar_cantidad_con_checkbox_marcado_no_es_split_parcial():
    """Regresión del desajuste de bases: 8 vs 8 (nueva), no 8 vs 10 (BD)."""
    is_split, d = decide_split(
        split_ids=["a", "b", "c"], active_line_ids=A, client_changed=False,
        split_quantities={"a": 8, "b": 1, "c": 1},
        new_qty_by_id={"a": 8, "b": 1, "c": 1},
        split_intent=False, has_lines_updated=True,
    )
    assert is_split is False
    assert d["partial_qty_split"] is False


def test_separar_menos_cantidad_si_parte():
    """Pedir separar 3 de 8 sigue funcionando (con intención explícita)."""
    is_split, d = decide_split(
        split_ids=["a"], active_line_ids=A, client_changed=False,
        split_quantities={"a": 3}, new_qty_by_id={"a": 8},
        split_intent=True, has_lines_updated=True,
    )
    assert is_split is True
    assert d["partial_qty_split"] is True


def test_mover_lineas_sin_tocar_cantidad_sigue_funcionando_fr_antiguo():
    """Compat: frontend viejo manda subset sin lines_updated → split."""
    is_split, d = decide_split(
        split_ids=["a"], active_line_ids=A, client_changed=False,
        split_quantities={"a": 10}, new_qty_by_id={},
        split_intent=False, has_lines_updated=False,
    )
    assert is_split is True
    assert d["subset_split"] is True


def test_cambio_de_cliente_siempre_parte():
    is_split, d = decide_split(
        split_ids=["a"], active_line_ids=A, client_changed=True,
        split_quantities={"a": 10}, new_qty_by_id={},
        split_intent=False, has_lines_updated=False,
    )
    assert is_split is True
    assert d["client_changed"] is True


def test_subconjunto_con_intencion_explicita_parte():
    is_split, _ = decide_split(
        split_ids=["a"], active_line_ids=A, client_changed=False,
        split_quantities={"a": 10}, new_qty_by_id={"a": 10},
        split_intent=True, has_lines_updated=True,
    )
    assert is_split is True
