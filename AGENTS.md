<claude-mem-context>
# Memory Context

# [consola_mwt_one] recent context, 2026-06-24 4:03pm GMT-5

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (21,421t read) | 1,152,242t work | 98% savings

### Jun 14, 2026
S171 Full codebase read-only analysis of consola_mwt_one + CLAUDE.md update to fix documented inaccuracies + stale file cleanup (Jun 14, 10:31 AM)
S173 Capa 2 – Backend latency optimization: cache KPI calculations and fix silent OC/expediente truncation; now exploring Fase 3 SQL indexes deployment mechanism (Jun 14, 10:36 AM)
388 10:46a 🔵 Expedientes.jsx Has Waterfall + N+1 Client Fetch Pattern Causing Load Delays
389 " 🟣 SWR Cache Layer Created for Frontend API Reads
390 " 🟣 Unified Skeleton Component Library Created for Loading States
391 " 🔵 usePortalData Hook Fires 7 Parallel API Calls With No Caching on Every Mount
392 10:48a 🟣 Global .mwt-skel CSS Class Added to app.css for Skeleton Component System
393 10:49a 🟣 usePortalData Hook Integrated with SWR Cache — Portal B2B Now Loads Instantly on Return Navigation
394 " 🟣 Skeleton Loading Added to All Frontend Views
395 " ⚖️ SWR Cache Architecture: Two-Layer In-Memory + SessionStorage
396 " 🔵 Pagos.jsx PaymentHistoryTable Sub-Component Cannot Access Parent `loading` State
397 " 🔵 Expedientes.jsx Has N+1 HTTP Request Anti-Pattern for Client Names
398 11:04a 🟣 Phase 2 Redis Caching Layer for Portal API Endpoints
399 " 🔴 Hard-coded LIMIT 100 Replaced with Configurable Pagination in mis_ocs and mis_expedientes
400 " ⚖️ 60-Second TTL Chosen for All Portal Cache Keys
S174 Full-stack portal performance optimization (Fase 1+2+3) complete and deployed: skeleton loading states, Redis caching, SQL indexes — all live at https://consola.mwt.one; project memory docs written for future sessions (Jun 14, 11:14 AM)
S172 Capa 2 – Backend latency optimization: cache KPI calculations and fix silent OC/expediente truncation in /api/portal/me/ and related endpoints (Jun 14, 11:14 AM)
S175 Fix React sub-component skeleton scope bugs (Portal.jsx / Pagos.jsx), deploy hotfix to production VPS at https://consola.mwt.one (Jun 14, 11:18 AM)
S176 Fix collapsed sidebar: swap wide CDN logo for compact icon + stack header vertically to prevent chevron overflow (Jun 14, 11:21 AM)
S178 Profile page (/perfil) improvements: editable fields for normal/B2B users, hide Mi empresa tab, add password reset, fix legal-entities 404 (Jun 14, 11:33 AM)
401 11:35a 🟣 Profile page improvements for normal/B2B users
S177 Fix collapsed sidebar logo + chevron overflow; then new /perfil page improvements for normal/B2B users (Jun 14, 11:36 AM)
S179 Profile page /perfil improvements: allow phone editing for normal/B2B users, hide Mi empresa tab, add password reset button, fix legal-entities 404 (Jun 14, 11:44 AM)
402 11:46a 🔵 Backend /me/profile/ already whitelists phone for self-service PATCH
403 " 🔵 Address field name mismatch between frontend and backend
404 11:47a 🔵 reset-password endpoint sends email to contact_email, uses PasswordResetToken model
405 " 🔵 ProfileMeView PATCH confirmed accessible to all authenticated users including CLIENT B2B
406 " 🔵 ProfileMeView PATCH omitting "addresses" key is safe — existing addresses untouched
407 " 🔵 ProfileMeSerializer marks full_name as read_only — backend ignores admin name edits via /me/profile/
408 " 🔴 Backend ProfileMeSerializer now allows self-service full_name editing
409 11:49a 🟣 ProfileMeView.patch now syncs full_name changes to core.users
410 " 🔄 reset_password logic extracted to _issue_password_reset() helper to enable self-service reuse
411 11:50a 🟣 Self-Service Password Reset for All Users via /perfil
412 " 🔴 Removed "Mi empresa" Tab and Legal-Entities 404 Errors on /perfil
413 " 🔴 CLIENT B2B Can Now Edit full_name and Phone from /perfil
414 " ✅ "Guardar cambios" Button Always Active on /perfil
415 " 🟣 Frontend Build Passes After All /perfil Changes
417 11:53a 🟣 Feature Deployed to Production VPS and Health-Verified
418 " 🔵 VPS Deployment Infrastructure: SSH on Port 2222, Docker Compose, Internal Port 8100
419 " 🔴 Idempotent Edits Replayed After Git Push — No Net Change
416 12:01p 🟣 All /perfil Improvements Committed and Pushed to GitHub
S180 Improve /perfil page for usuario normal / cliente B2B: editable fields (all except Rol principal), remove "Mi empresa" tab, add self-service password reset button, fix 404 on /api/legal-entities/ fetch, always-enabled "Guardar cambios" button (Jun 14, 12:03 PM)
420 2:55p 🟣 Dark Mode & Responsive Design Fix Requested for React Frontend
421 " 🔵 Frontend Source Structure: Single-Directory Numbered JSX Files
422 2:56p 🔵 Dark Mode Root Cause: Hardcoded Colors & Undefined --navy Token Used Across 50+ Files
423 " 🔵 Exact Files Using Undefined var(--navy) Token in JSX/JS
424 2:57p 🔵 Complete Inventory: 80 Files Contain Hardcoded Light-Theme Colors Incompatible With Dark Mode
425 " 🔵 OCDetail.jsx is Fully Dark-Mode Compliant; transferInvoiceHtml.js is Worst Offender with 27 --navy Uses
427 " 🔵 Complete Dark Mode Audit: Token Mapping Table and 3-Phase Fix Plan Established
428 " 🟣 Frontend Dark Mode & Responsive Design Fix Request
426 2:58p 🔵 Ranked Dark Mode Violation List: Top 20 Files by Hardcoded Color Count
429 3:02p 🔴 Dark Mode Token Migration — Replaced Hardcoded Border Hex Colors in app.css
430 3:18p 🟣 Dark Mode UI Fixes — Multi-Agent React Frontend Task Initiated
431 3:23p ⚖️ Dark Mode Multi-Agent Fix Initiated for React Frontend
432 3:25p ⚖️ Dark Mode UI Inconsistencies — Multi-Agent React Fix Strategy
### Jun 24, 2026
687 3:57p 🔵 MWT MCP Server Tool Inventory — Full Catalog Identified
688 " 🔵 MWT MCP Client — Zero-Dependency HTTP Layer Using Python stdlib
689 " 🔵 Sondel Costa Rica End-to-End Flow — 17-Step Platform Requirements Mapped
690 " 🔵 All Four Suspected MCP Gaps Resolved — Tools Confirmed Present in server.py
691 " 🟣 MCP Server Audit Report Generated — mcp_server_audit_report.md

Access 1152k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>