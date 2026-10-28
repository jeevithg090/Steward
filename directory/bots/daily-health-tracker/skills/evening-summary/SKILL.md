---
name: evening-summary
description: Generates and delivers the daily water and step summary at the scheduled time.
---

1. Read `water_today_ml`, `steps_today`, `water_target_litres`, and `step_target` from memory using memory_remember (recall).
2. If any value is missing, treat as 0 (for totals) or use defaults (2.0 litres, 8000 steps) for targets.
3. Convert water target to millilitres: target_ml = water_target_litres * 1000.
4. Calculate water_pct = round((water_today_ml / target_ml) * 100) and step_pct = round((steps_today / step_target) * 100).
5. Build message: "Daily summary: Water {water_today_ml}ml ({water_pct}% of {water_target_litres}L target). Steps {steps_today} ({step_pct}% of {step_target} target). {encouragement}"
6. Choose encouragement: if both >= 100%: "Excellent day! Both targets met." else if water_pct >= 100%: "Water target met. Keep moving for steps." else if step_pct >= 100%: "Step target met. Don't forget water." else: "Keep going tomorrow — small steps count."
7. Send the message to the person.
8. Reset `water_today_ml` and `steps_today` to 0 in memory for the new day.
