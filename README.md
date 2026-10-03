# social_listening
A social listening platform made up of synthetic autonomous agents users and mention's authors.

## Development
```
cp .env.example .env.local          # then set AUTH_SECRET
docker compose up -d postgres mailpit
npm install
npm run db:migrate                  # app + corpus tables
npm run datagen && npm run db:load  # ~1 min + ~2 min: 4.1M synthetic mentions (see docs/datagen.md)
npm run dev                         # http://localhost:3000  (signup -> verify via /inbox -> onboarding)
```
Checks: `npm run typecheck && npm run lint && npm test && npm run test:contrast && npm run test:e2e`
(set `PW_CHROMIUM_PATH` to use a pre-installed Chromium). See CLAUDE.md for the build brief and milestones.
