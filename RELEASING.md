# Releasing

One package, one number, one tag. Semver. Short bullets in `CHANGELOG.md`; the reasoning lives in
`docs/00-DECISIONS.md`.

1. **Draft the notes**: `bun run changelog:draft` writes the `feat`, `fix` and `perf` commits since
   the last release under `## Unreleased` in `CHANGELOG.md` (git-cliff, `cliff.toml`). Edit them into
   short bullets for someone installing the release: what changed, one line each, **Breaking**
   marked. No reasons — those go in `docs/00-DECISIONS.md`.
2. **Cut it** from a clean `main`:

   ```bash
   bun run release 0.2.0
   ```

   Writes the version into `packages/cli/package.json`, `packages/core/src/version.ts`, the
   lockfile and the generated API reference, dates the changelog section, runs the gate (`build`,
   `test`, `typecheck`, `lint`, `docs:check`, `verify:package`), and prints the two git commands. It commits nothing.
3. **Review the diff, commit, tag, push the tag.** The tag is what publishes.
4. **Watch the pipeline.** While the GitHub account is suspended, `.gitlab-ci.yml` does what
   `release.yml` did: publishes to npm (with provenance), builds the four standalone archives from
   the published tarball and installs one on Linux, uploads them with `SHA256SUMS` and `install.sh`
   to the package registry, creates the GitLab release (stable tags only — GitLab has no pre-release
   flag, and the installer's `latest` must never hand out a pilot), and pushes the image to Docker
   Hub. It needs two CI/CD variables, `NPM_TOKEN` and `DOCKERHUB_TOKEN`; either missing **fails the
   job by name**. The Homebrew tap is paused, and there is no macOS install check (a paid runner).
5. **Check the three installs**:

   ```bash
   npm view dispach version
   docker pull docker.io/moeenmahmud007/dispach:0.2.0
   curl -fsSL https://gitlab.com/moeen-mahmud/dispach/-/releases/permalink/latest/downloads/install.sh | sh
   ```

   `bun scripts/build-standalone.ts --targets darwin-arm64` builds one archive locally (packing the
   tree) and runs it; the archives themselves are only built by a tag pipeline.

A release that failed part-way: fix, cut the *next* patch number. npm versions are immutable, and
the workflow refuses a tag whose version the registry already serves.
