"""Make the standalone API importable without installing or starting services."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The Flask frontend imports its sibling security module.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
