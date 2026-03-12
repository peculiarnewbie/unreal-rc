# Unreal Fixture

This repository supports two ways to provide the Unreal fixture project used by Unreal-backed tests:

1. default fixture path at `fixtures/unreal-project`
2. custom path via `UNREAL_FIXTURE_DIR`

The runtime resolution order is:

1. `UNREAL_FIXTURE_DIR` if set
2. `fixtures/unreal-project`

## Maintainer Flow

Reserve `fixtures/unreal-project` for the fixture repo submodule:

```bash
git submodule add <fixture-repo-url> fixtures/unreal-project
git commit -m "Add Unreal fixture submodule"
```

After the submodule exists, contributors can provision it with:

```bash
bun run fixture:init
```

To update the pinned fixture revision later:

```bash
cd fixtures/unreal-project
git pull origin main
cd ../..
git add fixtures/unreal-project
git commit -m "Update Unreal fixture"
```

## Contributor Flow

Fresh clone with submodules:

```bash
git clone --recurse-submodules <repo-url>
```

Existing clone:

```bash
git submodule update --init --recursive
```

Repo helper command:

```bash
bun run fixture:init
```

Check what fixture the repo will use:

```bash
bun run fixture:status
```

Run Unreal-backed tests once they exist:

```bash
bun run test:e2e
```

## Custom Path Flow

If you already have a local Unreal project outside this repository, point the test harness at it:

```bash
UNREAL_FIXTURE_DIR=/abs/path/to/project bun run fixture:status
UNREAL_FIXTURE_DIR=/abs/path/to/project bun run test:e2e
```

The custom path must point at a project root containing exactly one `.uproject` file at the top level.
