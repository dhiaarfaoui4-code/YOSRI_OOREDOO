const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetFunction = `  const handleExecuteDebtPayment = async (params: {
    target: PayDebtModalTarget;
    amount: number;
    destination: 'drawer' | 'manager';
    notes?: string;
  }) => {
    const { target, amount: payAmount, destination } = params;
    if (payAmount <= 0) return;
    const isToManager = destination === 'manager';

    if (target.type === 'single' && target.debt) {
      const debt = debts.find(d => d.id === target.debt!.id) || target.debt;
      const remaining = Math.max(0, debt.amount - debt.paid);
      const actualPayAmount = Math.min(payAmount, remaining);

      // Calculate accurate profit portion for the payment based on historical debt line buy costs
      let totalDebtCost = 0;
      if (debt.lines) {
        for (const line of debt.lines) {
          if (line.type === 'item') {
            const historicalBuy = typeof line.unitBuy === 'number'
              ? line.unitBuy
              : (line.itemId ? (items.find(i => i.id === line.itemId)?.buy || 0) : 0);
            totalDebtCost += historicalBuy * (line.qty || 1);
          }
        }
      }
      const totalDebtAmount = debt.amount || 1;
      const profitMarginRatio = Math.max(0, (totalDebtAmount - totalDebtCost) / totalDebtAmount);
      const profitCommission = actualPayAmount * profitMarginRatio;

      const incomeEntry: OtherIncome = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        category: 'debt_payment',
        label: \`خلاص دين \${isToManager ? '(لجيب المدير)' : '(بالكاسة)'} - \${debt.customerName} (\${debt.note || ''})\`,
        amount: actualPayAmount,
        commission: profitCommission,
        date: new Date().toISOString(),
        debtId: debt.id,
        destination: destination
      };

      const updatedDebt: Debt = {
        ...debt,
        paid: debt.paid + actualPayAmount,
        status: (debt.paid + actualPayAmount >= debt.amount - 0.001) ? 'paid' : 'open'
      };

      // Optimistic local state update
      setDebts(prev => prev.map(d => d.id === debt.id ? updatedDebt : d));
      setOtherIncome(prev => [incomeEntry, ...prev]);

      const payOpId = \`pay_\${incomeEntry.id}\`;
      const pendingPayment: PendingDebtPayment = {
        id: payOpId,
        createdAt: Date.now(),
        debtId: debt.id,
        payAmount: actualPayAmount,
        incomeId: incomeEntry.id,
        incomeEntry: incomeEntry,
        updatedDebtStatus: updatedDebt.status,
        status: 'created'
      };

      const persistOk = savePendingDebtPayment(pendingPayment);
      if (!persistOk) {
        return triggerToast('❌ فشل حفظ قيد العملية محلياً، تم إيقاف الدفع');
      }

      if (!trySavePendingDebtPayment(pendingPayment, 'debt_in_progress')) return;
      
      const res1 = await safeIncrementDebtPaid(debt.id, actualPayAmount, 6, payOpId, debt.id);

      if (res1.reason === 'not_found') {
        // Debt was deleted on the server. Do not create income or phantom debt!
        setDebts(prev => prev.filter(d => d.id !== debt.id));
        setOtherIncome(prev => prev.filter(o => o.id !== incomeEntry.id));
        trySavePendingDebtPayment(pendingPayment, 'completed');
        removePendingDebtPayment(payOpId);
        triggerToast('❌ هذا الدين لم يعد موجوداً بالمخزن السحابي (قد تم حذفه مسبقاً)');
        loadAllData();
        return;
      }

      if (res1.success && !res1.pending) {
        if (!trySavePendingDebtPayment(pendingPayment, 'debt_completed')) return;
      }

      if (!trySavePendingDebtPayment(pendingPayment, 'income_in_progress')) return;
      
      await patchWithOutbox(\`/debts/\${debt.id}.json\`, { status: updatedDebt.status }, undefined, debt.id);
      const ok2 = await putWithOutbox(\`/otherIncome/\${incomeEntry.id}.json\`, incomeEntry, incomeEntry.id, debt.id);

      if (ok2.success && !ok2.pending) {
        if (trySavePendingDebtPayment(pendingPayment, 'completed')) {
          removePendingDebtPayment(payOpId);
        }
      }

      if (res1.success && ok2.success) {
        triggerToast(
          isToManager
            ? \`💼 تم سداد \${actualPayAmount.toFixed(3)} د.ت لجيب المدير (خارج كاسة الوردية)\`
            : updatedDebt.status === 'paid' ? '🎉 تم سداد الدين بالكامل في الكاسة!' : \`✅ تم تسجيل دفعة \${actualPayAmount.toFixed(3)} د.ت بالكاسة\`
        );
        logAudit('sale', \`تسديد دين \${debt.customerName}: \${actualPayAmount.toFixed(3)} د.ت [\الوجهة: \${isToManager ? 'جيب المدير خارج الكاسة' : 'صندوق الكاسة'}]\`);
        loadAllData();
      }
    } else if (target.type === 'group' && target.group) {
      const group = target.group;
      let remainingToDistribute = payAmount;
      const updatedDebtsToSave: Debt[] = [];
      const incomeEntriesToSave: OtherIncome[] = [];

      // Sort open debts oldest first
      const sortedOpen = [...group.openDebts].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (const debt of sortedOpen) {
        if (remainingToDistribute <= 0.0001) break;

        const debtRemaining = Math.max(0, debt.amount - debt.paid);
        const payForThisDebt = Math.min(debtRemaining, remainingToDistribute);

        if (payForThisDebt > 0) {
          remainingToDistribute -= payForThisDebt;

          // Calculate profit margin ratio using historical debt line unitBuy
          let totalDebtCost = 0;
          if (debt.lines) {
            for (const line of debt.lines) {
              if (line.type === 'item') {
                const historicalBuy = typeof line.unitBuy === 'number'
                  ? line.unitBuy
                  : (line.itemId ? (items.find(i => i.id === line.itemId)?.buy || 0) : 0);
                totalDebtCost += historicalBuy * (line.qty || 1);
              }
            }
          }
          const totalDebtAmount = debt.amount || 1;
          const profitMarginRatio = Math.max(0, (totalDebtAmount - totalDebtCost) / totalDebtAmount);
          const profitCommission = payForThisDebt * profitMarginRatio;

          const incomeEntry: OtherIncome = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.floor(Math.random() * 100),
            category: 'debt_payment',
            label: \`خلاص دين \${isToManager ? '(لجيب المدير)' : '(بالكاسة)'} - \${group.canonicalName} (\${debt.note || 'دين'})\`,
            amount: payForThisDebt,
            commission: profitCommission,
            date: new Date().toISOString(),
            debtId: debt.id,
            destination: destination
          };

          const updatedDebt: Debt = {
            ...debt,
            paid: debt.paid + payForThisDebt,
            status: (debt.paid + payForThisDebt >= debt.amount - 0.001) ? 'paid' : 'open'
          };

          updatedDebtsToSave.push(updatedDebt);
          incomeEntriesToSave.push(incomeEntry);
        }
      }

      if (updatedDebtsToSave.length === 0) return;

      const pendingPayments: PendingDebtPayment[] = [];
      for (let i = 0; i < updatedDebtsToSave.length; i++) {
        const d = updatedDebtsToSave[i];
        const inc = incomeEntriesToSave[i];
        const originalDebt = debts.find(x => x.id === d.id);
        const originalPaid = originalDebt ? originalDebt.paid : 0;
        const payDelta = d.paid - originalPaid;
        const payOpId = \`pay_\${inc.id}\`;
        
        const pendingPayment: PendingDebtPayment = {
          id: payOpId,
          createdAt: Date.now(),
          debtId: d.id,
          payAmount: payDelta,
          incomeId: inc.id,
          incomeEntry: inc,
          updatedDebtStatus: d.status,
          status: 'created'
        };
        const ok = savePendingDebtPayment(pendingPayment);
        if (ok) {
           pendingPayments.push(pendingPayment);
        }
      }

      // Optimistically update debts and otherIncome in state
      setDebts(prev => {
        const map = new Map(updatedDebtsToSave.map(d => [d.id, d]));
        return prev.map(d => map.get(d.id) || d);
      });
      setOtherIncome(prev => [...incomeEntriesToSave, ...prev]);

      // Persist each with dependency on debt.id
      for (const pendingPayment of pendingPayments) {
        if (!trySavePendingDebtPayment(pendingPayment, 'debt_in_progress')) continue;
        
        const res = await safeIncrementDebtPaid(pendingPayment.debtId, pendingPayment.payAmount, 6, pendingPayment.id, pendingPayment.debtId);
        
        if (res.reason === 'not_found') {
          // Skip updating status and income for deleted debt
          setDebts(prev => prev.filter(x => x.id !== pendingPayment.debtId));
          trySavePendingDebtPayment(pendingPayment, 'completed');
          removePendingDebtPayment(pendingPayment.id);
          continue;
        }

        if (res.success && !res.pending) {
          if (!trySavePendingDebtPayment(pendingPayment, 'debt_completed')) continue;
        }

        if (!trySavePendingDebtPayment(pendingPayment, 'income_in_progress')) continue;

        await patchWithOutbox(\`/debts/\${pendingPayment.debtId}.json\`, { status: pendingPayment.updatedDebtStatus }, undefined, pendingPayment.debtId);
        const ok2 = await putWithOutbox(\`/otherIncome/\${pendingPayment.incomeId}.json\`, pendingPayment.incomeEntry, pendingPayment.incomeId, pendingPayment.debtId);

        if (ok2.success && !ok2.pending) {
          if (trySavePendingDebtPayment(pendingPayment, 'completed')) {
            removePendingDebtPayment(pendingPayment.id);
          }
        }
      }

      triggerToast(
        isToManager
          ? \`💼 تم سداد \${payAmount.toFixed(3)} د.ت لجيب المدير وتوزيعها على ديون "\${group.canonicalName}" (خارج الكاسة)\`
          : \`🎉 تم تسجيل دفعة \${payAmount.toFixed(3)} د.ت بالكاسة وتوزيعها على ديون "\${group.canonicalName}" بنجاح!\`
      );
      logAudit('sale', \`تسديد جماعي لديون الحريف \${group.canonicalName}: \${payAmount.toFixed(3)} د.ت على \${updatedDebtsToSave.length} دين [\الوجهة: \${isToManager ? 'جيب المدير خارج الكاسة' : 'صندوق الكاسة'}]\`);
      loadAllData();
    }
  };`;

const startIndex = code.indexOf('const handleExecuteDebtPayment = async (params: {');
const endFuncRegex = /\n  const handleDeleteDebt = async/g;
endFuncRegex.lastIndex = startIndex;
const match = endFuncRegex.exec(code);

if (startIndex !== -1 && match) {
  const endIndex = match.index;
  code = code.substring(0, startIndex) + targetFunction + code.substring(endIndex);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Replaced handleExecuteDebtPayment');
} else {
  console.log('Could not find handleExecuteDebtPayment properly');
}
