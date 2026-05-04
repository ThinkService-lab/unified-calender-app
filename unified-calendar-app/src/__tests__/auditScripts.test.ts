/**
 * Guards the supply-chain audit contract wired by CI.
 *
 * Security Review 2026-05-02 Finding M7 closed the CI gap by introducing
 * `.github/workflows/npm-audit.yml` plus three npm scripts
 * (`audit:runtime`, `audit:full`, `audit:report`). These tests pin the
 * *shape* of those scripts so a later refactor cannot silently loosen
 * them (e.g. dropping `--audit-level=high`, swapping in `--audit-level=low`
 * which makes the command always succeed, or removing `--omit=dev` from
 * the runtime gate).
 *
 * We intentionally do NOT shell out to `npm audit` here — that would
 * require network access and make the test suite flaky. The workflow
 * itself runs the real audit command; this test only enforces that the
 * command is what we expect it to be.
 */

import * as fs from 'fs';
import * as path from 'path';

interface PackageJson {
  scripts?: Record<string, string>;
}

function loadPackageJson(): PackageJson {
  const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  return JSON.parse(raw) as PackageJson;
}

describe('npm audit CI gate — M7 contract', () => {
  const pkg = loadPackageJson();
  const scripts = pkg.scripts ?? {};

  describe('audit:runtime (blocking PR gate, production-only)', () => {
    const script = scripts['audit:runtime'];

    it('exists', () => {
      expect(script).toBeDefined();
    });

    it('invokes npm audit', () => {
      expect(script).toMatch(/^npm audit\b/);
    });

    it('fails the build on high or critical advisories', () => {
      // Anything laxer (moderate / low / info) silently passes today's
      // 11 moderate advisories, which defeats the gate. The review's
      // M7 remediation specifically wired a `high`-level threshold.
      expect(script).toMatch(/--audit-level=high\b/);
    });

    it('omits dev dependencies (production bundle only)', () => {
      // M7 wrote `--production`; --omit=dev is the modern, equivalent
      // flag that npm 7+ ships. Either form satisfies the intent.
      expect(script).toMatch(/--omit=dev\b|--production\b/);
    });
  });

  describe('audit:full (blocking PR gate, full dep tree)', () => {
    const script = scripts['audit:full'];

    it('exists', () => {
      expect(script).toBeDefined();
    });

    it('invokes npm audit at high level', () => {
      expect(script).toMatch(/^npm audit\b/);
      expect(script).toMatch(/--audit-level=high\b/);
    });

    it('does NOT restrict to production deps (full tree)', () => {
      // The point of this second gate is precisely to catch high-sev
      // dev-tooling advisories that --omit=dev would mask.
      expect(script).not.toMatch(/--omit=dev\b/);
      expect(script).not.toMatch(/--production\b/);
    });
  });

  describe('audit:report (weekly informational, JSON)', () => {
    const script = scripts['audit:report'];

    it('exists', () => {
      expect(script).toBeDefined();
    });

    it('emits JSON for diff-friendly artifact capture', () => {
      expect(script).toMatch(/--json\b/);
    });

    it('reports at moderate level so the weekly delta includes all advisories', () => {
      // Higher thresholds would hide the moderate advisories that M7
      // explicitly documents as the current baseline. The weekly run is
      // informational (non-blocking in the workflow) so strictness here
      // is safe.
      expect(script).toMatch(/--audit-level=moderate\b/);
    });
  });
});

describe('npm audit CI workflow — wiring presence', () => {
  it('.github/workflows/npm-audit.yml exists at the repo root', () => {
    // The workflow is the delivery mechanism for M7's CI enforcement.
    // A missing workflow would make the npm scripts above cosmetic.
    const workflowPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '.github',
      'workflows',
      'npm-audit.yml',
    );
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  it('workflow runs on push, pull_request, and a weekly schedule', () => {
    const workflowPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '.github',
      'workflows',
      'npm-audit.yml',
    );
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    // Blocking PR gate.
    expect(workflow).toMatch(/\bpull_request\b/);
    // Mainline check on merge.
    expect(workflow).toMatch(/\bpush\b/);
    // Weekly cadence (M7 explicitly called out "weekly").
    expect(workflow).toMatch(/\bschedule\b/);
    expect(workflow).toMatch(/\bcron:\s*['"][^'"]+['"]/);
  });

  it('workflow invokes the blocking audit scripts', () => {
    const workflowPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '.github',
      'workflows',
      'npm-audit.yml',
    );
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/npm run audit:runtime\b/);
    expect(workflow).toMatch(/npm run audit:full\b/);
  });
});
