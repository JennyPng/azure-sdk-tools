#!/usr/bin/env node
/**
 * prep-failure.ts — the deterministic-prep failure marker.
 *
 * When the deterministic prep stage aborts on a **transient** infra/budget
 * condition (a depleted API budget the C2 preflight guard caught, or a
 * mid-fetch rate-limit / 5xx / timeout in `fetch-prs`), the failing script drops
 * a `prep-failure.json` marker in the cache dir. The loop's terminal-outcome
 * post-step reads it and passes `--failure-kind transient` to `emit-outcome`, so
 * the pacer keeps the window PENDING and re-dispatches it when budget allows
 * instead of counting it toward the retry cap.
 *
 * The marker is written ONLY for transient failures. Its ABSENCE after a failed
 * prep therefore means "a genuine (hard) failure" — the conservative default, so
 * a real bug is never mistaken for a rate limit and silently retried forever.
 *
 * `prep-run` deletes any stale marker at the start of every run so a transient
 * marker from an earlier attempt can never mislabel a later hard failure.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

import { FailureKindSchema, type FailureKind } from "./pacer-schema.ts";

/** Marker filename, written into the prep cache dir. */
export const PREP_FAILURE_FILE = "prep-failure.json";

export const PrepFailureSchema = z
    .object({
        /** Retry classification the pacer keys off (only `transient` is written). */
        kind: FailureKindSchema,
        /** The prep stage that aborted (e.g. `preflight`, `fetch-prs`). */
        stage: z.string().min(1),
        /** The failure message (for the run log; never parsed by the pacer). */
        message: z.string(),
        /** ISO-8601 write timestamp. */
        ts: z.string().min(1),
    })
    .strict();
export type PrepFailure = z.infer<typeof PrepFailureSchema>;

/** Absolute path of the marker inside `cacheDir`. */
export function prepFailurePath(cacheDir: string): string {
    return path.join(cacheDir, PREP_FAILURE_FILE);
}

/**
 * Write a transient prep-failure marker into `cacheDir`. Best-effort: a failure
 * to write the marker must never mask the original error, so callers wrap this
 * in try/catch and still exit non-zero.
 */
export function writePrepFailure(
    cacheDir: string,
    input: { kind: FailureKind; stage: string; message: string; ts?: string },
): void {
    const marker: PrepFailure = PrepFailureSchema.parse({
        kind: input.kind,
        stage: input.stage,
        message: input.message,
        ts: input.ts ?? new Date().toISOString(),
    });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
        prepFailurePath(cacheDir),
        `${JSON.stringify(marker, null, 2)}\n`,
    );
}

/** Read + validate the marker (missing ⇒ null). */
export function readPrepFailure(cacheDir: string): PrepFailure | null {
    const p = prepFailurePath(cacheDir);
    if (!fs.existsSync(p)) return null;
    const raw: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
    return PrepFailureSchema.parse(raw);
}

/** Delete any stale marker (no-op when absent). */
export function clearPrepFailure(cacheDir: string): void {
    const p = prepFailurePath(cacheDir);
    if (fs.existsSync(p)) fs.rmSync(p);
}
