// How Railway builds and runs the `web` service (Railway "Infrastructure as Code"; it replaces railway.json, which
// Railway stops reading on 2026-12-01). Written for whoever deploys: Claude sessions and Samuel.
//
// This file covers `web` only (a named partial). The database (Postgres), its volume and the file bucket are left
// out on purpose: a file that described the whole project would delete anything later left out of it. Variables
// (API keys, DATABASE_URL, ...) stay on Railway: this file never reads or writes them.
//
// Change it, then: `railway config plan` (read-only: shows what would change), then `railway config apply`.
import { defineRailway, github, project, service } from "railway/iac";

export const partial = "web";

export default defineRailway(() => {
  const web = service("web", {
    // The repository's old address, exactly as Railway stores it (it moved to agenticghx/neolibrary; GitHub
    // redirects). Everyday deploys are `railway up` from the deploy checkout, but Railway builds from this source when
    // a settings change redeploys the service (applying this file on 2026-10-25 rebuilt main's latest commit). Leave
    // it as stored: changing it here would reconnect the service's source, which nobody has checked.
    source: github("sahuno/neolibrary", { branch: "main" }),
    build: { buildEnvironment: "V3", builder: "RAILPACK", buildCommand: "npm run build" },
    start: "npm run start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { sfo: 1 },
    domains: ["library.samuelahuno.com"],
  });

  return project("neolibrary", {
    variables: { managed: false },
    resources: [web],
  });
});
