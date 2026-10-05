# Authors and Topics

Both pages aggregate the same visible, non-spam, override-aware mentions as the Mentions feed (`buildFeedWhere`), so numbers match when you drill down: an author's mention count links to `/mentions?author=…`, a topic links to `/mentions?topic=…`, both carrying the page's period and query. Views are plain GET forms, so every view is a shareable URL.

- **Authors** (`/w/[ws]/authors`): rank by reach, mentions or negative mentions; watchlist-only filter; a profile page per author (only mentions that match this workspace's queries, so it never reveals another workspace's data). Watching needs an edit role and is stored per workspace (`author_watchlist`).
- **Topics & Trends** (`/w/[ws]/topics`): mention counts, change versus the previous period of the same length (shown in words and arrows, not just colour), negative share and reach. "Rising" means up at least 50% with at least 20 mentions.
- Tables are the accessible form of the data; the small bars are decorative.
- Events: `Author Profile Viewed`, `Author Watchlisted`, `Topic Opened`.
