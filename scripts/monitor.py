#!/usr/bin/env python3
import subprocess
import time
import glob

def count_successes():
    total = 0
    for log in glob.glob('/tmp/hacker*.log'):
        try:
            with open(log) as f:
                total += f.read().count('✓')
        except:
            pass
    return total

def count_processes():
    result = subprocess.run(['pgrep', '-c', '-f', 'hacker_mode.py'], capture_output=True, text=True)
    return int(result.stdout.strip()) if result.stdout.strip() else 0

print("=== VOYO UPLOAD MONITOR ===")
print(f"Processes running: {count_processes()}")
start = count_successes()
print(f"Starting count: {start}")
print("Measuring for 60 seconds...")
time.sleep(60)
end = count_successes()
print(f"Ending count: {end}")
print(f"Added: {end - start} tracks in 60 seconds")
print(f"Rate: {(end - start)} tracks/minute")
print(f"Estimated R2 objects added: {(end - start) * 2}/min (2 quality tiers)")
