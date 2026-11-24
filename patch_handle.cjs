const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// durablePendingSale.status = 'stock_in_progress';
// savePendingSale(durablePendingSale);
code = code.replace(
  /durablePendingSale\.status = 'stock_in_progress';\s*savePendingSale\(durablePendingSale\);/g,
  `if (!trySavePendingSale(durablePendingSale, 'stock_in_progress')) {
      setIsFinalizing(false);
      return triggerToast('❌ فشل حفظ الحالة (stock_in_progress) في التخزين الدائم');
    }`
);

// step.status = 'completed';
// savePendingSale(durablePendingSale);
code = code.replace(
  /step\.status = 'completed';\s*savePendingSale\(durablePendingSale\);/g,
  `if (!trySavePendingSaleStep(durablePendingSale, step, 'completed')) {
              setIsFinalizing(false);
              return triggerToast('❌ فشل حفظ خطوة السلعة في التخزين الدائم');
            }`
);

// durablePendingSale.status = 'rollback_in_progress';
// savePendingSale(durablePendingSale);
code = code.replace(
  /durablePendingSale\.status = 'rollback_in_progress';\s*savePendingSale\(durablePendingSale\);/g,
  "trySavePendingSale(durablePendingSale, 'rollback_in_progress');"
);

// durablePendingSale.status = 'stock_completed';
// savePendingSale(durablePendingSale);
code = code.replace(
  /durablePendingSale\.status = 'stock_completed';\s*savePendingSale\(durablePendingSale\);/g,
  `if (!trySavePendingSale(durablePendingSale, 'stock_completed')) {
        setIsFinalizing(false);
        return triggerToast('❌ فشل حفظ الحالة (stock_completed) في التخزين الدائم');
      }`
);

// durablePendingSale.status = 'records_in_progress';
// savePendingSale(durablePendingSale);
code = code.replace(
  /durablePendingSale\.status = 'records_in_progress';\s*savePendingSale\(durablePendingSale\);/g,
  `if (!trySavePendingSale(durablePendingSale, 'records_in_progress')) {
        setIsFinalizing(false);
        return triggerToast('❌ فشل حفظ الحالة (records_in_progress) في التخزين الدائم');
      }`
);

// durablePendingSale.status = 'completed';
// savePendingSale(durablePendingSale);
code = code.replace(
  /durablePendingSale\.status = 'completed';\s*savePendingSale\(durablePendingSale\);/g,
  `if (!trySavePendingSale(durablePendingSale, 'completed')) {
          setIsFinalizing(false);
          return triggerToast('❌ فشل حفظ الحالة (completed) في التخزين الدائم');
        }`
);

fs.writeFileSync('src/App.tsx', code);
