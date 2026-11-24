const fs = require('fs');
let lines = fs.readFileSync('src/App.tsx', 'utf8').split('\n');

for(let i=0; i<lines.length; i++) {
  if (lines[i].includes('await resumePendingDebtPayments()') || lines[i].includes('resumePendingDebtPayments()')) {
    if (lines[i+1] && lines[i+1].includes('resumePendingDebtPayments()')) {
      lines.splice(i+1, 1);
    }
  }
}

// I see around line 858: resumePendingSales(); I need to make sure resumePendingDebtPayments(); is before it.
let hasResumeDebtInInterval = false;
for(let i=0; i<lines.length; i++) {
  if (lines[i].includes('const interval = setInterval(() => {')) {
    if (lines[i+1].includes('resumePendingDebtPayments();') || lines[i+2].includes('resumePendingDebtPayments();')) {
      hasResumeDebtInInterval = true;
    }
    if (!hasResumeDebtInInterval) {
       lines.splice(i+1, 0, '      resumePendingDebtPayments();');
    }
  }
}
fs.writeFileSync('src/App.tsx', lines.join('\n'));
