const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "await resumePendingSales();",
  "await resumePendingDebtPayments();\n      await resumePendingSales();"
);

code = code.replace(
  "resumePendingSales();",
  "resumePendingDebtPayments();\n      resumePendingSales();"
);

fs.writeFileSync('src/App.tsx', code);
