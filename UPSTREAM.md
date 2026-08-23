# Upstream workflow

`master` is the customized DeepSeek Harness version. It contains the native workspace-file attachment flow and long-image tiling.

`official` is an unmodified copy of the current `deepseek-ai/deepseek-harness` `master` branch. It is currently synchronized at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

The branches share the official `dsh-v0.1.0-rc.8` commit as their base, so upstream changes can be merged into the customized version.

## Update the official branch

In a clone of this repository, add the official remote once:

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
```

When you want the latest official code:

```sh
git fetch upstream
git switch official
git merge --ff-only upstream/master
git push origin official
```

## Bring official updates into the customized version

```sh
git switch master
git merge official
```

Resolve any conflicts in the customized attachment files, run the relevant build and tests, then push `master`.
