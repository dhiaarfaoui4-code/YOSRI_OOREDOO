const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "await resumePendingDebtPayments();\n      await resumePendingDebtPayments();\n      await resumePendingSales();",
  "await resumePendingDebtPayments();\n      await resumePendingSales();"
);
code = code.replace(
  "resumePendingDebtPayments();\n      resumePendingDebtPayments();\n      resumePendingSales();",
  "resumePendingDebtPayments();\n      resumePendingSales();"
);
fs.writeFileSync('src/App.tsx', code);
