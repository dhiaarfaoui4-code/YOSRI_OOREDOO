const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace standard savePendingSale(durablePendingSale) calls with checks.
// But first, let's see how many there are.
