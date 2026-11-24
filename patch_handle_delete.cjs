const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetFunction = `  const handleDeleteDebt = async (id: string) => {
    const debt = debts.find(d => d.id === id);
    if (!debt) return;
    if (!await promptAndVerifyPin(\`هل ترغب بحذف ملف دين الحريف "\${debt.customerName}" نهائياً؟\`)) return;

    // 1. Rollback items, recharge cards, and forfait balances to inventory/balances
    const itemIncrements: Record<string, number> = {};
    const cardIncrements: Record<string, { entry: CardStockEntry; totalQty: number }> = {};
    const forfaitIncrements: Record<string, number> = {};
    let photoIncrement = 0;

    if (debt.lines) {
      for (const line of debt.lines) {
        if (line.type === 'item' && line.itemId) {
          itemIncrements[line.itemId] = (itemIncrements[line.itemId] || 0) + line.qty;
        }
        if (line.type === 'recharge' && line.cardOperator && line.cardValue) {
          const normOp = normalizeOpName(line.cardOperator);
          const normVal = String(line.cardValue).trim();
          let card = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
          if (!card) {
            card = {
              id: \`std_card_\${normOp.replace(/\\s+/g, '')}_\${normVal}\`,
              kind: 'recharge',
              operator: normOp,
              value: normVal,
              qty: 0
            };
          }
          if (!cardIncrements[card.id]) {
            cardIncrements[card.id] = { entry: card, totalQty: 0 };
          }
          cardIncrements[card.id].totalQty += (line.qty || 1);
        }
        if (line.type === 'forfait' && line.cardOperator) {
          let opKey = line.cardOperator;
          if (opKey === 'Ooredoo 1005' || opKey === 'Ooredoo_1005') {
            opKey = 'Ooredoo_1005';
          } else if (opKey === 'Ooredoo 1006' || opKey === 'Ooredoo_1006') {
            opKey = 'Ooredoo_1006';
          } else if (opKey === 'Ooredoo') {
            opKey = 'Ooredoo_1005';
          }
          forfaitIncrements[opKey] = (forfaitIncrements[opKey] || 0) + (line.total || 0);
        }
        if (line.type === 'photo') {
          photoIncrement += (line.qty || 1);
        }
      }
    }

    const stockSteps: PendingStockStep[] = [];
    for (const itemId of Object.keys(itemIncrements)) {
      stockSteps.push({
        kind: 'item',
        targetId: itemId,
        qty: itemIncrements[itemId],
        opId: \`revert_inv_item_\${id}_\${itemId}\`,
        revertOpId: '',
        status: 'pending'
      });
    }
    for (const cardId of Object.keys(cardIncrements)) {
      const { totalQty } = cardIncrements[cardId];
      stockSteps.push({
        kind: 'card',
        targetId: cardId,
        qty: totalQty,
        opId: \`revert_inv_card_\${id}_\${cardId}\`,
        revertOpId: '',
        status: 'pending'
      });
    }
    for (const opKey of Object.keys(forfaitIncrements)) {
      stockSteps.push({
        kind: 'forfait',
        targetId: opKey,
        qty: forfaitIncrements[opKey],
        opId: \`revert_inv_forfait_\${id}_\${opKey}\`,
        revertOpId: '',
        status: 'pending'
      });
    }
    if (photoIncrement > 0) {
      stockSteps.push({
        kind: 'photo',
        targetId: 'photo',
        qty: photoIncrement,
        opId: \`revert_inv_photo_\${id}\`,
        revertOpId: '',
        status: 'pending'
      });
    }

    const relatedIncomes = otherIncome.filter(o => o.debtId === id);
    const incomeIdsToDelete = relatedIncomes.map(inc => inc.id);

    const pendingDelOpId = \`del_debt_\${id}\`;
    const pendingDel: PendingDeleteDebt = {
      id: pendingDelOpId,
      createdAt: Date.now(),
      debtId: id,
      stockSteps,
      incomeIdsToDelete,
      status: 'created'
    };

    const persistOk = savePendingDeleteDebt(pendingDel);
    if (!persistOk) {
      return triggerToast('❌ فشل حفظ قيد الحذف محلياً، تم إيقاف العملية');
    }

    // Optimistically update React state immediately
    setDebts(prev => prev.filter(d => d.id !== id));
    setOtherIncome(prev => prev.filter(o => o.debtId !== id));

    if (Object.keys(itemIncrements).length > 0) {
      setItems(prevItems => prevItems.map(item => {
        const inc = itemIncrements[item.id];
        return inc ? { ...item, qty: item.qty + inc } : item;
      }));
    }

    if (Object.keys(cardIncrements).length > 0) {
      setCardStock(prevCards => prevCards.map(card => {
        const inc = cardIncrements[card.id];
        return inc ? { ...card, qty: card.qty + inc.totalQty } : card;
      }));
    }

    if (Object.keys(forfaitIncrements).length > 0) {
      setForfaitBalance(prev => {
        const next = { ...prev };
        for (const opKey of Object.keys(forfaitIncrements)) {
          if (next[opKey] !== undefined) {
            next[opKey] += forfaitIncrements[opKey];
          }
        }
        return next;
      });
    }
    if (photoIncrement > 0) {
      setPhotoPaperStock(prev => prev + photoIncrement);
    }

    if (!trySavePendingDeleteDebt(pendingDel, 'stock_rollback_in_progress')) return;

    let allStockCompleted = true;
    for (const step of pendingDel.stockSteps) {
      let res;
      if (step.kind === 'item') {
        res = await safeIncrementItemQty(step.targetId, step.qty, undefined, 6, step.opId);
      } else if (step.kind === 'card') {
        res = await safeIncrementCardQty(step.targetId, step.qty, undefined, 6, step.opId);
      } else if (step.kind === 'forfait') {
        res = await safeIncrementForfait({ [step.targetId]: step.qty }, 6, step.opId);
      } else if (step.kind === 'photo') {
        res = await safeIncrementPhotoStock(step.qty, undefined, 6, step.opId);
      }

      if (res && res.success && !res.pending) {
        step.status = 'completed';
        savePendingDeleteDebt(pendingDel);
      } else {
        allStockCompleted = false;
      }
    }

    if (allStockCompleted) {
      if (!trySavePendingDeleteDebt(pendingDel, 'stock_rollback_completed')) return;
    }

    if (pendingDel.status === 'stock_rollback_completed') {
      if (!trySavePendingDeleteDebt(pendingDel, 'income_delete_in_progress')) return;
    }

    if (pendingDel.status === 'income_delete_in_progress') {
      let allIncomeDeleted = true;
      for (const incomeId of pendingDel.incomeIdsToDelete) {
        const res = await putWithOutbox(\`/otherIncome/\${incomeId}.json\`, null);
        if (!res.success || res.pending) {
          allIncomeDeleted = false;
        }
      }
      if (allIncomeDeleted) {
         if (!trySavePendingDeleteDebt(pendingDel, 'debt_delete_in_progress')) return;
      }
    }

    if (pendingDel.status === 'debt_delete_in_progress') {
      const ok = await putWithOutbox(\`/debts/\${id}.json\`, null);
      if (ok.success && !ok.pending) {
        if (trySavePendingDeleteDebt(pendingDel, 'completed')) {
          removePendingDeleteDebt(pendingDel.id);
        }
      }
      
      triggerToast('✅ تم حذف الدين واسترجاع المشتريات للمخزن');
      logAudit('delete', \`حذف دين الحريف \${debt.customerName} بقيمة \${debt.amount.toFixed(3)} د.ت واسترجاع المشتريات للمخزون\`);
      loadAllData();
    }
  };`;

const startIndex = code.indexOf('  const handleDeleteDebt = async (id: string) => {');
const endFuncRegex = /\n  const handleDeleteHistorySale = async/g;
endFuncRegex.lastIndex = startIndex;
const match = endFuncRegex.exec(code);

if (startIndex !== -1 && match) {
  const endIndex = match.index;
  code = code.substring(0, startIndex) + targetFunction + code.substring(endIndex);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Replaced handleDeleteDebt');
} else {
  console.log('Could not find handleDeleteDebt properly');
}
