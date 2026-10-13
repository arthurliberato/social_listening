#!/usr/bin/env bash
# Loads the corpus and creates the simulated accounts on the lab VM.
# Usage: bash ops/vm/seed.sh [small|medium|large]      (default: medium)
#   small   about 390k mentions, 10k creators      (a few minutes; fits anywhere)
#   medium  about 960k mentions, 20k creators      (the size CI uses; about 10 minutes)
#   large   the full corpus, millions of mentions  (untested here; allow an hour or more and about 4 GB of disk)
# Options through the environment: MIX (tier mix), RUN (label, default lab1), ENV_FILE.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a
. "${ENV_FILE:-/etc/ripplewise.env}"
set +a

SIZE="${1:-medium}"
case "$SIZE" in
  small)  GEN="--authors 8000 --scale 0.04 --brands 40"; CREATORS=10000 ;;
  medium) GEN="--authors 60000 --scale 0.25 --brands 40"; CREATORS=20000 ;;
  large)  GEN="--authors 200000 --scale 1.4"; CREATORS=50000 ;;
  *) echo "Usage: bash ops/vm/seed.sh [small|medium|large]" >&2; exit 1 ;;
esac
MIX="${MIX:-starter-limit:50,growth:25,agency-low:15}"
RUN="${RUN:-lab1}"

echo "==> Generating the $SIZE corpus"
npx tsx datagen/seed.ts --out data/corpus $GEN
echo "==> Loading it"
npm run db:migrate
npx tsx db/load.ts
npx tsx db/load-creators.ts --count "$CREATORS"
echo "==> Creating accounts ($MIX)"
npm run seed:agents -- --mix "$MIX" --run "$RUN" --out "agents-$RUN.json"
echo "Done. Logins and profiles are in agents-$RUN.json (keep it private)."
