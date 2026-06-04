# Wine & Whiskey — Project Documentation

Living documentation for the Wine & Whiskey Store OS monorepo. Generated and verified against the codebase in June 2026.

## Start here

| Doc | What it answers |
|-----|-----------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the whole system fits together: monorepo layout, every service/agent/automation group, the Loyverse/Flow → store → surface data flow, deployment model, live-vs-built status. |
| [DATA_SOURCES.md](DATA_SOURCES.md) | The **source-of-truth reference**. Every key metric/entity mapped to its primary system (Loyverse / Flow Account), how it's ingested, where it's stored, and current divergences. Read this before trusting any number. |
| [DATA_MODEL.md](DATA_MODEL.md) | Supabase schema: tables/views catalog, migrations status, file stores (`08_config` / `09_data`), type-safety assessment, data-model issues. |
| [CROSS_CUTTING.md](CROSS_CUTTING.md) | Shared-logic & conventions guide. For each cross-cutting concern (B2B classification, sales aggregation, Loyverse client, SKU/customer matching, money/VAT/date formatting, billing cycle, price/Vivino) — its canonical home, where it lives today, and duplicates to eliminate. Plus the project conventions/rules. |
| [SERVICES.md](SERVICES.md) | Reference catalog of every service, agent, and automation script — path, purpose, deploy status, entry points, and the npm-script → file → upstream-source table. |
| [AUDIT_2026-06.md](AUDIT_2026-06.md) | **The June 2026 architecture audit** — executive summary, prioritized actions, findings by area, themes, and a phased scalability roadmap. The deliverable to read first. |
| [MIGRATION_shared_package.md](MIGRATION_shared_package.md) | Runbook for the `@ww/shared` keystone migration (branch `chore/shared-package`): what landed, remaining per-service steps, and the required Railway changes. |

## Governing principles (the lens the audit applies)

1. **Source of truth anchors to primary systems** — Loyverse (POS: sales, inventory) and Flow Account (accounting: expenses, tax). Every derived number must trace back to them.
2. **Cross-cutting rules have a single home** — no copy-paste of business logic across `03_automation` / `02_services/*` / `01_agents/*`.
3. **Architecture must scale** — favor shared abstractions, real keys, and one ingest with many readers.

## Audit headline

7 areas audited · ~48 findings (17 critical/high). The design intent is sound (Loyverse/Flow correctly anchored, the right abstractions exist) but the abstractions are **under-adopted** because there is no shared internal package — so cross-cutting rules are copy-pasted and have already drifted in production-facing code. See [AUDIT_2026-06.md](AUDIT_2026-06.md) for the prioritized fix list.
