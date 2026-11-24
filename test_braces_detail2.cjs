const fs = require('fs');
let code = fs.readFileSync('patch_handle_delete.cjs', 'utf8');
let depth = 0;
let lines = code.split('\n');
let start = false;
for (let i=0; i<lines.length; i++) {
  if (lines[i].includes('const targetFunction')) start = true;
  if (!start) continue;
  for(let char of lines[i]) {
     if (char === '{') depth++;
     if (char === '}') depth--;
  }
  console.log(i+1, depth, lines[i]);
  if (lines[i].includes('};`')) break;
}
