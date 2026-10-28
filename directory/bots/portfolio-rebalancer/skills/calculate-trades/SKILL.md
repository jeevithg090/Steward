---
name: calculate-trades
description: Compute the buy and sell quantities per holding to match target allocation.
---

1. For each holding, compute market_value = quantity * price.
2. Sum market_value for total_portfolio_value.
3. Group by asset_class: sum market_value per class, divide by total for current_weight.
4. For each asset_class in targets: target_value = total_portfolio_value * target_weight.
5. For each asset_class: difference = target_value - current_value.
6. If difference > 0 (buy) or < 0 (sell): distribute across holdings in that class proportionally to each holding's current market_value within the class.
7. For each holding: trade_value = difference * (holding_market_value / class_market_value). trade_quantity = trade_value / price. Round trade_quantity to lot size (whole shares for equities, 0.01 for funds).
8. Compute new_quantity = quantity + trade_quantity.
9. Track rounding residuals per class and note them in the output.
