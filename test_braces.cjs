const fs = require('fs');
let code = fs.readFileSync('patch_handle_delete.cjs', 'utf8');
let t = code.split('targetFunction = `')[1].split('`;')[0];
let depth = 0;
for (let i=0; i<t.length; i++) {
  if (t[i] === '{') depth++;
  if (t[i] === '}') depth--;
}
console.log('Final depth of targetFunction:', depth);
