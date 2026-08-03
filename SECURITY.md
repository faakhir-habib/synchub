# Security Policy

## Supported Versions

SyncHub is pre-1.0. Only the latest release (and `main`) receives security
fixes.

| Version        | Supported |
| -------------- | --------- |
| latest release | ✅        |
| older releases | ❌        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub
issues.**

Instead, use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/faakhir-habib/synchub/security/advisories/new).

Please include as much of the following as you can:

- The affected component (Hub API, web UI, agent binary, install scripts, sync
  protocol)
- Steps to reproduce, or a proof of concept
- The impact you believe it has (e.g. auth bypass, data exposure between
  users/machines)

You should receive an acknowledgement within a few days. Once the issue is
confirmed and a fix is available, it will be released and the advisory
published with credit to the reporter (unless you prefer to remain anonymous).

## Scope notes for self-hosters

SyncHub is designed for self-hosting by a single or small trusted group of
users. Be aware of the current hardening status before exposing a Hub to the
public internet:

- There is **no rate limiting or password reset** yet.
- The relay store and SQLite database are **plaintext at rest** — encrypt the
  `/data` volume if your transcripts are sensitive.
- Always run the Hub behind **HTTPS/WSS** (e.g. a reverse proxy or tunnel);
  agent tokens and session cookies must not travel over plain HTTP.
