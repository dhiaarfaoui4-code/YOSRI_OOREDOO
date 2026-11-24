const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /pending\.status = 'rolled_back';\s+savePendingSale\(pending\);/g,
  "if (!trySavePendingSale(pending, 'rolled_back')) return false;"
);

code = code.replace(
  /pending\.status = 'rollback_in_progress';\s+savePendingSale\(pending\);/g,
  "if (!trySavePendingSale(pending, 'rollback_in_progress')) return false;"
);

code = code.replace(
  /step\.status = 'rolled_back';\s+savePendingSale\(pending\);/g,
  "if (!trySavePendingSaleStep(pending, step, 'rolled_back')) { allReversed = false; }"
);

fs.writeFileSync('src/App.tsx', code);
