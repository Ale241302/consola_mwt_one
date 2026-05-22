// =====================================================================
// MWT.ONE · hooks/useTransferPriceMode.js
// Sprint 2026-05-22 (AG-FRONTEND)
//
// Hook canónico para decidir si el viewer actual debe ver el precio
// INTERNO MWT (unit_price_mwt) o el precio CLIENTE (unit_price_client)
// en cualquier vista del flujo de transferencias entre nodos.
//
// Regla unificada (POL_VISIBILIDAD):
//   1. Si el usuario es ADMIN/CEO/Staff (rol interno real)         → MWT
//      ◦ y NO tiene override "Cliente B2B" activo en Tweaks.
//   2. Si el usuario es interno pero activó Tweaks "Cliente B2B"   → CLIENT
//      (previsualización fiel del cliente final).
//   3. Si el usuario es CLIENT_B2B real y `legal_entity_ids`
//      incluye al `operating_company_id` del expediente            → MWT
//      (es "cliente del operador" — patrón Muito Work Limitada).
//   4. Cualquier otro caso                                         → CLIENT
//
// El override del Tweaks SIEMPRE tiene prioridad sobre legal_entity_ids,
// porque el sentido del toggle es "ver lo que vería un cliente externo".
//
// Uso:
//   const { viewerIsMwt, pickPrice } = useTransferPriceMode();
//   const uv = pickPrice(line, { fallback: line.unit_value });
//
//   `line` debe traer al menos:
//     - operating_company_id (uuid del operador del expediente)
//     - unit_price_mwt       (number | null)
//     - unit_price_client    (number | null)
// =====================================================================
import { useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { isMwtOperated, MWT_OPERATING_CLIENT_ID } from "../lib/operatingCompany.js";

/**
 * @typedef {Object} PickPriceLine
 * @property {string|null|undefined} operating_company_id
 * @property {number|string|null|undefined} unit_price_mwt
 * @property {number|string|null|undefined} unit_price_client
 */

/**
 * @typedef {Object} TransferPriceMode
 * @property {boolean} viewerIsMwt — `true` si el viewer efectivo debe ver MWT.
 * @property {boolean} hasOverride — `true` si Tweaks fuerza un viewport.
 * @property {(line: PickPriceLine, opts?: { fallback?: number }) => number} pickPrice
 *   Resuelve el precio aplicable por línea (con fallback opcional al
 *   `unit_value` legacy si la línea es vieja y no trae snapshot dual).
 */

/**
 * @returns {TransferPriceMode}
 */
export function useTransferPriceMode() {
  const { user } = useAuth();
  const { isAdmin, override, baseViewport } = useRole();

  // legal_entity_ids del usuario real (NO del override). Esto permite
  // que un usuario CLIENT_B2B con la entidad legal "Muito Work Limitada"
  // asignada vea MWT — es el patrón "cliente operado por nosotros".
  const userHasMwtLegalEntity = useMemo(() => {
    const ids = Array.isArray(user?.legal_entity_ids) ? user.legal_entity_ids : [];
    if (!ids.length) return false;
    const target = String(MWT_OPERATING_CLIENT_ID).toLowerCase();
    return ids.some((id) => String(id || "").toLowerCase() === target);
  }, [user]);

  // ¿Tweaks está forzando un viewport? Si sí, gana sobre legal_entity_ids.
  const hasOverride = override === "ADMIN" || override === "CLIENT";

  // Regla unificada:
  //   - Si Tweaks override → respetar isAdmin tal cual (override mandó).
  //   - Si NO hay override → isAdmin O (cliente con legal_entity match).
  const viewerIsMwt = hasOverride
    ? !!isAdmin
    : !!(isAdmin || (baseViewport === "CLIENT" && userHasMwtLegalEntity));

  const pickPrice = useCallback(
    /**
     * @param {PickPriceLine} line
     * @param {{ fallback?: number }} [opts]
     */
    (line, opts = {}) => {
      const priceMwt = Number(line?.unit_price_mwt ?? 0);
      const priceCli = Number(line?.unit_price_client ?? 0);
      const opIsMwt  = isMwtOperated(line?.operating_company_id);

      // 1. Viewer interno + expediente operado por MWT → MWT.
      if (opIsMwt && viewerIsMwt) {
        if (priceMwt > 0) return priceMwt;
        if (priceCli > 0) return priceCli;
        return Number(opts.fallback || 0);
      }
      // 2. Cualquier otro caso prioriza CLIENT, con MWT como fallback.
      if (priceCli > 0) return priceCli;
      if (priceMwt > 0) return priceMwt;
      return Number(opts.fallback || 0);
    },
    [viewerIsMwt]
  );

  return { viewerIsMwt, hasOverride, pickPrice };
}

export default useTransferPriceMode;
