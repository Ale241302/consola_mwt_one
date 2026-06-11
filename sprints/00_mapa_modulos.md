# Mapa de Módulos — Sidebar ↔ Sprints de Auditoría

Los 12 sprints agrupan por **dominio** (apps Django / schemas de BD), no por ítem del menú: una entrada del sidebar puede vivir en un sprint junto a otras. Cobertura completa:

| Ítem del sidebar / ruta | Sprint de auditoría |
|---|---|
| Dashboard | `12_analytics` |
| Expedientes · Cronograma · Wizard nueva OC · Tallas | `03_expedientes` |
| Portal (B2B) | `02_clientes` + `03_expedientes` |
| Clientes | `02_clientes` |
| Marcas · Productos · Historial de precios · Proveedores | `08_brands` |
| Finanzas · Cartera (/cobros) · Pagos (/financiero) | `05_cobros` |
| Pipeline (Kanban de /expedientes) | `04_commercial` |
| Movimientos (/transferencias) · NCM | `09_transfers` |
| Nodos | `07_nodos` |
| Inventario · Recepción inbound | `06_inventario` |
| Notificaciones · Templates · tickets | `10_communications` |
| AI Hub · AI Governance | `11_ai_hub` |
| users · roles · perfil · login | `01_core` |

> No hay módulo del sidebar sin sprint asignado. Las 25 apps del backend
> (`backend/apps/`) también quedan repartidas: p.ej. `finance`+`finanzas`+`cobros`
> → sprint 05; `brands`+`productos`+`proveedores` → sprint 08; `notifications`+
> `email_templates`+`tickets` → sprint 10; `core`+`users`+`roles`+`storage` → sprint 01;
> `sizing`+`ocr` acompañan a expedientes/inventario donde se usan.
