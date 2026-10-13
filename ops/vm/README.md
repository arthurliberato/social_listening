# Simulation lab on a Google Cloud VM

A VM keeps the simulation running without your computer, removes the 1 GB Neon limit (the database lives on the VM), and
lets agents run next to the app. The Vercel and Neon site stays as the small public demo.

```
        agents + orchestrator ──► app (port 3000, this VM only) ──► Postgres (this VM only)
                                           │
                                           └──► RudderStack ──► BigQuery  (your analysis)
```

Events are always kept in Postgres too, so nothing is lost if RudderStack is not set up yet.

## 1. Create the VM (Google Cloud console)

1. **Compute Engine**, then **VM instances**, then **Create instance**.
2. Name `ripplewise-lab`. Any region. Machine type **e2-standard-4** (4 vCPU, 16 GB) is a good start.
3. **Boot disk:** Ubuntu **24.04 LTS**, 50 GB (use 100 GB if you plan the `large` corpus).
4. **Firewall:** leave **Allow HTTP traffic** and **Allow HTTPS traffic** unticked. The app is meant to be reachable
   from the VM only, because the simulated clock is switched on.
5. **Create**, then click **SSH** next to the instance. A terminal opens in your browser; no keys needed.

**Cost.** A VM like this is roughly on the order of $100 a month if left on all the time (check Google's pricing
calculator for your region). A stopped VM costs only its disk, so **stop it when you are not using it**
(the three-dots menu, **Stop**). Your trial credit covers a few weeks of use.

## 2. Put the code on it and set it up

In the browser terminal:

```
git clone https://github.com/arthurliberato/social_listening.git
cd social_listening
git checkout claude/keen-keller-fxvnc0
bash ops/vm/bootstrap.sh
```

- If the repository is private, git asks for a username and password. Use your GitHub username and a **fine-grained token**
  as the password (GitHub, Settings, Developer settings, Personal access tokens: this repository only, **Contents:
  read-only**). Delete the token afterwards. Never paste it into a chat.
- The script installs Node 22 and PostgreSQL 16, creates the database and a private settings file
  (`/etc/ripplewise.env`), installs the browser, builds the app and starts it as a service. It takes about 10 minutes
  and can be run again safely.
- It ends with "The app is up on http://localhost:3000".

## 3. Load data and accounts

```
bash ops/vm/seed.sh small      # about 390k mentions: a few minutes
bash ops/vm/seed.sh medium     # about 960k mentions: about 10 minutes (the default)
```

`large` generates the full corpus (millions of mentions); it is untested here, so start with `small` or `medium`.
The accounts use the tier mix from `docs/account-tiers-and-demo-population.md` (change it with
`MIX=growth:40,agency-low:20 bash ops/vm/seed.sh medium`). Logins and profiles go to `agents-lab1.json`; keep it private.

## 4. Send events to RudderStack and BigQuery

Follow `docs/rudderstack-bigquery.md`. Nothing has been sent to a real RudderStack or BigQuery yet, so this is a first
live run. In short:

1. In RudderStack, create a server-side source and copy its **write key** and **data plane URL**.
2. In RudderStack, add a **BigQuery destination** (a dataset, a Cloud Storage bucket and a service account key with the
   roles the doc lists) and connect the source to it.
3. On the VM, put the two values into the settings file and restart the app:

   ```
   sudo nano /etc/ripplewise.env      # fill RUDDERSTACK_WRITE_KEY and RUDDERSTACK_DATA_PLANE_URL, save with Ctrl+O, Enter, Ctrl+X
   sudo systemctl restart ripplewise
   ```

4. Check the first events arrive (RudderStack's live events, then BigQuery after its sync schedule), and that
   `rudder_discards` stays empty.

Check RudderStack's plan for its monthly event allowance: a large simulation can send hundreds of thousands of events.

## 5. Everyday use

| Task | Command |
|---|---|
| Is the app running? | `systemctl status ripplewise` |
| See its log | `sudo journalctl -u ripplewise -f` (Ctrl+C to stop) |
| Restart it | `sudo systemctl restart ripplewise` |
| Look at the database | `sudo -u postgres psql ripplewise` |
| Update the code | `git pull && npm ci && npm run build && sudo systemctl restart ripplewise` |
| Run a batch of agents | `npm run agents:batch -- --manifest agents-lab1.json --profile growth,agency-low --count 20 --concurrency 3` |

To look at the app in your own browser without opening it to the internet, install the Google Cloud CLI on your computer
and run `gcloud compute ssh ripplewise-lab --zone <your zone> -- -L 3000:localhost:3000`, then open
`http://localhost:3000`.

Do not open port 3000 to the internet: the simulated clock is on, which lets any visitor change their own clock.

## 6. What comes next

The batch runner is the base. Next is the orchestrator: each simulated day, each account decides whether to log in and
what to do, with behavior by tier, and the events are dated by the simulated day. See `docs/simulation-plan.md`.
