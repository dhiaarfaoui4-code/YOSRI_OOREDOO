const fs = require('fs');
let code = fs.readFileSync('patch_handle_delete.cjs', 'utf8');
let t = code.split('targetFunction = `')[1].split('`;')[0];
let depth = 0;
let lines = t.split('\n');
for (let i=0; i<lines.length; i++) {
  for(let char of lines[i]) {
     if (char === '{') depth++;
     if (char === '}') depth--;
  }
  console.log(i+1, depth, lines[i]);
}
