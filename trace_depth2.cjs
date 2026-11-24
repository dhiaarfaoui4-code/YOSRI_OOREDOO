const fs = require('fs');
const code = fs.readFileSync('src/App.tsx', 'utf8');
const lines = code.split('\n');
let depth = 0;
for(let i=0; i<lines.length; i++) {
   for(let char of lines[i]) {
      if (char === '{') depth++;
      if (char === '}') depth--;
   }
   if (i === 3174) {
       console.log('Line 3175 Depth:', depth);
   }
   if (i === 3175) {
       console.log('Line 3176 Depth:', depth);
   }
}
