const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
let depth = 0;
let minDepth = 1000;
for (let i=0; i<code.length; i++) {
  if (code[i] === '{') depth++;
  if (code[i] === '}') depth--;
  if (depth < minDepth) minDepth = depth;
}
console.log('Final depth:', depth, 'Min depth:', minDepth);
