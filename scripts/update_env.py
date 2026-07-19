#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: update_env.py PATH KEY VALUE")
    path, key, value = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    replacement = f"{key}={value}"
    output = []
    found = False
    for line in lines:
        if line.startswith(f"{key}="):
            output.append(replacement)
            found = True
        else:
            output.append(line)
    if not found:
        if output and output[-1]:
            output.append("")
        output.append(replacement)
    path.write_text("\n".join(output) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
