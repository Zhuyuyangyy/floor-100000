"""Run any agent-sprite-forge tool with a Windows-safe publish.

The tools stage their output in a hidden directory and publish it with
os.rename(). On Windows that fails with WinError 5 when anything still holds a
handle inside the stage - which is what happens here, because the SVG rasteriser
and PIL have both touched files under it moments earlier. A plain rename of the
same directory works once nothing has it open, so the fix is to force a
collection, retry with backoff, and fall back to moving the children.

Usage:
    python re/run-forge.py <tool.py> [tool args...]
"""
import gc
import os
import runpy
import shutil
import sys
import time

SF = r"D:\ZYY_Inovation\game\floor-100000-claude-kit\re\_ref\spriteforge\agent-sprite-forge-0.4.0"
sys.path.insert(0, SF + r"\shared")
for sub in (r"\skills\codeart2d\scripts", r"\skills\generate2dsprite\scripts", r"\skills\generate2dmap\scripts"):
    p = SF + sub
    if os.path.isdir(p):
        sys.path.insert(0, p)
import forge_core


def rename_noreplace(source, target):
    for attempt in range(8):
        gc.collect()
        try:
            os.rename(source, target)
            return
        except PermissionError:
            if attempt == 7:
                break
            time.sleep(0.12 * (attempt + 1))
    os.mkdir(target)
    for child in sorted(os.listdir(source)):
        shutil.move(os.path.join(source, child), os.path.join(target, child))
    os.rmdir(source)


forge_core._rename_noreplace = rename_noreplace

tool = sys.argv[1]
sys.argv = [tool] + sys.argv[2:]
try:
    runpy.run_path(tool, run_name="__main__")
except SystemExit as e:
    print("exit", e.code)
