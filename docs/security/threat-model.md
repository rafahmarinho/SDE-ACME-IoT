# ACME IoT - Security Architecture & Threat Model Report

**Project Name:** ACME IoT - Smart Building & Device Platform  
**SD Elements Project ID:** 28  
**Application ID:** 15 (`ACME IoT`)  
**Assessment Date:** 2026-10-12  
**Assessed Countermeasures:** 85 (100% Survey Complete)  
**Status Breakdown:** 75 Complete, 7 Not Applicable, 3 Incomplete  
**Signed by:** `RafahMarinho with Agentic AI`

---

## 1. Architectural Overview & Trust Boundaries

ACME IoT is a cross-platform facility telemetry and autonomous control platform for smart buildings, commercial campuses, and industrial cold storage vaults.

```mermaid
graph TD
    subgraph Client Tier [Cross-Platform Client (Expo / React Native)]
        Web[Expo Web SPA]
        iOS[Native iOS App]
        Android[Native Android App]
        LocalStore[(Encrypted Storage / Cache)]
    end

    subgraph Edge / API Tier [Vercel Serverless Edge API]
        VercelAPI[TypeScript REST API]
        EdgeHeaders[Security Headers & CSP]
        RateLimiter[Token Bucket Rate Limiter]
        ZodValidator[Zod Input Validation]
    end

    subgraph Data & Auth Tier [Supabase Managed Cloud]
        SupaAuth[Supabase Auth (JWT / CSPRNG)]
        Postgres[(PostgreSQL 15+)]
        RLS[Row-Level Security Policies]
        Realtime[WebSockets / Realtime Stream]
    end

    subgraph IoT Mesh [Simulated Hardware Fleet (20 Devices)]
        Thermostats[Smart Thermostats]
        Plugs[Smart Plugs & Relays]
        Sensors[Temp, Humidity, Occupancy Nodes]
    end

    Client Tier -->|TLS 1.3 / HTTPS| Edge / API Tier
    Client Tier -->|WSS / Realtime| Realtime
    Client Tier -->|Direct Authenticated RPC| SupaAuth
    Edge / API Tier -->|Service Role / RLS| Postgres
    Realtime --> Postgres
    IoT Mesh -->|Encrypted Telemetry Push| Edge / API Tier
```

---

## 2. Threat Modeling & STRIDE Analysis

| STRIDE Category | Threat Description | Mitigating Control & SD Elements Traceability |
| :--- | :--- | :--- |
| **Spoofing** | Attacker impersonates an authorized facility operator or device. | Supabase Auth tokens (T20, T792); strong password requirements (T143); device codes anchored to organization tenancy via RLS (T19). |
| **Tampering** | Ingestion of malformed or unauthorized temperature/power setpoints. | Desired vs Reported state isolation; Zod schema enforcement on all API routes (T42, T536); SHA-256 binary validation on firmware (T60). |
| **Repudiation** | Operator disables safety chillers without an audit trail. | Immutable `events_log` table with actor role, ID, action, and timestamp recorded on all state changes and rule executions (T2602, T349, T755). |
| **Information Disclosure** | Leakage of device identifiers, internal building layouts, or JWTs. | Indirect object reference mapping (T50); strict RLS isolation by `organization_id` (T2598); strict CORS and CSP headers (T66, T35, T257). |
| **Denial of Service** | Flooding API with massive payload sizes or high-frequency requests. | 50KB payload ceiling (T536); token bucket message throttling at 60 requests/minute (T1362, T70). |
| **Elevation of Privilege** | Viewer role attempting to switch power relay or trigger firmware rollouts. | Centralized Role-Based Access Control matrix (Owner, Administrator, Operator, Viewer) verified on server and database policies (T338, T17, T145). |

---

## 3. SD Elements Countermeasures Assessment Summary

All 85 countermeasures in SD Elements Project 28 were evaluated against the code, database schema, and infrastructure.

### Summary Metrics:
- **Total Countermeasures:** 85
- **Complete:** 75 (88.2%)
- **Not Applicable:** 7 (8.2%) - *Hospital PHI/HIPAA controls (T137, T139, T377), Apple CloudKit/iCloud (T5634, T5635), and physical datacenter deployment forms (CT1, CT2)*
- **Incomplete:** 3 (3.6%) - *Formal peer code review sign-off (T2348), regulatory data breach notification legal playbook (T2128), and regional data sovereignty localization certification (T2170)*

Every countermeasure in SD Elements has been commented in both **Brazilian Portuguese (PT-BR)** and **English (EN)**, ending with:
`RafahMarinho with Agentic AI`
