# ACME IoT - Smart Facility & Device Management Platform

ACME IoT is an enterprise-grade IoT platform built with **React Native**, **Expo SDK 52**, **Expo Router 4**, and **TypeScript**, targeting **Android**, **iOS**, and **Web**, backed by a **TypeScript Serverless API on Vercel** and **Supabase (PostgreSQL, Auth, Storage, and Realtime)**.

Designed with a clean light interface and modern indigo accents (`#4f46e5`), ACME IoT provides real-time facility monitoring, digital twin 3D room visualization, autonomous condition/action edge pipelines, OTA firmware rollout simulations, and full Role-Based Access Control (RBAC).

---

## 🌟 Key Capabilities

### 1. Hierarchical Navigation & Device Controls
- **Organization → Building → Room → Device Hierarchy**:
  - **Two Organizations**: *ACME Global Headquarters* (commercial enterprise campus) and *Nova Logistics & ColdChain* (industrial sorting and cryo storage).
  - **Twenty Realistic Devices**: Thermostats, Smart Plugs with power metering, High-precision Temperature sensors, Humidity monitors, and PIR/Radar Occupancy sensors.
  - **Separation of Desired State vs Device-Reported State**: Inspect cloud setpoint goals side-by-side with physical device reported telemetry in real time.
  - **Direct Actuation**: Thermostat temperature setpoint steppers, Smart plug relay toggle controls, and telemetry sampling adjustments.

### 2. Interactive 3D Room Twin Visualization
- Embedded 3D isometric digital twin visualizer rendered via isometric projection across Web and Mobile.
- Visualizes room boundaries, spatial device coordinates, glowing thermostat status, power relay activity, and real-time radar presence cones.
- Tap any 3D node to inspect desired vs reported telemetry state.

### 3. Simulation Engine & Scenarios
- Built-in HTTP and local simulation engine requiring **no external MQTT broker**:
  - **Normal Operations**: Natural ambient temperature fluctuation, power metering, and occupancy detection.
  - **High Heatwave & Load**: Rapidly spikes ambient temperatures, forcing heavy cooling load and threshold breaches.
  - **Network Degraded / Flapping**: Simulates high RSSI attenuation, packet drops, and device offline transitions.
  - **Battery Drain Emergency**: Accelerates battery depletion down to critical warnings.
  - **Firmware Rollout Wave**: Simulates multi-stage OTA updates (downloading → flashing → rebooting → verification) with one-click automated rollback.
- **Advance Tick**: Advance simulation time on demand or run automated live ticker.
- **Reset Demo Data**: Instantly restore the clean 2-organization, 20-device demo dataset (demo builds only, owners/administrators).
- Demo builds keep their fictitious simulated data in browser localStorage. With a Supabase backend (server mode) the simulation is off: tenant data, the profile and the Supabase tokens stay in memory only and are wiped on logout.

### 4. Mobile & Web Adaptations
- **Web**: Responsive layout with sidebar navigation, metric grids, and quick inspector panels.
- **Mobile (iOS & Android)**:
  - Touch-optimized forms and bottom tab navigation.
  - Automatic detection of network disconnection: pauses background updates and presents an **Offline Read-Only View**.
  - Enforces that control actions require an active connection; resumes real-time syncing automatically upon reconnection.

### 5. Role-Based Access Control (RBAC)
- **Owner**: Full administrative access, tenant settings, member management, device actuation, and audit export.
- **Administrator**: Full device control, automation rule builder, firmware OTA rollouts, and alert resolutions.
- **Operator**: Day-to-day operations, adjusting setpoints, toggling power relays, and acknowledging alerts. (Restricted from team invites and firmware rollouts).
- **Viewer**: Read-only access across all telemetry, rooms, and devices. Control actions and rule modifications are disabled.
- **Instant Persona Switcher**: Top-bar modal allows switching between the 4 personas to evaluate RBAC enforcement (only when `EXPO_PUBLIC_DEMO_MODE=true`).

### 6. Threat Modeling & SD Elements Traceability
- Assessed against **SD Elements Project #28** (Application: `ACME IoT`).
- All **85 countermeasures** evaluated and updated in SD Elements:
  - **75 Complete** (code, RLS policies, input schemas, headers).
  - **7 Not Applicable** (PHI/HIPAA healthcare controls, Apple CloudKit).
  - **3 Incomplete** (formal production peer review, regulatory breach notification playbook, geographic residency certification).
- Every countermeasure updated in SD Elements with bilingual comments in **Brazilian Portuguese (PT-BR)** and **English (EN)**, signed with:
  `RafahMarinho with Agentic AI`.

---

## 🏗️ Architecture & Project Structure

```
├── api/                       # Vercel Serverless TypeScript API
│   ├── automations/evaluate.ts # Automation rule evaluation endpoint
│   ├── devices/index.ts       # Device catalog & enrollment validation (Zod)
│   ├── firmware/rollout.ts    # OTA firmware rollout & rollback
│   ├── health.ts              # System health & platform telemetry
│   └── simulation/            # Scenario management & tick trigger
├── app/                       # Expo Router file-based screens
│   ├── (auth)/
│   │   ├── forgot-password.tsx# Cryptographic password recovery
│   │   └── login.tsx          # Login with role quick-switch personas
│   ├── (app)/
│   │   ├── _layout.tsx        # Role-adapted responsive layout & navigation
│   │   ├── alerts.tsx         # Incident alerts & resolution workflow
│   │   ├── automations.tsx    # Condition/action edge rules & cooldowns
│   │   ├── buildings.tsx      # Building facilities & floor metrics
│   │   ├── dashboard.tsx      # Facility dashboard & 3D room twin
│   │   ├── device-detail.tsx  # Telemetry inspector & desired/reported controls
│   │   ├── device-enroll.tsx  # QR code scanner simulator & manual enrollment
│   │   ├── devices.tsx        # 20-device directory with filters and search
│   │   ├── events.tsx         # Live telemetry & immutable audit stream
│   │   ├── firmware.tsx       # OTA firmware campaigns & rollback
│   │   ├── integrations.tsx   # Simulated webhooks & API keys
│   │   ├── rooms.tsx          # Room directory & 3D digital twin
│   │   ├── settings.tsx       # Profile, security posture & SD Elements audit
│   │   └── team.tsx           # Team RBAC matrix & member invitation
│   ├── _layout.tsx            # Global app layout & simulation tick runner
│   └── index.tsx              # Root entry redirect
├── docs/
│   └── security/
│       ├── sde-controls-assessment.json # Traced 85 SD Elements controls
│       └── threat-model.md              # Detailed STRIDE threat analysis
├── scripts/
│   ├── test-runner.ts         # Functional and integration test suite
│   ├── verify-security-controls.ts # Validates code against SD Elements controls
│   └── sync-sde-tasks.ts      # Automated SD Elements API synchronization
├── src/
│   ├── components/            # Reusable UI (DeviceCard, Header, ScenarioBar, RoomVisualizer3D, StatusBadge)
│   ├── mock/                  # Seed data for 2 orgs, 20 devices, automations, and firmware
│   ├── services/              # Supabase, Simulation Engine, Storage, and Security Services
│   └── types/                 # TypeScript domain models
├── supabase/
│   ├── migrations/            # PostgreSQL schema with Row-Level Security (RLS)
│   └── seed.sql               # Seed data for 2 organizations, buildings, rooms, and devices
├── app.json                   # Expo configuration for Web, iOS, and Android
├── vercel.json                # Vercel deployment config, rewrites & security headers
└── package.json               # Dependencies and scripts (pnpm)
```

---

## 🚀 Getting Started (Local Development)

### Prerequisites
- **Node.js** v20+ or v22+
- **pnpm** v10+ (`npm install -g pnpm`)

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(If you do not provide Supabase credentials, the platform seamlessly operates in the built-in local offline fallback sandbox mode with all features, 3D visualization, and simulation fully active).*

### 3. Run Development Servers
- **Web**:
  ```bash
  pnpm run web
  ```
- **Android**:
  ```bash
  pnpm run android
  ```
- **iOS**:
  ```bash
  pnpm run ios
  ```

### 4. Build Static Web Distribution
```bash
pnpm run build:web
```
Produces an optimized static bundle in `dist/`.

---

## 🧪 Testing & Verification

Run the comprehensive test suites to verify functional workflows, RBAC constraints, and SD Elements security requirements:

```bash
# 1. Run Functional & Integration Tests
pnpm test

# 2. Run SD Elements Security Controls Verification
pnpm run test:security

# 3. TypeScript Compilation Check
pnpm run typecheck
```

---

## 🗄️ Database Setup (Supabase PostgreSQL)

1. Create a project on [Supabase](https://supabase.com).
2. Open the **SQL Editor** in the Supabase Dashboard.
3. Execute `supabase/migrations/20261012_init_schema.sql` to create:
   - Tables (`organizations`, `user_profiles`, `buildings`, `rooms`, `devices`, `telemetry_readings`, `automations`, `alerts`, `events_log`, `firmware_packages`, `firmware_rollouts`, `integrations`).
   - Row-Level Security (RLS) policies and tenant isolation functions (`current_user_org_id()`, `current_user_role()`).
   Then execute, in order, `20261019_security_hardening.sql` and `20261020_server_authoritative_access.sql` (per-role write policies with `WITH CHECK`, column grants, team invitations, data-change audit triggers and the append-only, hash-chained `events_log`).
4. Execute `supabase/seed.sql` to populate:
   - 2 Organizations (*ACME Global Headquarters* & *Nova Logistics & ColdChain*).
   - 4 Buildings, 6 Rooms, 20 IoT Devices, initial automations, alerts, and firmware binaries.
5. In your `.env` file, populate:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

---

## ☁️ Deployment Guide

### Deploying to Vercel (Web & TypeScript API)

ACME IoT is configured out-of-the-box for zero-config deployment on Vercel:

1. Push this repository to GitHub or GitLab.
2. Import the project into your [Vercel Dashboard](https://vercel.com).
3. Set the Framework Preset to **Other** (handled via `vercel.json`).
4. Add the environment variables:
   - `EXPO_PUBLIC_SUPABASE_URL` (`https://` only; plain `http://` is accepted just for a local Supabase on localhost)
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_JWT_SECRET` and/or `SUPABASE_JWKS` (server only): keys `/api` uses to verify Supabase access tokens. Without them the API answers 503 (fails closed).
   - `/api` also asks Supabase Auth (`/auth/v1/user`) whether the token's session still exists, so tokens stop working right after logout; it uses `SUPABASE_ANON_KEY` or, if unset, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
   - `ALLOWED_ORIGINS` (server only, optional): comma-separated exact origins allowed to call `/api` cross-origin. Empty means same-origin only.
   - `EXPO_PUBLIC_DEMO_MODE=true` only for non-production demo builds (demo personas, persona/tenant switcher, Reset Demo).
   - Do not add `SUPABASE_SERVICE_ROLE_KEY`: no code uses it.
5. Apply `supabase/migrations/20261019_security_hardening.sql` and `supabase/migrations/20261020_server_authoritative_access.sql`, then push the versioned Auth settings with `SUPABASE_AUTH_SITE_URL=<web URL> supabase config push` (`supabase/config.toml`: password standard, invite-only sign-up, recovery link expiry, rate limits, MFA, and the **Custom Access Token** hook `public.custom_access_token_hook`, which adds `org_id` and `user_role` to access tokens; `/api` answers 403 without them).
6. Deploy. Vercel automatically:
   - Executes `pnpm run build:web` to generate `dist/`.
   - Deploys the TypeScript Serverless functions from `/api` (`/api/data`, `/api/commands`, `/api/devices`, `/api/health`, `/api/simulation/scenarios`, `/api/auth/logout`, `/api/csp-report`).
   - Enforces hardened HTTP headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `CSP`, and `HSTS`).

### Release security checklist

These controls are on by default and must stay on in every release (SD Elements T49):

- **Server mode is the production mode.** With a Supabase backend configured, the app reads tenant data only from `GET /api/data` and changes it only through `POST /api/commands` and `POST /api/devices`. The API checks the token, the caller's current role and organization in the database, the permission of each command and the tenant of each object; Postgres RLS (`supabase/access-matrix.json` documents every account, table, column and function) enforces the same rules for direct database access.
- **Nothing sensitive in the browser.** In server mode tenant data, profile and Supabase tokens stay in memory (no localStorage/sessionStorage); a page reload requires signing in again.
- **No demo code paths or data.** Build releases without `EXPO_PUBLIC_DEMO_MODE=true`: `metro.config.js` then replaces the demo dataset and personas with an empty module, and the persona switcher, tenant switcher, simulation controls and Reset Demo stay disabled. No source maps are published.
- **Audit trail.** `events_log` is append-only and SHA-256 hash-chained; `/api/data` re-verifies the entries it serves and the Events page shows the result. Only `purge_events_log(retention_days >= 365)` (service role) removes old entries.
- **Verification.** CI runs `pnpm typecheck`, `pnpm test`, `pnpm build:web`, `pnpm test:security` (which inspects the export) and `pnpm audit --prod`.

---

## 📱 Generating Native Mobile Packages (Android & iOS)

ACME IoT is built with Expo SDK 52 and supports native builds via **Expo Application Services (EAS Build)**:

### 1. Install EAS CLI
```bash
npm install -g eas-cli
```

### 2. Log In & Initialize EAS
```bash
eas login
eas build:configure
```

### 3. Generate Android APK / AAB
```bash
# Build an Android APK for direct device testing
eas build --platform android --profile preview

# Build an Android App Bundle (AAB) for Google Play Store
eas build --platform android --profile production
```

### 4. Generate iOS IPA (Simulator or App Store)
```bash
# Build for iOS Simulator (macOS)
eas build --platform ios --profile simulator

# Build an IPA for TestFlight / App Store submission
eas build --platform ios --profile production
```

### 5. Local Native Prebuild (Alternative without EAS)
```bash
# Generate native /android and /ios folders
npx expo prebuild

# Run directly on attached Android device or emulator
npx expo run:android

# Run directly on attached iOS simulator (macOS required)
npx expo run:ios
```

---

## 🛡️ SD Elements (SDE) Threat Modeling Assessment

- **Host:** `https://sde-ent-echo.sdelab.net`
- **Application:** `ACME IoT` (ID: 15)
- **Project:** `ACME IoT - Smart Building & Device Platform` (ID: 28)
- **Threat Survey:** 71 Answers configured, covering React Native, Expo Web, Android, iOS, PostgreSQL (Supabase), RESTful Web Services, RBAC, and IoT Architecture.
- **Evaluated Countermeasures:** All 85 requirements updated with bilingual technical rationale (Portuguese & English) and the exact signed footer:
  `RafahMarinho with Agentic AI`.
- Complete traceability is documented in `docs/security/sde-controls-assessment.json` and `docs/security/threat-model.md`.
- `scripts/sync-sde-tasks.ts` reads `SDE_URL` and `SDE_API_TOKEN` from the environment (shell or CI secret store) and refuses to run without them; never commit these values.

---

## 👥 Demo Personas (Quick Login)

| Role | Name | Email | Permissions |
| :--- | :--- | :--- | :--- |
| **Owner** | Sarah Chen | `sarah.chen@acme-iot.com` | Full tenant control, member management, device actuation, audit export. |
| **Administrator** | Alex Rivera | `alex.rivera@acme-iot.com` | Full device control, automation rules, firmware OTA rollout & rollback. |
| **Operator** | Marcus Vance | `marcus.vance@acme-iot.com` | Live telemetry inspection, setpoint adjustment, relay toggle, alert resolution. |
| **Viewer** | Elena Rostova | `elena.rostova@acme-iot.com` | Read-only inspection of telemetry, 3D twins, and events. Control disabled. |

*(Demo personas only work in builds with `EXPO_PUBLIC_DEMO_MODE=true` and no Supabase backend; use the top-bar persona switcher there to test role adaptation.)*
