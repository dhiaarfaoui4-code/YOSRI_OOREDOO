const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
let depth = 0;
let lines = code.split('\n');
for (let i=0; i<lines.length; i++) {
  for(let char of lines[i]) {
     if (char === '{') depth++;
     if (char === '}') depth--;
  }
  if (lines[i].includes('const handleDeleteHistorySale = async (id: string, isSaleRecord: boolean) => {')) {
     console.log('Depth at handleDeleteHistorySale:', depth);
     break;
  }
}
