<claude-mem-context>
# Memory Context

# [consola_mwt_one] recent context, 2026-06-24 5:06pm GMT-5

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (21,276t read) | 1,173,651t work | 98% savings

### Jun 14, 2026
S178 Profile page (/perfil) improvements: editable fields for normal/B2B users, hide Mi empresa tab, add password reset, fix legal-entities 404 (Jun 14, 11:33 AM)
S177 Fix collapsed sidebar logo + chevron overflow; then new /perfil page improvements for normal/B2B users (Jun 14, 11:36 AM)
S179 Profile page /perfil improvements: allow phone editing for normal/B2B users, hide Mi empresa tab, add password reset button, fix legal-entities 404 (Jun 14, 11:44 AM)
S180 Improve /perfil page for usuario normal / cliente B2B: editable fields (all except Rol principal), remove "Mi empresa" tab, add self-service password reset button, fix 404 on /api/legal-entities/ fetch, always-enabled "Guardar cambios" button (Jun 14, 11:44 AM)
S266 Fix tipo_cambio MCP tool and audit solucion_puntos_pendientes_costa_rica_sondel.md — dispatched to Codex agent (fugu profile) (Jun 14, 12:03 PM)
### Jun 24, 2026
697 4:21p 🔵 MCP Server Count Discrepancy: 98 vs 99 Tools (nuevo `tipo_cambio`)
698 " 🚨 Production JWT Token Hardcoded in Sondel Workflow Documentation
700 4:22p 🔴 `tipo_cambio` Defined Twice in server.py — Duplicate MCP Tool Registration Bug
701 " 🔵 Actual MCP Tool Count is 99 Unique / 100 Decorators (not 98 as Previously Reported)
702 4:23p 🔵 Backend Exchange Rate Endpoints: Multi-Source Fallback Chain with Redis Cache
703 4:24p 🔵 Automated Cross-Reference: Zero Missing Tools Between Sondel Workflow Appendix and MCP Server
704 " 🚨 Exposed Production JWT: Confirmed Admin Token Valid Until 2126, Issued 2026-06-19
705 " 🔵 MCP README.md Stale: Documents 88 Tools, Actual Count is 99 Unique
706 " 🔐 Two Write-Method Tools Bypass `_wguard()` Read-Only Protection in server.py
707 " 🔵 Key Tool Signatures Validated: `nodo_crear`, `expediente_editar`, `sap_analizar` Match Sondel Workflow Requirements
708 4:30p 🟣 MCP Tool tipo_cambio Added — Exchange Rate Now Served Internally
709 " 🚨 Production JWT with Admin Role Embedded in Markdown Prompt File
710 " ✅ Sondel Solution Doc Updated — tipo_cambio MCP Tool Added to Flow Map
713 4:31p 🔵 Repo consola_mwt_one — archivos clave confirmados; shell parcialmente bloqueado
711 " 🔵 Codex Agent Dispatched via fugu Profile to Fix tipo_cambio and Audit Sondel Prompt
712 " 🔵 Codex fugu Profile Blocks PowerShell Commands — Read-Only Sandbox Active
714 4:32p 🔵 BUG CONFIRMADO: tipo_cambio definida dos veces en server.py (líneas 266 y 1284)
S268 Awaiting second Codex deep audit (b5yhdz7nb) of solucion_puntos_pendientes_costa_rica_sondel.md — same state as previous checkpoint (Jun 24, 4:32 PM)
715 " 🔵 Análisis completo: 100 decoradores @mcp.tool() con 99 tools únicas — tipo_cambio duplicada confirmada
716 4:33p 🚨 🚨 JWT de producción hardcodeado en solucion_puntos_pendientes_costa_rica_sondel.md §0.2
717 " 🔵 Auditoría completa del prompt Sondel — §6 correcto, MAPA FLUJO completo, README desactualizado
718 4:34p 🔴 Duplicado tipo_cambio eliminado de server.py — una sola definición en línea 266
719 4:35p 🔵 Estado final verificado: server.py tiene exactamente 99 @mcp.tool() y una sola tipo_cambio
720 " 🔵 Estructura del repo consola_mwt_one — múltiples archivos de prompt y auditoría en raíz
721 " 🔵 Backend commercial: open.er-api.com es fallback INTERNO del servidor, no dependencia del MCP
722 4:36p 🔵 Fallback hardcodeado de usd-crc es 505.0 ₡/USD, no 459.50 como indica el prompt Sondel
723 4:37p ✅ Auditoría MCP Sondel completada — fase de reporte en progreso
724 4:50p 🔴 Duplicate tipo_cambio Decorator Removed from MCP server.py
725 " ✅ MCP README Tool Count Updated from 88 to 99
726 " ⚖️ Single-Editor Policy Adopted for server.py to Prevent Concurrent Mutation
729 " 🔵 Auditoría del prompt operativo SONDEL Costa Rica 2026 en consola_mwt_one
730 " 🚨 JWT de producción con rol admin embebido en prompt operativo SONDEL
731 " 🔵 Bug de duplicado de tool tipo_cambio en MCP server resuelto previamente
727 4:51p 🔵 Codex Read-Only Audit Completed — Sondel Prompt Has 5 Specific Fixable Issues
728 " 🔵 Second Codex Audit Dispatched for Deep Parameter-Signature Validation of Sondel Prompt
S267 Fix tipo_cambio duplicate in MCP server.py and audit solucion_puntos_pendientes_costa_rica_sondel.md via Codex fugu profile (Jun 24, 4:51 PM)
732 " 🔵 Lista completa de 99 tools @mcp.tool() extraída de server.py para cross-reference
733 " 🔵 Desajuste de parámetro crítico: sap_confirmar usa fecha_fabricacion, el .md dice fecha
734 " 🔵 Semántica de tipo_cambio confirmada: rate = unidades de moneda local por 1 USD
735 " 🔵 Firma de recepcion_crear confirma: items incluye nodo_id dentro de cada elemento, no como arg separado
736 " 🔵 proforma_generar audience: el .md dice CLIENT y ADMIN_ONLY, pero el servidor acepta MWT_INTERNAL también
S269 Monitoring Codex deep audit task b5yhdz7nb — still running, reading server.py sections for tool cross-reference (Jun 24, 4:51 PM)
S270 Monitoring Codex deep audit task b5yhdz7nb — process confirmed alive, reading server.py for tool signature cross-reference (Jun 24, 4:52 PM)
737 4:53p 🔵 transfer_costo_agregar firma completa confirmada: label es parámetro nombrado, no está en el .md
738 " 🔵 Backend USD/CRC: fallback hardcodeado es 505.0 ₡/USD, el .md asume ≈459.50
739 " 🔵 nodo_artefacto_crear en §7-art del .md omite nodo_id como primer argumento y tiene orden de parámetros incorrecto
740 " 🔵 documento_subir requiere expediente_id u oc_id; el .md §8 no lo menciona explícitamente
746 " 🔵 Codex Deep Audit Complete — 6 Critical and 12 Important Issues Found in Sondel Prompt
741 4:54p 🔵 Template IDs 23 y 24 del .md (Packing/Impuestos) no tienen referencias en el backend — solo 9 y 13 están hardcodeados
742 " 🔵 Backend tiene upload-cost-ocr para importar costos DUA con OCR — no documentado en prompt SONDEL
743 " 🔵 Estados del expediente y la transferencia confirmados contra el backend
744 4:55p 🔵 Motor de liquidación BY_VALUE usa unit_value (precio cliente) para ponderar, no unit_cost (precio MWT)
745 " 🔵 storage_subir_archivo: flujo de 4 pasos para artefactos confirma formato exacto del objeto file en data
S271 Codex deep audit of solucion_puntos_pendientes_costa_rica_sondel.md complete — full prioritized fix list delivered, awaiting user decision to apply corrections (Jun 24, 4:59 PM)
747 5:05p ⚖️ Full-Stack Audit of consola_mwt_one Commissioned — Output to auditoria_consola.md

Access 1174k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>