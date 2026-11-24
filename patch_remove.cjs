const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// In executeRollback
code = code.replace(
  /removePendingSale\(pending\.transactionId\);\s*return true;/g,
  `const removed = removePendingSale(pending.transactionId);\n      if (!removed) console.warn('Failed to remove rolled_back pending sale:', pending.transactionId);\n      return true;`
);

// In resumePendingSales (lines ~ 587)
code = code.replace(
  /removePendingSale\(transactionId\);\s*continue;/g,
  `const removed = removePendingSale(transactionId);\n          if (!removed) console.warn('Failed to remove pending sale:', transactionId);\n          continue;`
);

// In handleFinalizeInvoice (lines ~ 3761)
code = code.replace(
  /removePendingSale\(transactionId\);/g,
  `const removed = removePendingSale(transactionId);\n        if (!removed) console.warn('Failed to verify deletion of pending sale', transactionId);`
);

fs.writeFileSync('src/App.tsx', code);
