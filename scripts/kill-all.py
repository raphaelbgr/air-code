#!/usr/bin/env python3
"""Kill all Claude Air dev servers using .dev-instances.json PID registry.
Falls back to port scanning if the instance file is missing/stale."""

import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTANCE_FILE = os.path.join(ROOT, ".dev-instances.json")
PORTS = [7331, 7333, 5173]


def pid_matches_name(pid: int, expected: str) -> bool:
    """Check if a PID's process image name looks like a node/tsx process."""
    try:
        out = subprocess.check_output(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
        if not out or "No tasks" in out:
            return False
        # image name is first CSV field
        image = out.split(",")[0].strip('"').lower()
        return "node" in image or "tsx" in image
    except Exception:
        return False


def kill_tree(pid: int, label: str) -> bool:
    """Kill a process and its entire tree. Returns True on success."""
    try:
        subprocess.check_call(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        print(f"  Killed PID {pid} tree ({label})")
        return True
    except subprocess.CalledProcessError:
        print(f"  Failed to kill PID {pid} ({label})")
        return False


def kill_from_instance_file() -> bool:
    """Try to kill servers using the instance file. Returns True if file existed."""
    if not os.path.isfile(INSTANCE_FILE):
        return False

    try:
        with open(INSTANCE_FILE) as f:
            instances = json.load(f)
    except (json.JSONDecodeError, IOError):
        return False

    if not instances:
        return False

    print(f"Found instance file with {len(instances)} server(s):")
    killed_any = False
    for name, info in instances.items():
        pid = info.get("pid")
        port = info.get("port")
        started = info.get("startedAt", "?")
        if not pid:
            continue
        print(f"  {name}: PID {pid}, port {port}, started {started}")
        if pid_matches_name(pid, name):
            if kill_tree(pid, name):
                killed_any = True
        else:
            print(f"  PID {pid} is not a node process (stale entry), scanning port {port}...")
            kill_by_port(port)
            killed_any = True

    # Clean up instance file
    try:
        with open(INSTANCE_FILE, "w") as f:
            f.write("{}\n")
    except IOError:
        pass

    return killed_any


def find_pid_on_port(port: int) -> int | None:
    """Find the PID listening on a port using PowerShell."""
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-NetTCPConnection -LocalPort {port} -State Listen "
             f"-ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
        if out and out != "0":
            return int(out)
    except (subprocess.CalledProcessError, ValueError):
        pass
    return None


def kill_by_port(port: int) -> None:
    """Find and kill the process listening on a port."""
    pid = find_pid_on_port(port)
    if pid:
        kill_tree(pid, f"port {port}")
    else:
        print(f"  No process on port {port}")


def main():
    print("Killing Claude Air dev servers...")

    if not kill_from_instance_file():
        print("No instance file found, scanning ports...")
        for port in PORTS:
            kill_by_port(port)

    print("Done.")


if __name__ == "__main__":
    main()
