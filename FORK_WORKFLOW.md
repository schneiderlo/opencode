# Fork Workflow Guide

This guide explains how to work with your forked version of opencode.

## Initial Setup (After Forking)

1. **Add upstream remote** (points to original repository):
   ```bash
   git remote add upstream https://github.com/sst/opencode.git
   ```

2. **Set origin to your fork**:
   ```bash
   git remote set-url origin https://github.com/schneiderlo/opencode.git
   ```

## Updating from Original Repository

**Instead of `git pull --rebase`, use this workflow:**

```bash
# Fetch latest changes from original repository
git fetch upstream

# Rebase your current branch onto latest upstream dev
git rebase upstream/dev

# Push updated branch to your fork
git push origin dev
```

**Or the one-liner alternative:**
```bash
git pull upstream dev --rebase && git push origin dev
```

## Contributing Back

1. **Push your changes to your fork**:
   ```bash
   git push origin dev
   ```

2. **Create a Pull Request**:
   - Go to your fork on GitHub
   - Click "Compare & pull request"
   - Target: `sst/opencode` dev branch
   - Source: your fork's dev branch

## Remote Management

**Check your remotes:**
```bash
git remote -v
```

**Expected output:**
```
origin    https://github.com/schneiderlo/opencode.git (fetch)
origin    https://github.com/schneiderlo/opencode.git (push)
upstream  https://github.com/sst/opencode.git (fetch)
upstream  https://github.com/sst/opencode.git (push)
```

## Branch Management

**Create a new feature branch:**
```bash
git checkout -b feature/my-feature
git push -u origin feature/my-feature
```

**Sync feature branch with upstream:**
```bash
git fetch upstream
git rebase upstream/dev
git push origin feature/my-feature
```

## Troubleshooting

**If you get merge conflicts during rebase:**
```bash
# Abort the rebase
git rebase --abort

# Or resolve conflicts and continue
# (edit conflicted files, then:)
git add <resolved-files>
git rebase --continue
```
