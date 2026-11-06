"""Independent check: open the L5X with the open-source `l5x` library (pip install l5x).

    python tools/check_l5x.py LS01_LiftStation.L5X
"""
import sys
import l5x

prj = l5x.Project(sys.argv[1] if len(sys.argv) > 1 else "LS01_LiftStation.L5X")
tags = prj.controller.tags
print("controller tags:", len(tags.names))
print("programs:", prj.programs.names)
print("P1.FTS_Tmr.PRE:", tags["P1"]["FTS_Tmr"]["PRE"].value, "| LT101_FltTmr.PRE:", tags["LT101_FltTmr"]["PRE"].value)
print("SP_LeadOn:", tags["SP_LeadOn"].value, "| P1.HOA_Auto (UDT BOOL member):", tags["P1"]["HOA_Auto"].value)
print("LT101_Pct description:", tags["LT101_Pct"].description)
