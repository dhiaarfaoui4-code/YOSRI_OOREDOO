const fs = require('fs');
const content = fs.readFileSync('vite_app.js', 'utf8');
const match = content.match(/sourceMappingURL=data:application\/json;base64,(.*)$/);
if (match) {
  const jsonStr = Buffer.from(match[1], 'base64').toString('utf8');
  const sm = JSON.parse(jsonStr);
  if (sm.sourcesContent && sm.sourcesContent[0]) {
    fs.writeFileSync('recovered_App.tsx', sm.sourcesContent[0]);
    console.log('Successfully recovered original App.tsx! Size:', sm.sourcesContent[0].length);
  } else {
    console.log('No sourcesContent found');
  }
} else {
  console.log('No sourcemap found');
}
