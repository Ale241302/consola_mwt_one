# MWT.ONE · Postman Collection

158 requests cubriendo los 15 módulos del ERP + auth + bonus (Users, Roles, AI Hub, Storage, Sizing).

```
postman/
├── MWT_ONE.postman_collection.json     # 21 folders · 158 requests
├── MWT_ONE.postman_environment.json    # variables + secrets placeholders
├── build_collection.py                 # script generador (re-correr si hay cambios en urls.py)
└── README.md                           # esto
```

---

## Quickstart (5 min)

1. **Importar en Postman**
   - Postman → `Import` → arrastrar los dos `.json` de esta carpeta.
   - En el selector de environment (esquina superior derecha) elige `MWT.ONE · producción`.

2. **Login automático**
   - Abre `0 · Auth ▸ Login (auto-guarda tokens)`.
   - Click `Send`.
   - El test script guarda `access_token`, `refresh_token`, `user_id`, `user_email`, `user_role` en el environment automáticamente.
   - Todos los demás requests heredan el `Bearer {{access_token}}` (auth definido a nivel de colección).

3. **Setear UUIDs reales** (automático ahora)
   - **14 endpoints `List` rellenan UUIDs solos**. Sólo lanza estos y el environment se llena en cascada:
     - `List clientes`     → `client_uuid`
     - `List marcas`       → `brand_uuid`
     - `List productos`    → `product_uuid`
     - `List proveedores`  → `supplier_uuid`
     - `List nodos`        → `node_uuid`
     - `List OCs`          → `oc_uuid`
     - `List expedientes`  → `expediente_uuid`
     - `List transferencias` → `transfer_uuid`
     - `List stock`        → `stock_uuid`
     - `List pagos`        → `pago_uuid`
     - `List cobros`       → `cobro_uuid`
     - `List email templates` → `template_uuid`
     - `List users`        → `user_uuid`
     - `List threads`      → `thread_uuid`
   - El test script toma `response[0].id` y lo guarda en el environment.
   - Después puedes lanzar todos los `Retrieve / Update / Delete` que dependen de esos UUIDs sin tocar nada.

4. **Run completo**
   - Click derecho en la colección → `Run collection` → marca todos los folders → `Run`.
   - Postman ejecuta los 158 requests en orden y muestra el resumen.

---

## Cómo conectar la colección a GitHub

Postman Free + Team soportan **Git integration**. La colección + environment se sincronizan a un repo como JSON, lo que permite:
- Versionar cambios.
- Trabajar en branches.
- Revisar diffs en PRs.
- Tener un único source of truth fuera del SaaS de Postman.

### Opción A · Repo dedicado (recomendado para equipos)

1. **Crear repo nuevo en GitHub** (puede ser privado):
   ```bash
   gh repo create mwt-postman --private --description "MWT.ONE Postman collections"
   ```

2. **Push de los JSON actuales**:
   ```bash
   cd postman
   git init
   git remote add origin git@github.com:Ale241302/mwt-postman.git
   git add *.json README.md build_collection.py
   git commit -m "init: MWT.ONE Postman collection v1"
   git branch -M main
   git push -u origin main
   ```

3. **Conectar desde Postman**:
   - Postman → workspace settings (icono ⚙️ arriba a la derecha del workspace).
   - Pestaña `Integrations` → buscar **GitHub** → `Add Integration`.
   - Autenticate con tu cuenta GitHub.
   - Selecciona el repo `mwt-postman`, branch `main`, ruta `/`.
   - Postman ofrece **dos modos**:
     - **Two-way sync** (recomendado): cambios en Postman se reflejan en GitHub y vice-versa.
     - **Backup only**: Postman empuja a GitHub, no lee de vuelta.

4. **Workflow diario**:
   - Editas la colección en Postman → click `Push` (icono Git) → commit + push a GitHub.
   - Otra persona clona el repo, importa los JSON o también conecta Postman → ve los mismos requests.

### Opción B · Mismo repo del proyecto (lo que ya tienes)

Los archivos quedan en `mwt-one/postman/` del repo `consola_mwt_one`. Cualquiera que clone el repo principal tiene la colección.

```bash
cd /c/Users/ale13/Downloads/Consola\ MWT.ONE/mwt-one
git add postman/
git commit -m "add: Postman collection con 158 requests · 15 módulos"
git push origin main
```

Ventaja: una sola fuente de verdad (código + tests). Desventaja: si alguien sin acceso al repo principal necesita la collection, hay que darles permisos.

### Opción C · Postman API + GitHub Actions

Si quieres CI que valide la collection en cada push:

```yaml
# .github/workflows/postman-validate.yml
name: Postman validate
on: [push]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install -g newman
      - run: |
          newman run postman/MWT_ONE.postman_collection.json \
            -e postman/MWT_ONE.postman_environment.json \
            --env-var "admin_password=${{ secrets.MWT_ADMIN_PASSWORD }}" \
            --reporters cli,json --reporter-json-export postman-results.json
      - uses: actions/upload-artifact@v4
        with:
          name: postman-results
          path: postman-results.json
```

Necesitas un secret en GitHub: `Settings → Secrets → Actions → MWT_ADMIN_PASSWORD`.

---

## Cómo regenerar la colección

Si agregas/cambias endpoints en `backend/apps/*/urls.py`, edita `postman/build_collection.py` y vuelve a correr:

```bash
cd "/c/Users/ale13/Downloads/Consola MWT.ONE/mwt-one"
python3 postman/build_collection.py
```

Esto re-escribe los dos JSON. Luego push.

---

## Estructura de carpetas en la colección

| # | Carpeta | Requests | Notas |
|---|---|---|---|
| 0 | Auth | 4 | login, refresh, me, logout |
| 1 | Dashboard | 7 | KPIs + funnel + timeseries + widgets |
| 2 | Expedientes | 13 | OCs + expedientes + líneas + OCR + create-from-oc |
| 3 | Pipeline | 3 | Transiciones + eventos |
| 4 | Portal B2B | 7 | Catálogo + expedientes + audit |
| 5 | Financiero | 7 | Pagos + conciliaciones + vencimientos + FX |
| 6 | Transferencias | 7 | Transfers + líneas + eventos + documentos |
| 7 | Nodos | 5 | CRUD |
| 8 | Clientes | 16 | CRUD + 8 selects + KPIs + crédito |
| 9 | Marcas (Motor de Precios) | 19 | CRUD + brand-client-pricing + resolve waterfall + COMEX + commercial sub-recursos |
| 10 | Productos | 6 | CRUD + filtros |
| 11 | Proveedores | 5 | CRUD |
| 12 | Inventario | 5 | Stock + movimientos |
| 13 | Plantillas Email | 6 | Templates + versiones + preview log |
| 14 | Historial Notificaciones | 4 | Logs + grace days + queue |
| 15 | Cobros | 5 | Cobros + withholding + collection events |
| Bonus | Users + Profile | 12 | CRUD users + addresses + activity feed |
| Bonus | Roles + Permissions | 9 | RBAC + matriz |
| Bonus | AI Hub | 7 | Agentes + skills + threads + chat |
| Bonus | Storage | 2 | Signed URLs |
| Bonus | Sizing | 4 | Tallas + opciones |

---

## Variables del environment

| Variable | Tipo | Descripción |
|---|---|---|
| `base_url` | default | `https://consola.mwt.one` |
| `admin_email` | default | `alejandro@muitowork.com` |
| `admin_password` | **secret** | `CHANGE-ME-ADMIN-PASSWORD` (nunca commitear cambios reales) |
| `access_token` | secret | (auto · lo setea Login) |
| `refresh_token` | secret | (auto · lo setea Login) |
| `user_id` `user_email` `user_role` | default | (auto · lo setea Login) |
| `client_uuid` `brand_uuid` `product_uuid` `supplier_uuid` `node_uuid` `oc_uuid` `expediente_uuid` `transfer_uuid` `pago_uuid` `cobro_uuid` `template_uuid` `user_uuid` `role_slug` `thread_uuid` `storage_uuid` `bcpa_uuid` | default | UUIDs reales que pegas tras un primer `List` |

⚠ **No commitear el environment con tokens reales**. Postman marca los `secret` como sensibles, pero el JSON los exporta en plano. Para CI: usar GitHub secrets como variables de override (ver Opción C arriba).

---

## Próximos pasos sugeridos

- Agregar tests automáticos (`pm.test`) en cada request — chequear status code, schema de respuesta, etc.
- Crear environments adicionales: `MWT.ONE · staging`, `MWT.ONE · local` (con `base_url=http://localhost:8100`).
- Setup de Newman + GitHub Actions para regression nightly contra el VPS.
- Documentar un "happy path" en una colección separada (Login → Crear cliente → Crear marca → Asignar precios → Crear OC → Confirmar SAP → Cobrar).
