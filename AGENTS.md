# Agent Instructions - OpenCode SSH

## Release & Publish Workflow

This project uses a **manual release workflow** with CI validation. The publish to npm only happens after CI passes for the release commit.

### How It Works

1. **Push to main** → CI runs automatically (typecheck, test, build)
2. **Wait for CI to pass** ✅ (check Actions tab)
3. **Create release manually** (tag + GitHub Release)
4. **Publish workflow triggers** → validates CI passed → publishes to npm + uploads .tgz to release

### Required Steps for Release

```bash
# 1. Ensure you're on main with latest changes
git checkout main
git pull

# 2. Bump version in package.json (follows semver)
# Edit package.json version field

# 3. Sync version to other files
bun run version:sync

# 4. Commit version bump
git add -A
git commit -m "chore: bump version to X.Y.Z"
git push origin main

# 5. WAIT for CI to complete successfully on this commit
# Check: https://github.com/<owner>/<repo>/actions

# 6. Create and push tag (must match version in package.json)
git tag vX.Y.Z
git push origin vX.Y.Z

# 7. Create GitHub Release (triggers publish workflow)
gh release create vX.Y.Z --generate-notes
# Or create via GitHub UI: Releases → Create new release → select tag → Generate notes → Publish
```

### Publish Workflow Behavior

The `.github/workflows/publish.yml` workflow:
- **Triggers on**: `release: published` (manual release creation)
- **Validates**: CI workflow (`ci.yml`) passed for the exact commit tagged
- **If CI passed**: Runs typecheck, test, build → publishes to npm with provenance → uploads `.tgz` to release assets
- **If CI failed**: Blocks publish with clear error message

### Important Rules

1. **Never publish without CI passing** - the workflow enforces this automatically
2. **Tag must match package.json version** - `v2.1.3` for version `2.1.3`
3. **Run `version:sync` after version bump** - keeps `src/version.ts` and `marketplace.json` in sync
4. **Release creation is manual** - gives you control over timing and release notes
5. **Trusted Publisher (OIDC)** - no npm token needed, uses GitHub Actions OIDC

### Commands Reference

```bash
# Development
npm install          # Install dependencies (uses package-lock.json)
bun run dev          # Watch mode TypeScript compilation (if configured)
npm run typecheck    # TypeScript check
npm run test         # Run tests with bun test
npm run build        # Build (runs version:sync + tsc)
bun run version:sync # Sync package.json version to src/version.ts and marketplace.json

# Release preparation
bun run version:sync  # After editing package.json version
git add -A && git commit -m "chore: bump version to X.Y.Z"
git push origin main
# Wait for CI ✅
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```