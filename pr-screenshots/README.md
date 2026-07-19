# Single-page pagination — proof of functionality (#1721)

Captured against `test-servers/configs/pagination-http.json` (12 tools /
resources / prompts, `maxPageSize` 4 → 3 pages each), driven through the web app.

| # | Screenshot | What it shows |
| - | ---------- | ------------- |
| 01 | `01-tools-all-pages-default.png` | Default **all-pages** mode: the **Paginated** switch is off and the sidebar shows the full aggregated list (all 12 tools). |
| 02 | `02-tools-single-page-first.png` | **Paginated** on: only page 1 (4 tools). The row is *Paginated (left) … Load next page (right)* with *1 page loaded* on its own line below. |
| 03 | `03-tools-single-page-load-more.png` | After clicking **Load next page**: the next 4 tools are appended (8 total) and the status reads *2 pages loaded*. |
| 04 | `04-server-setting-checkbox.png` | Server Settings → **Fetch Lists One Page at a Time** is checked — the sidebar toggle persisted the server-wide setting. |
