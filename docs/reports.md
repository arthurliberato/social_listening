# Reports: adding sections from other screens

A report is an ordered list of sections, each one a dashboard-style widget. Besides building them in the report editor, people with an edit role can send a widget to a report from where they are found:

- **Dashboards:** every widget's menu has "Add to report…" (not on public share links, and not for viewers or client viewers).
- **Topics & Trends** adds the Topics section; **Authors** adds Top authors. Both carry the page's query filter when one is chosen.

The dialog lists the workspace's reports (most recently edited first, with section counts) plus "A new report". A report that already has 20 sections is shown as full and can't be picked. After adding, "Open report" goes straight to it.

**Server-side rules** (`addSectionToReport`, same as the editor): edit role required; the widget type must be in the plan (`widgetAllowed`), so a locked section can't be added by posting to the action; the section must pass the report section schema; a query the widget points at must belong to the workspace. Appending is a single SQL statement (`appendSection`), so two people adding at once keep both sections and the 20-section limit cannot be overshot; this is covered by DB tests with parallel appends and a cross-workspace attempt.

**Events and audit:** `Report Section Added` (`widget_type`, `source` = dashboard | topics | authors, `is_new_report`) and, when a new report is started, `Report Created` with `template_id: blank`. The audit log records `report.created` and `report.section_added`.

Not covered: adding Mentions feed results or a single mention to a report (reports hold widgets, not individual mentions), and adding from the Home overview tiles.
