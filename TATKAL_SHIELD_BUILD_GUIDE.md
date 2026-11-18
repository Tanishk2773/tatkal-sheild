# TATKAL SHIELD: Full Build Guide (paste this whole file into Astra)

> **Instruction to Astra (the AI coding assistant):**
> Build the project described below, phase by phase, in the exact order of Section 9 (Build Order).
> After each phase, stop, show what was built, give the command to run/test it, and wait for me to say "next".
> Keep the code simple, commented, and beginner-readable (I am learning JavaScript and DevOps).
> Do not skip the acceptance checks at the end of each phase.

---

## 1. Project Summary

**Name:** Tatkal Shield
**Tagline:** "We broke the booking rush on purpose, so it won't break you."

A **mock** train-ticket booking system that stays alive, fair, and correct while 10,000+ simulated users hit "Book" at the same second (the "10:00 AM Tatkal rush"). It is built to win a **DevOps event**: the jury can attack the system live and watch it heal itself.

> **Important:** This is a self-contained **mock** system with fake trains and fake payments. It does NOT connect to, scrape, or automate the real IRCTC. The real deliverable is a reusable **rush-proof architecture** that any flash-sale or ticket system could adopt. Tatkal is the relatable story.

---

## 2. Problem Statement

When ticket booking opens for a high-demand train, millions of users act in the same second. This causes:

1. **Crashes:** servers cannot handle the sudden spike.
2. **Unfairness:** bots and scripts beat humans by milliseconds.
3. **Double booking and lost seats:** race conditions sell the same seat twice, or money is taken with no ticket issued.
4. **Payment failures:** retries cause double charges or "paid but no ticket".
5. **Poor experience:** users see errors instead of a clear queue or status.

**Context:** Indian Railways has reduced bot abuse with Aadhaar-OTP verification and by deactivating crores of fake IDs, but reports of crashes, payment failures, and instant waitlisting during peak booking hours continue. Reliability under a sudden spike is still an engineering problem worth solving.

### Our solution (one line per problem)

| Problem | Our fix |
|---|---|
| Crash under spike | Stateless servers + Kubernetes autoscaling + caching |
| Everyone hits at once | Virtual waiting room (Redis queue) with controlled admission |
| Double booking | Atomic seat hold in Redis + DB unique constraint |
| Bots win | Rate limiting + one session per account + randomized admission window |
| Payment problems | Idempotency keys + payment queue + reconciliation job |
| Server dies mid-rush | Health checks + auto-restart + self-healing |

---

## 3. Goals and Non-Goals

**Goals**
- Handle a simulated 10,000-user rush with **0 double bookings**.
- Show autoscaling (2 pods to N pods) live on a dashboard.
- Show a waiting room with a live queue position.
- Let a judge click a "Break It" panel (kill a server, flood traffic, bad deploy) and watch auto-recovery.
- Full CI/CD: `git push` builds, tests, and deploys automatically.
- A stunning, animated UI that opens with a **train animation**.

**Non-goals**
- No real IRCTC integration, no real payments, no real Aadhaar data.
- No production-grade auth (a simple demo login is fine).

---

## 4. Tech Stack (all free)

| Layer | Tool |
|---|---|
| Frontend | HTML + CSS + vanilla JavaScript. Libraries loaded via **CDN** (see Section 5) |
| Backend | Node.js + Express |
| Cache / queue / locks | Redis |
| Database | PostgreSQL |
| Reverse proxy / rate limit | Nginx |
| Containers | Docker, Docker Compose |
| Orchestration + autoscaling | Kubernetes using **kind** or **minikube** (HPA) |
| Monitoring | Prometheus + Grafana (+ `prom-client` in Node) |
| Load testing | **k6** |
| CI/CD | GitHub Actions |
| Chaos panel | Small Node service that calls Docker/kubectl |

> Note on "CDN content": all frontend libraries (GSAP, Chart.js, fonts, icons) are loaded from a CDN with a `<script>`/`<link>` tag, so there is **no frontend build step**. Add a local fallback copy for each file in `/frontend/vendor/` in case venue wifi fails.

---

## 5. Frontend: UI/UX Specification

### 5.1 CDN libraries to use
- **GSAP** (animation timelines): `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js`
- **Chart.js** (live charts): `https://cdn.jsdelivr.net/npm/chart.js`
- **Google Fonts:** "Poppins" (UI) and "Orbitron" (counters/numbers)
- **Lucide or Font Awesome** icons via CDN

### 5.2 Design language
- Theme: **night-railway**. Deep navy to purple sky gradient, warm amber (#FFB703) signal-light accents, soft white text.
- Cards: glassmorphism (blurred translucent panels, 16px radius, subtle border).
- Status colors: green = healthy, amber = queued/warning, red = failure.
- Fully responsive (mobile first). Respect `prefers-reduced-motion` (skip heavy animation).

### 5.3 OPENING TRAIN ANIMATION (the "wow" intro)

Plays once per session (`sessionStorage`), about 4.5 seconds, with a visible **Skip** button.

**Scene layers (full-screen, parallax):**
1. Night sky gradient with twinkling stars (CSS animation).
2. Far layer: city/hill silhouette scrolling slowly (slowest).
3. Mid layer: trees and electric poles scrolling at medium speed.
4. Near layer: railway track with sleepers scrolling fastest, creating depth.
5. **Train** (inline SVG): engine + 3 coaches, spinning wheels (CSS rotate), glowing headlight, steam/smoke puffs rising behind the engine.
6. A **station board** reading "TATKAL SHIELD" that slides in at the end.

**GSAP timeline (approximate):**
```
0.0s  Fade in the scene (sky, stars, parallax layers start moving)
0.3s  Train enters from the left edge, moving right with slight bounce
1.5s  Train slows down as it nears center (ease: "power2.out")
2.5s  Train stops at the platform: smoke puff, a short whistle sound (optional, muted by default)
3.0s  Station board drops in: "TATKAL SHIELD"; tagline fades in below it
3.8s  Train pulls away to the right, accelerating (ease: "power2.in")
4.2s  The whole scene fades and slides up like a curtain
4.5s  The main app fades in; hero section animates in
```

**Rules**
- Pure SVG + CSS + GSAP. No video files, no heavy images.
- Wheels rotate with a CSS `@keyframes spin` linked to train speed.
- Add a subtle camera shake when the train stops.
- Provide `Skip intro` (top right) and auto-skip if `prefers-reduced-motion` is set.
- Preload the main UI behind the intro so there is no flash.

### 5.4 Pages / screens

1. **Hero / Landing:** headline, countdown to "Tatkal opens at 10:00:00", "Join the Rush" button, animated train moving along the bottom edge in a slow loop.
2. **Search + Train list:** from/to, date, cards for each train with seat availability bars that animate on change.
3. **Waiting Room:** big animated number "You are #4,512", estimated wait, progress ring, subtle moving-train progress bar ("your train is arriving"). Updates live (polling every 1s or Server-Sent Events).
4. **Seat Selection:** a coach grid; seats are green (free), amber (held by someone, with countdown), red (sold). A 5-minute hold timer with a circular countdown.
5. **Payment (mock):** simple form, "Pay" button, success animation (ticket slides out like a printed ticket, with a confetti burst).
6. **My Ticket:** a styled ticket card with a QR placeholder and PNR.
7. **Control Room (dashboard):** live Grafana-style panels (Chart.js or embedded Grafana): requests/sec, pods count, queue length, double bookings (always 0, shown in green), bots blocked, recovery time.
8. **Chaos Panel ("Break It"):** big buttons for the jury (see Section 8).

### 5.5 Micro-interactions
- Buttons: press-down effect + ripple.
- Seat hover: lift + glow. Seat taken by someone else: shake once and show a toast ("Just taken, try another").
- Numbers count up/down smoothly (GSAP `snap`).
- Toasts for every event (queued, admitted, seat held, hold expired, paid).
- Skeleton loaders instead of spinners.

---

## 6. Architecture

```
Browser
   |
   v
Nginx (rate limit, load balancing, static files)
   |
   v
+-----------------------------------+
|  API pods (Node/Express) x 2..20   |  <- autoscaled by Kubernetes HPA
|  - /queue  /seats  /book  /pay     |
|  - /metrics (Prometheus)           |
+-----------------------------------+
   |                |               |
   v                v               v
Redis           PostgreSQL     Payment worker (queue + retries)
(waiting room,   (trains, seats,  + reconciliation job
 seat holds,      bookings,
 rate limits,     payments)
 idempotency)

Prometheus --> Grafana (dashboard)      GitHub Actions (CI/CD)      Chaos service (Break It)
```

**Request flow:**
User -> Nginx (rate limit) -> Waiting room (Redis queue) -> Admitted token -> Seat hold (Redis atomic) -> Payment queue -> Postgres (unique constraint) -> Confirmation

---

## 7. Core Backend Design

### 7.1 Database (PostgreSQL)

```sql
CREATE TABLE trains (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure TIMESTAMP NOT NULL,
  total_seats INT NOT NULL
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  train_id INT REFERENCES trains(id),
  seat_no INT NOT NULL,
  user_id TEXT NOT NULL,
  pnr TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,           -- CONFIRMED / CANCELLED
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (train_id, seat_no)      -- SECOND SAFETY NET: DB refuses double booking
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,   -- retries never double charge
  booking_ref TEXT NOT NULL,
  amount INT NOT NULL,
  status TEXT NOT NULL,           -- PENDING / SUCCESS / FAILED
  created_at TIMESTAMP DEFAULT now()
);
```

### 7.2 Redis keys

| Key | Type | Purpose |
|---|---|---|
| `queue:{trainId}` | Sorted set | Waiting room. Score = join order (with randomized fairness window) |
| `admitted:{trainId}:{userId}` | String + TTL | Admission token (e.g. 120s) |
| `seat:{trainId}:{seatNo}` | String + TTL 300s | Seat hold, value = holdToken (`SET NX EX`) |
| `rate:{ip}` / `rate:{userId}` | Counter + TTL | Rate limiting |
| `idem:{key}` | String + TTL | Idempotency cache for payments |
| `stats:*` | Counters | Metrics shown on dashboard |

### 7.3 Waiting room logic
- `POST /queue/join`: add user to the sorted set. **Fairness window:** everyone who joins within the first 3 seconds after opening gets a random score, so being 5 ms faster gives no advantage. Later joiners are ordered by arrival time.
- An **admission worker** runs every second and moves the next **N users** (e.g. 200/sec, configurable) from the queue into `admitted:*` with a TTL. N matches what the backend can safely handle.
- `GET /queue/status`: returns position, estimated wait, and admitted flag.
- Only users with a valid admission token may call `/seats/hold`.

### 7.4 Seat hold and booking (no double booking)
1. `POST /seats/hold` runs: `SET seat:{train}:{seat} {holdToken} NX EX 300`. If it returns OK, the user holds the seat. If not, return "taken".
2. `POST /book/confirm` (after mock payment succeeds): verify the holdToken matches (use a small Lua script for check-and-delete atomically), then `INSERT` into `bookings`. If the unique constraint fails, roll back and report "seat taken".
3. Expired holds free themselves automatically through the TTL.

### 7.5 Payments (mock)
- Client sends an `Idempotency-Key` header. The server checks `idem:{key}` first and returns the previous result if repeated.
- Payments go through a queue (BullMQ on Redis) with retries and exponential backoff.
- A **reconciliation job** (runs every minute) finds "payment SUCCESS but no booking" and "booking but payment missing" and fixes them.
- Simulate random payment failures (about 5%) to prove the retry logic.

### 7.6 Bot defense
- Nginx `limit_req` per IP, plus a Redis token bucket per user.
- One active booking session per account.
- Flag clients that act inhumanly fast (e.g. under 300 ms between page load and submit) and require a lightweight challenge (simple "slide to confirm" or proof-of-work), only for suspicious traffic.
- Count and display "bots blocked" on the dashboard.

### 7.7 Observability
Expose `/metrics` with `prom-client`:
`http_requests_total`, `request_duration_seconds`, `queue_length`, `admitted_users`, `seats_sold`, `double_booking_attempts_blocked`, `bots_blocked`, `payment_retries_total`.
A special metric `double_bookings_total` must always remain **0**.

---

## 8. Chaos Panel ("Break It") for the Jury

A separate small service with big buttons. Each action shows a before/after timeline and a **recovery time** in seconds.

| Button | What it does | Expected recovery |
|---|---|---|
| Kill a Server | Deletes one API pod/container | Traffic reroutes, new pod starts |
| Traffic Flood | Fires 10,000 users via k6 | Autoscale 2 to N pods, queue absorbs the load |
| Kill Redis | Restarts Redis | App degrades gracefully, restores state, no double bookings |
| Slow Network | Adds artificial latency | Timeouts and retries kick in |
| Push Bad Deploy | Deploys a deliberately broken version | Health check fails, **auto-rollback** to last good version |
| Break the Database | Pauses Postgres briefly | Requests queue and retry, none lost |

After every attack, show a green "System recovered in X seconds. Double bookings: 0".

---

## 9. BUILD ORDER (do phase by phase; stop after each for my approval)

### Phase 1: Basic booking app
- Folder structure, Express API, Postgres schema, seed fake trains.
- Endpoints: list trains, list seats, hold seat, confirm booking.
- Simple frontend (no animation yet) that works end to end.
- **Accept when:** I can book a seat and see it marked sold.

### Phase 2: Docker + CI/CD
- Dockerfile for the API, `docker-compose.yml` (api, postgres, redis, nginx).
- GitHub Actions: install, lint, test, build image, push to registry, deploy step.
- **Accept when:** `docker compose up` runs everything and a `git push` triggers a green pipeline.

### Phase 3: Seat locking (no double booking)
- Redis atomic holds (`SET NX EX`) + Lua confirm + DB unique constraint.
- Concurrency test: 500 parallel requests for one seat, exactly 1 succeeds.
- **Accept when:** the test shows 1 success, 499 clean rejections, 0 double bookings.

### Phase 4: Waiting room
- Queue join/status, admission worker, fairness window, admission tokens.
- Frontend waiting-room screen with live position.
- **Accept when:** 1,000 simulated users are admitted gradually, not all at once.

### Phase 5: Autoscaling on Kubernetes
- Kubernetes manifests (Deployment, Service, Ingress, HPA) on kind/minikube.
- HPA scales on CPU (and queue length if time allows), min 2, max 20.
- Readiness and liveness probes.
- **Accept when:** under load pods go from 2 to many and back down.

### Phase 6: Load test
- k6 script that simulates the 10:00 AM rush (ramp to 10,000 virtual users).
- Include scenarios: normal, spike, and bot-like traffic.
- **Accept when:** results show 0 double bookings and acceptable error rate.

### Phase 7: Monitoring dashboard
- Prometheus scraping + Grafana dashboard (or in-app Chart.js dashboard).
- Panels from Section 7.7.
- **Accept when:** live graphs react during a load test.

### Phase 8: Chaos panel
- Implement the buttons from Section 8 with recovery timers.
- Auto-rollback on failed health checks.
- **Accept when:** every button triggers a failure and the system visibly recovers.

### Phase 9: UI/UX polish + train intro
- Build the opening train animation (Section 5.3), all pages (5.4), micro-interactions (5.5).
- Responsive and reduced-motion support.
- **Accept when:** intro plays smoothly, skip works, all screens match the design language.

### Phase 10: Demo hardening
- Seed data reset button, one-command startup script (`./start-demo.sh`).
- Recorded backup demo video in case the venue wifi or hardware fails.
- Local fallback copies of all CDN files.
- README with architecture diagram and run instructions.
- **Accept when:** a fresh laptop can run the whole demo with one command.

---

## 10. Suggested Folder Structure

```
tatkal-shield/
  frontend/
    index.html
    css/styles.css
    js/ (app.js, intro.js, waitingroom.js, seats.js, dashboard.js, chaos.js)
    vendor/        (local fallback copies of CDN libraries)
  backend/
    src/ (server.js, routes/, services/, workers/, metrics.js, db.js, redis.js)
    tests/
    Dockerfile
  chaos/
    server.js
  k8s/
    deployment.yaml  service.yaml  ingress.yaml  hpa.yaml
  nginx/
    nginx.conf
  monitoring/
    prometheus.yml  grafana-dashboard.json
  loadtest/
    rush.js           (k6)
  .github/workflows/
    ci-cd.yml
  docker-compose.yml
  start-demo.sh
  README.md
```

---

## 11. Demo Script (5 minutes, for the jury)

1. **(0:00)** Open the site. The **train animation** plays, the station board reads "TATKAL SHIELD". State the problem in one sentence.
2. **(0:30)** Push a small code change. Show the pipeline build and deploy automatically.
3. **(1:00)** Press **"10:00 AM Tatkal Rush"**. Graphs spike, pods scale from 2 to N, the waiting room admits users gradually.
4. **(2:00)** Push a **bad deploy**. Show the health check failing and the automatic rollback.
5. **(3:00)** Hand the **Chaos Panel** to a judge. They kill a server or Redis. Show the recovery timer.
6. **(4:00)** Show the final scoreboard: requests handled, **double bookings = 0**, bots blocked, recovery time, uptime.
7. **(4:30)** Close: "This architecture works for any rush: tickets, exam results, flash sales."

**Backup plan:** keep a recorded video of the full demo and a laptop already running the stack.

---

## 12. Scoring Metrics to Show on Screen

- Requests handled during the rush
- **Double bookings: 0**
- Peak pods reached (e.g. 2 to 14)
- Users queued vs admitted
- Bots blocked
- Payment retries handled
- Average and worst recovery time after chaos attacks

---

## 13. Quality Checklist (verify before the event)

- [ ] 500 parallel requests for one seat gives exactly 1 booking
- [ ] Killing an API pod causes no lost bookings
- [ ] Restarting Redis does not allow a double booking (DB constraint holds)
- [ ] Repeating the same payment request charges once (idempotency)
- [ ] Bad deploy auto-rolls back
- [ ] Intro animation skippable and works with reduced motion
- [ ] All CDN files have local fallbacks
- [ ] One-command demo startup tested on a clean machine
- [ ] Mobile layout checked

---

## 14. Rules for Astra

- Build only the current phase; do not jump ahead.
- Explain each file briefly in comments so I can present it confidently.
- Prefer simple, readable code over clever code.
- After each phase give: (1) what was built, (2) the exact command to run it, (3) how to verify the acceptance check.
- If something needs a tool or install I may not have, tell me first and suggest the simplest alternative.
- Never use real IRCTC endpoints, real payment gateways, or real personal data.
