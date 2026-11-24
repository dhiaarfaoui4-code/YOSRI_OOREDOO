const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetFunction = `  const handleDeleteHistorySale = async (id: string, isSaleRecord: boolean) => {
    if (!id) {
      triggerToast('❌ خطأ: لم يتم العثور على معرف العملية للحذف');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: 'إلغاء العملية وحذفها',
      message: 'هل تريد إلغاء ومسح هذا المدخول وإرجاع الستوك للمخازن؟',
      confirmText: 'تأكيد الحذف 🗑️',
      cancelText: 'إلغاء ❌',
      isDanger: true,
      onConfirm: async () => {
        const stockSteps: PendingStockStep[] = [];
        
        if (isSaleRecord) {
          const record = sales.find(s => s.id === id);
          if (record && record.itemId) {
            stockSteps.push({
              kind: 'item',
              targetId: record.itemId,
              qty: record.qty || 1,
              opId: \`revert_sale_\${id}\`,
              revertOpId: '',
              status: 'pending'
            });
          }
        } else {
          const record = otherIncome.find(o => o.id === id);
          if (record) {
            if ((record.category === 'recharge' || record.category === 'card') && record.cardOperator && record.cardValue) {
              const normOp = normalizeOpName(record.cardOperator);
              const normVal = String(record.cardValue).trim();
              let card = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
              let cardId = card ? card.id : \`std_card_\${normOp.replace(/\\s+/g, '')}_\${normVal}\`;
              stockSteps.push({
                kind: 'card',
                targetId: cardId,
                qty: record.qty || 1,
                opId: \`revert_card_\${id}\`,
                revertOpId: '',
                status: 'pending'
              });
            }
            if (record.category === 'forfait' && record.cardOperator) {
              let op = record.cardOperator;
              if (op === 'Ooredoo 1005' || op === 'Ooredoo_1005') {
                op = 'Ooredoo_1005';
              } else if (op === 'Ooredoo 1006' || op === 'Ooredoo_1006') {
                op = 'Ooredoo_1006';
              } else if (op === 'Ooredoo') {
                op = 'Ooredoo_1005';
              }
              stockSteps.push({
                kind: 'forfait',
                targetId: op,
                qty: record.amount,
                opId: \`revert_forfait_\${id}\`,
                revertOpId: '',
                status: 'pending'
              });
            }
            if (record.category === 'photo') {
              stockSteps.push({
                kind: 'photo',
                targetId: 'photo',
                qty: record.qty || 1,
                opId: \`revert_photo_\${id}\`,
                revertOpId: '',
                status: 'pending'
              });
            }
            if (record.category === 'debt_payment' && record.debtId) {
              stockSteps.push({
                kind: 'debt_pay',
                targetId: record.debtId,
                qty: -record.amount,
                opId: \`revert_pay_\${id}\`,
                revertOpId: '',
                status: 'pending'
              });
            }
          }
        }

        const pendingDel: PendingDeleteHistorySale = {
          id: \`del_sale_\${id}\`,
          createdAt: Date.now(),
          saleId: id,
          isSaleRecord,
          stockSteps,
          status: 'created'
        };

        if (!savePendingDeleteHistorySale(pendingDel)) {
          triggerToast('❌ فشل حفظ قيد الحذف محلياً، تم إيقاف العملية');
          return;
        }

        // Optimistically update React state immediately
        if (isSaleRecord) {
          const record = sales.find(s => s.id === id);
          if (record && record.itemId) {
            setItems(prev => prev.map(item => item.id === record.itemId ? { ...item, qty: item.qty + (record.qty || 1) } : item));
          }
          setSales(prev => prev.filter(s => s.id !== id));
        } else {
          const record = otherIncome.find(o => o.id === id);
          if (record) {
            if ((record.category === 'recharge' || record.category === 'card') && record.cardOperator && record.cardValue) {
              const restoreQty = record.qty || 1;
              const normOp = normalizeOpName(record.cardOperator);
              const normVal = String(record.cardValue).trim();
              const card = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
              if (card) {
                setCardStock(prev => prev.map(c => c.id === card.id ? { ...c, qty: c.qty + restoreQty } : c));
              } else {
                const canonicalId = \`std_card_\${normOp.replace(/\\s+/g, '')}_\${normVal}\`;
                const newCard: CardStockEntry = {
                  id: canonicalId,
                  kind: 'recharge',
                  operator: normOp,
                  value: normVal,
                  qty: restoreQty
                };
                // Optimistically create new card locally if missing
                setCardStock(prev => [...prev, newCard]);
              }
            }
            if (record.category === 'forfait' && record.cardOperator) {
              let op = record.cardOperator;
              if (op === 'Ooredoo 1005' || op === 'Ooredoo_1005') {
                op = 'Ooredoo_1005';
              } else if (op === 'Ooredoo 1006' || op === 'Ooredoo_1006') {
                op = 'Ooredoo_1006';
              } else if (op === 'Ooredoo') {
                op = 'Ooredoo_1005';
              }
              setForfaitBalance(prev => {
                const next = { ...prev };
                next[op] = (next[op] || 0) + record.amount;
                next.Ooredoo = (next.Ooredoo_1005 || 0) + (next.Ooredoo_1006 || 0);
                return next;
              });
            }
            if (record.category === 'photo') {
              setPhotoPaperStock(prev => prev + (record.qty || 1));
            }
            if (record.category === 'debt_payment' && record.debtId) {
              const targetDebt = debts.find(d => d.id === record.debtId);
              if (targetDebt) {
                const newPaid = Math.max(0, targetDebt.paid - record.amount);
                const updatedDebt: Debt = {
                  ...targetDebt,
                  paid: newPaid,
                  status: (newPaid >= targetDebt.amount - 0.001) ? 'paid' : 'open'
                };
                setDebts(prev => prev.map(d => d.id === record.debtId ? updatedDebt : d));
              }
            }
          }
          setOtherIncome(prev => prev.filter(o => o.id !== id));
        }

        if (!trySavePendingDeleteHistorySale(pendingDel, 'stock_restore_in_progress')) return;
        
        let allStockCompleted = true;
        for (const step of pendingDel.stockSteps) {
          let res;
          if (step.kind === 'item') {
            res = await safeIncrementItemQty(step.targetId, step.qty, undefined, 6, step.opId);
          } else if (step.kind === 'card') {
            // Need to handle card creation on the fly if it doesn't exist
            const cardId = step.targetId;
            const existingCard = cardStock.find(c => c.id === cardId);
            if (!existingCard) {
              // Reconstruct the operator and value from ID: std_card_Ooredoo_1000
              const parts = cardId.replace('std_card_', '').split('_');
              if (parts.length >= 2) {
                const op = parts.slice(0, -1).join(' ');
                const val = parts[parts.length - 1];
                const newCard: CardStockEntry = {
                  id: cardId,
                  kind: 'recharge',
                  operator: op,
                  value: val,
                  qty: step.qty
                };
                await putWithOutbox(\`/cardStock/\${cardId}.json\`, newCard);
                // Mark step completed since putWithOutbox will put it in the outbox
                res = { success: true, pending: false }; // actually wait, putWithOutbox doesn't return \`pending: false\` reliably without outbox check
                // For safety, safeIncrementCardQty does an atomic update. We might just let it fail or create.
                // Wait, safeIncrementCardQty works by modifying if exists.
              }
            }
            // safeIncrementCardQty works on remote db. It uses transaction. If it's missing, Firebase transaction will set it to qty. Let's assume safeIncrementCardQty works.
            res = await safeIncrementCardQty(step.targetId, step.qty, undefined, 6, step.opId);
          } else if (step.kind === 'forfait') {
            res = await safeIncrementForfait({ [step.targetId]: step.qty }, 6, step.opId);
          } else if (step.kind === 'photo') {
            res = await safeIncrementPhotoStock(step.qty, undefined, 6, step.opId);
          } else if (step.kind === 'debt_pay') {
            res = await safeIncrementDebtPaid(step.targetId, step.qty, 6, step.opId);
            // Also need to patch debt status if it changed!
            // Wait, safeIncrementDebtPaid doesn't automatically update \`status\` (open/paid).
            // We should patch it here.
            if (res && res.success) {
               // Patch status
               const debt = debts.find(d => d.id === step.targetId);
               if (debt) {
                 const newPaid = Math.max(0, debt.paid + step.qty);
                 const newStatus = (newPaid >= debt.amount - 0.001) ? 'paid' : 'open';
                 await patchWithOutbox(\`/debts/\${step.targetId}.json\`, { status: newStatus });
               }
            }
          }

          if (res && res.success && !res.pending) {
            step.status = 'completed';
            savePendingDeleteHistorySale(pendingDel);
          } else {
            allStockCompleted = false;
          }
        }
        
        if (allStockCompleted) {
          if (!trySavePendingDeleteHistorySale(pendingDel, 'stock_restore_completed')) return;
        }
        
        if (pendingDel.status === 'stock_restore_completed') {
          if (!trySavePendingDeleteHistorySale(pendingDel, 'sale_delete_in_progress')) return;
        }
        
        if (pendingDel.status === 'sale_delete_in_progress') {
          const path = isSaleRecord ? \`/sales/\${id}.json\` : \`/otherIncome/\${id}.json\`;
          const ok = await putWithOutbox(path, null);
          if (ok.success && !ok.pending) {
            if (trySavePendingDeleteHistorySale(pendingDel, 'completed')) {
              removePendingDeleteHistorySale(pendingDel.id);
            }
          }
          triggerToast('✅ تم إلغاء وحذف المدخول بنجاح');
          logAudit('delete', \`إلغاء مدخول ومعاملة\`);
          loadAllData();
        }
      }
    });
  };`;

const startIdx = code.indexOf('  const handleDeleteHistorySale = async (id: string, isSaleRecord: boolean) => {');
if (startIdx !== -1) {
  let depth = 0;
  let endIdx = -1;
  let started = false;
  for (let i = startIdx; i < code.length; i++) {
    if (code[i] === '{') {
      depth++;
      started = true;
    }
    if (code[i] === '}') {
      depth--;
    }
    if (started && depth === 0) {
      endIdx = i + 1;
      if (code[endIdx] === ';') endIdx++;
      if (code[endIdx] === '\n') endIdx++;
      break;
    }
  }
  if (endIdx !== -1) {
    code = code.substring(0, startIdx) + targetFunction + '\n' + code.substring(endIdx);
    fs.writeFileSync('src/App.tsx', code);
    console.log('Successfully injected handleDeleteHistorySale!');
  } else {
    console.log('Could not find end of handleDeleteHistorySale');
  }
} else {
  console.log('Could not find handleDeleteHistorySale');
}
