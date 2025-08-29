#!/usr/bin/env python3
"""
Update prompt codebase script - Python version

This script updates the prompt.txt file with current codebase information
and staged git changes using repomix and git diff.
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path


def run_command(command, cwd=None, check=True, capture_output=True):
    """Run a shell command and return the result."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=capture_output,
            text=True,
            check=check
        )
        return result
    except subprocess.CalledProcessError as e:
        if check:
            print(f"Error running command: {' '.join(command)}", file=sys.stderr)
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        return e


def get_workspace_dir():
    """Determine workspace directory dynamically, allowing override via env var."""
    workspace_dir = os.environ.get("WORKSPACE_DIR")

    if not workspace_dir:
        # Try to get from git
        try:
            script_dir = Path(__file__).parent
            parent_dir = script_dir.parent
            result = run_command(
                'git rev-parse --show-toplevel',
                cwd=parent_dir,
                capture_output=True
            )
            workspace_dir = result.stdout.strip()
        except:
            pass

        if not workspace_dir:
            script_dir = Path(__file__).parent.resolve()
            workspace_dir = str(script_dir.parent)

    return workspace_dir


def check_dependencies():
    """Check if required dependencies are available."""
    try:
        run_command("command -v repomix", check=False)
    except:
        print("Error: repomix not found in PATH", file=sys.stderr)
        sys.exit(1)


def ensure_prompt_file_exists(prompt_file):
    """Create prompt.txt with required tags if it doesn't exist."""
    if not os.path.exists(prompt_file):
        print("Creating new prompt.txt file with required tags")
        content = """<instructions>
</instructions>

<codebase>
</codebase>

<change_made_so_far>
</change_made_so_far>
"""
        with open(prompt_file, 'w') as f:
            f.write(content)


def ensure_tags_exist(prompt_file):
    """Ensure required tags exist in prompt.txt, add them if missing."""
    with open(prompt_file, 'r') as f:
        content = f.read()

    modified = False

    if "<instructions>" not in content:
        print("Adding missing <instructions> tag to prompt.txt")
        content += "\n<instructions>\n</instructions>\n"
        modified = True

    if "<codebase>" not in content:
        print("Adding missing <codebase> tag to prompt.txt")
        content += "\n<codebase>\n</codebase>\n"
        modified = True

    if "<change_made_so_far>" not in content:
        print("Adding missing <change_made_so_far> tag to prompt.txt")
        content += "\n<change_made_so_far>\n</change_made_so_far>\n"
        modified = True

    if modified:
        with open(prompt_file, 'w') as f:
            f.write(content)


def generate_codebase_output(output_file):
    """Generate codebase output file using repomix."""
    ignore_patterns = [
        # Specific files
        "packages/tui/internal/components/textarea/textarea.go",
        "all-local-commits.diff",
        "prompt.txt",
        "repomix-output.xml",
        "diff",
        "packages/web/src/components/icons/index.tsx",
        "cloud/web/src/ui/svg/icons.tsx",

        # Directory patterns
        "sdks/**",
        "web/**",
        "packages/script/**",
        "packages/bin/**",
        "packages/identity/**",
        "packages/function/**",
        ".github/**",
        "cloud/**",
        "github/**",
        "infra/**",
        "packages/web/**"
    ]
    ignore_pattern = ",".join(ignore_patterns)

    run_command(f'repomix --ignore "{ignore_pattern}"')


def ensure_output_file_exists(output_file):
    """Ensure output file exists and is not empty."""
    if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
        print(f"Error: expected output file not found or empty: {output_file}", file=sys.stderr)
        sys.exit(1)


def get_staged_diff(workspace_dir, diff_file):
    """Get staged git diff snapshot."""
    try:
        result = run_command(
            "git diff --staged",
            cwd=workspace_dir,
            check=False,
            capture_output=True
        )
        with open(diff_file, 'w') as f:
            f.write(result.stdout)
    except:
        # If git diff fails, create empty diff file
        Path(diff_file).touch()


def replace_content_between_tags(prompt_file, code_file, diff_file):
    """Replace content between tags in prompt.txt."""
    with open(prompt_file, 'r') as f:
        lines = f.readlines()

    with open(code_file, 'r') as f:
        code_content = f.read()

    with open(diff_file, 'r') as f:
        diff_content = f.read()

    output_lines = []
    replacing = None
    codebase_processed = False
    changes_processed = False
    i = 0

    while i < len(lines):
        line = lines[i]

        # Handle codebase tag (only process first occurrence)
        if not codebase_processed and replacing is None and "<codebase>" in line:
            output_lines.append(line)
            output_lines.append(code_content)
            if not code_content.endswith('\n'):
                output_lines.append('\n')
            replacing = "codebase"
            codebase_processed = True
            i += 1
            continue

        if replacing == "codebase":
            if "</codebase>" in line:
                output_lines.append(line)
                replacing = None
            i += 1
            continue

        # Handle change_made_so_far tag (only process first occurrence)
        if not changes_processed and replacing is None and "<change_made_so_far>" in line:
            output_lines.append(line)
            output_lines.append(diff_content)
            if not diff_content.endswith('\n'):
                output_lines.append('\n')
            replacing = "changes"
            changes_processed = True
            i += 1
            continue

        if replacing == "changes":
            if "</change_made_so_far>" in line:
                output_lines.append(line)
                replacing = None
            i += 1
            continue

        output_lines.append(line)
        i += 1

    # Write the updated content
    temp_file = prompt_file + ".tmp"
    with open(temp_file, 'w') as f:
        f.writelines(output_lines)

    shutil.move(temp_file, prompt_file)


def main():
    """Main function."""
    workspace_dir = get_workspace_dir()

    prompt_file = os.path.join(workspace_dir, "prompt.txt")
    output_file = os.path.join(workspace_dir, "repomix-output.xml")
    diff_file = os.path.join(workspace_dir, "diff")

    check_dependencies()

    ensure_prompt_file_exists(prompt_file)
    ensure_tags_exist(prompt_file)

    generate_codebase_output(output_file)
    ensure_output_file_exists(output_file)

    get_staged_diff(workspace_dir, diff_file)

    replace_content_between_tags(prompt_file, output_file, diff_file)

    print(f"Updated: {prompt_file}")


if __name__ == "__main__":
    main()
