const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /step\.status = 'completed';\s+savePendingSale\(pending\);/g,
  "if (!trySavePendingSaleStep(pending, step, 'completed')) { stockAllOk = false; break; }"
);

// We need to be careful with step.status = 'failed'; because there are lines after it.
// e.g. 
// step.status = 'failed';
// stockAllOk = false;
// if (stepRes.reason === 'insufficient') {
//   pending.status = 'rollback_in_progress';
//   savePendingSale(pending);
//   await executeRollback(pending);
//   break;
// }
// break;
