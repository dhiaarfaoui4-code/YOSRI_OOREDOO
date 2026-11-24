const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Fix types import
code = code.replace(
  /PendingDeleteDebtStatus(\s*)} from '\.\/types';/, 
  "PendingDeleteDebtStatus, PendingDeleteHistorySale, PendingDeleteHistorySaleStatus$1} from './types';"
);

// Fix firebase import
code = code.replace(
  /removePendingDeleteDebt(\s*)} from '\.\/firebase';/, 
  "removePendingDeleteDebt, loadPendingDeleteHistorySales, savePendingDeleteHistorySale, removePendingDeleteHistorySale$1} from './firebase';"
);

// Fix the double await issue:
code = code.replace("await resumePendingDeleteHistorySales();\n      await resumePendingDeleteHistorySales();\n      resumePendingDeleteDebts();", "await resumePendingDeleteHistorySales();\n      await resumePendingDeleteDebts();");
code = code.replace("resumePendingDeleteHistorySales();\n      resumePendingDeleteDebts();", "await resumePendingDeleteDebts();"); // We already fixed it maybe? Wait, let's just do a manual replace

fs.writeFileSync('src/App.tsx', code);

let fbCode = fs.readFileSync('src/firebase.ts', 'utf8');
fbCode = fbCode.replace(
  /PendingDeleteDebt(\s*)} from '\.\/types';/,
  "PendingDeleteDebt, PendingDeleteHistorySale$1} from './types';"
);
fs.writeFileSync('src/firebase.ts', fbCode);
console.log('Fixed imports');
