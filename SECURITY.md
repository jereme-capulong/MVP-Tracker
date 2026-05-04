# Security Policy

## Supported Versions

This project currently supports security fixes for the latest major release line only.

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

## Reporting a Vulnerability

Please do not disclose security issues publicly before a fix is available.

Preferred reporting path:

1. Use GitHub private vulnerability reporting for this repository (Security tab -> Report a vulnerability).
2. If private reporting is not available, open a public issue with only the title `Security: request private contact` and no exploit details.

Please include:

- Affected version, commit hash, and OS (Windows or macOS)
- Impact and attack scenario
- Reproduction steps or proof of concept
- Any suggested mitigation or patch

Response targets:

- Initial acknowledgement within 72 hours
- Triage update within 7 calendar days
- Fix timeline based on severity and exploitability

## Scope

In scope:

- Remote code execution, privilege escalation, auth bypass, or data exposure risks in Electron main/preload/renderer flows
- IPC misuse, input validation bypasses, or trust-boundary violations
- Firestore access-control issues related to this app's data model and usage
- Local data integrity or exposure issues involving DuckDB cache and settings persistence

Out of scope:

- Issues in unsupported versions
- Vulnerabilities requiring prior local machine compromise or physical access
- Disclosure of Firebase web config values (`VITE_FIREBASE_*`), which are identifiers and not high-privilege secrets
- Best-practice suggestions without a reproducible security impact

## Secure Configuration Checklist

For production use, verify the following:

- Firestore rules require authenticated reads and writes
- User profile writes are restricted to `request.auth.uid == uid`
- Firestore schema fields and types are validated for `monsters`, `categories`, `monsterHistory`, `users`, and `statsConfig`
- No service account keys or private credentials are shipped in renderer code or `VITE_` variables
- Dependencies are kept current and checked regularly (for example `npm audit`)

## Data Handling Notes

- Authentication is provided by Firebase Authentication (Google sign-in in the current UI).
- Shared collaborative state is stored in Cloud Firestore.
- Local analytics/history cache is stored in DuckDB under Electron `userData` as `mvp-tracker-local-cache.duckdb`.
- UI preferences are stored in localStorage and may include local file paths (for example custom alert sound path).
- Local cache and localStorage data are not encrypted by the app; rely on OS account controls and disk encryption for at-rest protection.

## Electron Runtime Notes

Current hardening in this codebase includes:

- `contextIsolation: true`
- `nodeIntegration: false`
- Privileged operations exposed through a constrained preload bridge (`window.electronAPI`)
- Production renderer hosting on loopback (`127.0.0.1`) with normalized-path checks in the local static server

## Coordinated Disclosure

Please allow maintainers reasonable time to investigate and ship a fix before public disclosure. After a patch is released, maintainers may publish an advisory or release notes with attribution if requested.
