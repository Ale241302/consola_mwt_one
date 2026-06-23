# Codex Fugu Codebase Audit Instructions

You are the Codex agent configured with the Sakana AI Fugu profile. Your goal is to audit the **Consola MWT.ONE** repository to find and document issues across three primary categories:

1. **System Communication Issues** (Frontend-Backend API sync)
2. **Security & Visibility Gaps** (Hardcoded keys, permissions, role isolation)
3. **React Render Loops & Performance Issues** (Infinite loops, freezing)

---

## 🧭 Project Architecture Overview
- **Frontend (`frontend/`)**: React 18 (Vite SPA) utilizing React Router DOM v6. Establishes context for auth and user roles. Calls API endpoints via adapter fetchers in `frontend/src/data/`.
- **Backend (`backend/`)**: Django 4 + DRF + JWT auth. 24 apps under `backend/apps/`. Database schema is SQL-first (no Django migrations; migrations are disabled in config settings).

---

## 🔎 Audit Category 1: System Communication
Verify that data-flow interfaces between the Frontend and Backend are synchronized.
- **Task**: Inspect all fetch adapters in `frontend/src/data/` (or general API calls in `frontend/src/`) and match them against Django routes in `backend/apps/*/views*.py` and `urls.py`.
- **Checklist**:
  - Do paths in the frontend fetch calls match the backend defined routes?
  - Do query parameter keys or POST payload keys match backend parameter bindings (e.g. `request.data.get('key')`, `request.query_params.get('key')`)?
  - Are expected response structures handled correctly by the frontend UI components without throwing undefined references?

---

## 🔎 Audit Category 2: Security & Visibility (RBAC & Secrets)
Verify compliance with `POL_VISIBILIDAD` rules and check for sensitive leaks.
- **Task A (Secrets)**: Scan the codebase for hardcoded passwords, tokens, or private credentials (especially in `backend/config/settings.py`, `.env.example`, front-end config, and `scripts/`).
- **Task B (Backend Auth)**: Inspect all backend DRF ViewSets, API views, and custom endpoints. Ensure they are protected using:
  - `@permission_classes([IsAuthenticated])` or custom permissions like `IsCeoOrAdmin`.
  - Check for default permission classes in `backend/config/settings.py`.
- **Task C (Frontend Role Isolation - `POL_VISIBILIDAD`)**: Ensure frontend components hide sensitive CEO/ADMIN data (cost prices, margins, governance tabs, transactional logs) from any user role starting with `CLIENT_*`.
  - Check that gating checks happen at the logic layer, and NOT simply hidden using CSS (e.g., `display: none`).

---

## 🔎 Audit Category 3: React Render Loops & Freeze Points
Identify potential React hooks patterns that trigger infinite loops or page freezing.
- **Task**: Scan the React files in `frontend/src/` (screens, components, hooks).
- **Checklist**:
  - **Unbounded Dependency Arrays**: Inspect `useEffect` calls. Check if a state variable updated inside the effect is also present in its dependency array without a guarding conditional check.
  - **Inline Objects/Arrays as Dependencies**: Check if inline objects, arrays, or anonymous functions created during render are passed as dependencies to `useEffect`, `useCallback`, or `useMemo` without proper memoization, leading to constant refetching/re-rendering.
  - **State updates during render**: Check if any function call inside the component body (outside `useEffect` or event handlers) calls a state setter (e.g. `setSomething(...)`).
  - **Stale Closures**: Check if asynchronous state updates inside `useEffect` reference stale variables.

---

## 📋 Reporting Format
When writing the audit findings, output the results to a file named `codex_audit_report.md` in the following format:

```markdown
# MWT Codebase Audit Report

## 1. System Communication Findings
| File (FE) | File (BE) | Issue Description | Suggested Fix |
|---|---|---|---|
| ... | ... | ... | ... |

## 2. Security & Visibility Findings
| File / Route | Severity | Issue Description | Suggested Fix |
|---|---|---|---|
| ... | ... | ... | ... |

## 3. React Render Loops & Freeze Points
| File | Component / Line | Hook Pattern | Suggested Fix |
|---|---|---|---|
| ... | ... | ... | ... |
```
