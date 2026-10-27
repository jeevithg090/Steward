/**
 * Side-effect module: imported first by `bootstrap.ts`, so blank base URLs are gone and telemetry is
 * off before `@copilotkit/runtime` is evaluated. ES modules evaluate imports in order, and this one
 * imports nothing heavy.
 */
import { normaliseEnv } from "./env.ts";

normaliseEnv(process.env);
