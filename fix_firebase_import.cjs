const fs = require('fs');
let code = fs.readFileSync('src/firebase.ts', 'utf8');

const regex = /import \{([^\}]+)\} from '\.\/types';/;
code = code.replace(regex, (match, p1) => {
  return "import {" + p1 + ", PendingDeleteHistorySale } from './types';";
});

fs.writeFileSync('src/firebase.ts', code);
console.log('Fixed firebase imports');
