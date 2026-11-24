const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /if \(stepRes\.success && !stepRes\.pending\) \{\s*step\.status = 'completed';\s*savePendingSale\(pending\);\s*\}/g,
  `if (stepRes.success && !stepRes.pending) {
                  if (!trySavePendingSaleStep(pending, step, 'completed')) { stockAllOk = false; break; }
                }`
);

// pending.status = 'stock_completed';
// savePendingSale(pending);
code = code.replace(
  /pending\.status = 'stock_completed';\s*savePendingSale\(pending\);/g,
  "if (!trySavePendingSale(pending, 'stock_completed')) continue;"
);

// pending.status = 'records_in_progress';
// savePendingSale(pending);
code = code.replace(
  /pending\.status = 'records_in_progress';\s*savePendingSale\(pending\);/g,
  "if (!trySavePendingSale(pending, 'records_in_progress')) continue;"
);

// pending.status = 'completed';
// savePendingSale(pending);
code = code.replace(
  /pending\.status = 'completed';\s*savePendingSale\(pending\);/g,
  "if (!trySavePendingSale(pending, 'completed')) continue;"
);

fs.writeFileSync('src/App.tsx', code);
