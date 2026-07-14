import React from 'react';
import { Sale, OtherIncome, Expense } from '../types';

interface SvgChartProps {
  sales: Sale[];
  otherIncome: OtherIncome[];
  expenses: Expense[];
  chartDayOffset: number;
}

export const SvgChart: React.FC<SvgChartProps> = ({ sales, otherIncome, expenses, chartDayOffset }) => {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + chartDayOffset);
  const year = base.getFullYear();
  const month = base.getMonth();
  const dayNum = base.getDate();

  const revenueByHour = new Array(24).fill(0);
  const profitByHour = new Array(24).fill(0);

  const sameDay = (d: Date) => 
    d.getFullYear() === year && d.getMonth() === month && d.getDate() === dayNum;

  let hasData = false;

  sales.forEach(s => {
    const d = new Date(s.date);
    if (sameDay(d)) {
      const h = d.getHours();
      revenueByHour[h] += s.total;
      profitByHour[h] += (s.unitPrice - (s.unitBuy || 0)) * s.qty;
      hasData = true;
    }
  });

  otherIncome.forEach(o => {
    const d = new Date(o.date);
    if (sameDay(d)) {
      const h = d.getHours();
      revenueByHour[h] += o.amount;
      profitByHour[h] += (o.commission || 0);
      hasData = true;
    }
  });

  expenses.forEach(e => {
    const d = new Date(e.date);
    if (sameDay(d)) {
      const h = d.getHours();
      profitByHour[h] -= e.amount;
      hasData = true;
    }
  });

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-48 bg-gray-50 rounded-xl border border-dashed border-stone-200 p-6 text-stone-400 text-sm">
        <span>📊 ماعندكش بيانات فهذا اليوم لتوة</span>
      </div>
    );
  }

  // Calculate scales
  const maxVal = Math.max(...revenueByHour, ...profitByHour, 10);
  const minVal = Math.min(...profitByHour, 0);
  const range = maxVal - minVal;

  const width = 500;
  const height = 180;
  const paddingLeft = 30;
  const paddingRight = 10;
  const paddingTop = 15;
  const paddingBottom = 20;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const getX = (index: number) => paddingLeft + (index / 23) * chartWidth;
  const getY = (val: number) => {
    const pct = (val - minVal) / range;
    return height - paddingBottom - pct * chartHeight;
  };

  const revPoints = revenueByHour.map((val, idx) => `${getX(idx)},${getY(val)}`).join(' ');
  const profitPoints = profitByHour.map((val, idx) => `${getX(idx)},${getY(val)}`).join(' ');

  const zeroY = getY(0);

  return (
    <div className="w-full bg-white rounded-xl p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const val = minVal + p * range;
          const y = getY(val);
          return (
            <g key={i}>
              <line 
                x1={paddingLeft} 
                y1={y} 
                x2={width - paddingRight} 
                y2={y} 
                stroke="#f0ece4" 
                strokeWidth="1" 
                strokeDasharray="4 4"
              />
              <text 
                x={paddingLeft - 5} 
                y={y + 3} 
                fontSize="8" 
                fill="#8a8172" 
                textAnchor="end"
                className="font-mono"
              >
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Zero baseline */}
        <line 
          x1={paddingLeft} 
          y1={zeroY} 
          x2={width - paddingRight} 
          y2={zeroY} 
          stroke="#e6ddcc" 
          strokeWidth="1.5"
        />

        {/* Revenue path */}
        <polyline 
          fill="none" 
          stroke="#c8102e" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          points={revPoints}
        />
        {/* Profit path */}
        <polyline 
          fill="none" 
          stroke="#e6b800" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          points={profitPoints}
        />

        {/* X axis labels (hours) */}
        {[0, 4, 8, 12, 16, 20, 23].map((h, i) => {
          const x = getX(h);
          return (
            <text 
              key={i} 
              x={x} 
              y={height - 5} 
              fontSize="8" 
              fill="#8a8172" 
              textAnchor="middle" 
              className="font-mono"
            >
              {h}h
            </text>
          );
        })}
      </svg>
      
      {/* Legend */}
      <div className="flex justify-center gap-6 mt-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#c8102e]" />
          <span className="text-stone-600 font-medium">المبيعات (د.ت)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#e6b800]" />
          <span className="text-stone-600 font-medium">الربح الصافي (د.ت)</span>
        </div>
      </div>
    </div>
  );
};
