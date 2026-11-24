const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// We will inject helper functions
const helperCode = `
  const trySavePendingSale = (pending: PendingSale, newStatus: PendingSale['status']): boolean => {
    const old = pending.status;
    pending.status = newStatus;
    if (savePendingSale(pending)) return true;
    pending.status = old;
    return false;
  };
  const trySavePendingSaleStep = (pending: PendingSale, step: any, newStatus: string): boolean => {
    const old = step.status;
    step.status = newStatus;
    if (savePendingSale(pending)) return true;
    step.status = old;
    return false;
  };
`;
// Let's just find `const executeRollback = async (pending: PendingSale): Promise<boolean> => {` and insert before it
code = code.replace(
  "const executeRollback = async (pending: PendingSale): Promise<boolean> => {",
  helperCode + "\n  const executeRollback = async (pending: PendingSale): Promise<boolean> => {"
);

fs.writeFileSync('src/App.tsx', code);
