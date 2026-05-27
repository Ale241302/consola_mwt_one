// ─────────────────────────────────────────────────────────────
// AddTransferItemsModal — Agregar productos a una transferencia
// existente. Sprint 2026-05-14 · Fase 15.
//
// CEO: "Debo poder agregar más expedientes y productos en cualquier
// momento. Al hacerlo, debe afectar el inventario del nodo de origen.
// El picker muestra solo lo que el nodo de origen tiene en inventario."
//
// Reutiliza Step3TransferAssign (mismo componente del wizard) para el
// picker. Aquí lo envolvemos en un modal con submit que:
//   1. Por cada item:
//        · Si (exp, prod, talla) YA existe en transfer.lineas → PATCH
//          incrementando qty_transfer.
//        · Sino → POST crea linea nueva.
//   2. Llama a nodoAssignmentsApi.transfer({transferenciaId, items})
//      para mover atómicamente la qty desde origen → destino.
//   3. Re-fetch del detalle (callback onSaved).
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { IconCheck, IconX } from "../../lib/icons.jsx";
import Step3TransferAssign from "./Step3TransferAssign.jsx";
import { transferLineasApi, nodoAssignmentsApi } from "../../lib/api.js";

export default function AddTransferItemsModal({
  open,
  lang = "es",
  /** transfer { _backend_id, _raw: { origen_id, destino_id }, lines, lineas } */
  transfer,
  onClose,
  onSaved,
}) {
  const [items, setItems]         = useState([]);
  const [valid, setValid]         = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);

  if (!open || !transfer) return null;

  const transferId = transfer._backend_id;
  const originNode = transfer._raw?.origen_id
    ? { id: transfer._raw.origen_id, codigo: transfer.origen, nombre: "" }
    : null;
  const destinationNode = transfer._raw?.destino_id
    ? { id: transfer._raw.destino_id, codigo: transfer.destino, nombre: "" }
    : null;

  // Mapeo de las lineas existentes en la transferencia · key (prod,talla)
  // → linea para poder PATCH-incrementar qty_transfer en vez de duplicar.
  // El backend Linea no tiene expediente_id; el match natural es por
  // producto_id + size. Si existe, sumamos; sino creamos.
  const existingByKey = (() => {
    const m = new Map();
    const arr = transfer.lines || transfer.lineas || [];
    for (const l of arr) {
      const k = `${l._raw?.producto_id || l.producto_id || ""}::${l.size || l._raw?.size || ""}`;
      m.set(k, {
        id:           l._line_id || l.id || l._raw?.id,
        qty_transfer: Number(l.qty_transfer || 0),
      });
    }
    return m;
  })();

  const handleSubmit = async () => {
    if (!items.length || !transferId) return;
    setSaving(true); setError(null);
    try {
      // 1) Lineas — PATCH o POST según corresponda.
      for (const it of items) {
        const key  = `${it.producto_id}::${it.talla || ""}`;
        const prev = existingByKey.get(key);
        if (prev?.id) {
          // PATCH: aumentar qty_transfer.
          const newQty = (prev.qty_transfer || 0) + (Number(it.qty) || 0);
          await transferLineasApi.update(prev.id, {
            qty_transfer: newQty,
          });
        } else {
          // POST: crear linea nueva en la transferencia.
          await transferLineasApi.create({
            transferencia_id: transferId,
            producto_id:      it.producto_id,
            sku:              it._sku || "",
            product_label:    it._nombre || it._sku || "",
            size:             it.talla || null,
            qty_transfer:     Number(it.qty) || 0,
            qty_reserve:      0,
          });
        }
      }
      // 2) Mover atómicamente desde origen → destino los nuevos items.
      await nodoAssignmentsApi.transfer({
        originNodoId:      originNode.id,
        destinationNodoId: destinationNode.id,
        transferenciaId:   transferId,
        items: items.map((it) => ({
          expediente_id: it.expediente_id,
          producto_id:   it.producto_id,
          talla:         it.talla || "",
          qty:           Number(it.qty) || 0,
        })),
      });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(
        (lang === "es" ? "Error al guardar: " : "Save error: ") +
        (e?.body?.detail || e?.message || (lang === "es" ? "desconocido" : "unknown"))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={saving ? undefined : onClose} style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "rgba(15,27,61,0.45)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "6vh 20px 20px",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface, #fff)", borderRadius: 14,
        width: "min(1100px, 100%)", maxHeight: "88vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 56px rgba(0,0,0,0.22)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 22px", borderBottom: "1px solid var(--border-subtle)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 0.6 }}>
              {lang === "es" ? "AGREGAR PRODUCTOS" : "ADD PRODUCTS"}
            </div>
            <h3 className="heading-md" style={{ marginTop: 2 }}>
              {lang === "es"
                ? "Más expedientes / productos a este movimiento"
                : "More expedientes / products in this transfer"}
            </h3>
          </div>
          <button className="btn btn-ghost btn-sm"
                  onClick={onClose} disabled={saving}>
            <IconX size={13}/>
          </button>
        </div>

        {/* Body · scrollable */}
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          {(!originNode || !destinationNode) ? (
            <div className="body-sm" style={{ color: "var(--critical)" }}>
              {lang === "es"
                ? "Falta nodo origen o destino en el movimiento. Refresca y reintenta."
                : "Missing origin or destination node on the transfer. Refresh and retry."}
            </div>
          ) : (
            <Step3TransferAssign
              lang={lang}
              originNode={originNode}
              destinationNode={destinationNode}
              onItemsChange={setItems}
              onValidityChange={setValid}
            />
          )}
        </div>

        {/* Footer */}
        {error && (
          <div style={{
            padding: "8px 22px", color: "var(--critical)",
            fontSize: 13, borderTop: "1px solid var(--border-subtle)",
          }}>{error}</div>
        )}
        <div style={{
          padding: "12px 22px", borderTop: "1px solid var(--border-subtle)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
        }}>
          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
            {items.length > 0
              ? (lang === "es"
                  ? `${items.length} línea(s) · ${items.reduce((a, x) => a + Number(x.qty || 0), 0).toLocaleString()} u a transferir`
                  : `${items.length} line(s) · ${items.reduce((a, x) => a + Number(x.qty || 0), 0).toLocaleString()} u to move`)
              : (lang === "es"
                  ? "Selecciona expedientes y productos del nodo origen."
                  : "Pick expedientes and products from origin node.")}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
              {lang === "es" ? "Cancelar" : "Cancel"}
            </button>
            <button className="btn btn-accent"
                    onClick={handleSubmit}
                    disabled={saving || !valid || !originNode || !destinationNode}>
              <IconCheck size={12}/>
              {saving
                ? (lang === "es" ? "Guardando…" : "Saving…")
                : (lang === "es" ? "Agregar y mover stock" : "Add and move stock")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
