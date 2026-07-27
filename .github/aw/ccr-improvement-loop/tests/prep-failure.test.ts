/**
 * prep-failure.test.ts — the transient prep-failure marker (retry policy).
 *
 * The marker is the deterministic-prep stage's only channel for telling the
 * pacer "this failure was infra, keep the window pending". These tests pin its
 * round-trip, its strict validation, and the clear-on-start contract that stops
 * a stale transient marker from mislabeling a later hard failure.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    PREP_FAILURE_FILE,
    clearPrepFailure,
    prepFailurePath,
    readPrepFailure,
    writePrepFailure,
} from "../scripts/prep-failure.ts";

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "prep-failure-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("prep-failure marker", () => {
    it("round-trips a transient marker through write + read", () => {
        writePrepFailure(dir, {
            kind: "transient",
            stage: "fetch-prs",
            message: "HTTP 403 API rate limit exceeded",
        });
        const marker = readPrepFailure(dir);
        expect(marker?.kind).toBe("transient");
        expect(marker?.stage).toBe("fetch-prs");
        expect(marker?.message).toMatch(/rate limit/);
        expect(marker?.ts).toBeTruthy();
        expect(prepFailurePath(dir)).toBe(path.join(dir, PREP_FAILURE_FILE));
    });

    it("returns null when no marker is present", () => {
        expect(readPrepFailure(dir)).toBeNull();
    });

    it("clearPrepFailure removes a stale marker and is a no-op when absent", () => {
        writePrepFailure(dir, {
            kind: "transient",
            stage: "preflight",
            message: "budget preflight shortfall",
        });
        expect(readPrepFailure(dir)).not.toBeNull();
        clearPrepFailure(dir);
        expect(readPrepFailure(dir)).toBeNull();
        // second clear must not throw.
        expect(() => {
            clearPrepFailure(dir);
        }).not.toThrow();
    });

    it("rejects an unknown failure kind (strict schema)", () => {
        fs.writeFileSync(
            prepFailurePath(dir),
            JSON.stringify({
                kind: "flaky",
                stage: "fetch-prs",
                message: "x",
                ts: "2026-05-20T00:00:00Z",
            }),
        );
        expect(() => readPrepFailure(dir)).toThrow();
    });
});
