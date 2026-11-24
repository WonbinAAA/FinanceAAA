function fraction(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error('หารด้วยศูนย์ไม่ได้');
  return denominator < 0n
    ? { numerator: -numerator, denominator: -denominator }
    : { numerator, denominator };
}

export function calculate(expression) {
  const text = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/\s/g, '');
  if (!text || text.length > 120) throw new Error('กรุณากรอกตัวเลขและเครื่องหมาย');
  const tokens = text.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]/g) || [];
  if (tokens.join('') !== text) throw new Error('กรุณาใช้ตัวเลขและเครื่องหมายคำนวณ');
  let position = 0;

  function value() {
    const token = tokens[position++];
    if (token === '+' || token === '-') {
      const next = value();
      return fraction(token === '-' ? -next.numerator : next.numerator, next.denominator);
    }
    if (token === '(') {
      const result = sum();
      if (tokens[position++] !== ')') throw new Error('กรุณาปิดวงเล็บให้ครบ');
      return result;
    }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new Error('กรุณากรอกการคำนวณให้ครบ');
    const [whole, decimal = ''] = token.split('.');
    return fraction(BigInt((whole || '0') + decimal), 10n ** BigInt(decimal.length));
  }

  function product() {
    let result = value();
    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position++];
      const next = value();
      result = operator === '*'
        ? fraction(result.numerator * next.numerator, result.denominator * next.denominator)
        : fraction(result.numerator * next.denominator, result.denominator * next.numerator);
    }
    return result;
  }

  function sum() {
    let result = product();
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++];
      const next = product();
      result = fraction(
        result.numerator * next.denominator + (operator === '+' ? 1n : -1n) * next.numerator * result.denominator,
        result.denominator * next.denominator,
      );
    }
    return result;
  }

  const result = sum();
  if (position !== tokens.length) throw new Error('กรุณาตรวจเครื่องหมายคำนวณ');
  return result;
}

export function formatCalculation(result, places = 10) {
  const negative = result.numerator < 0n;
  const absolute = negative ? -result.numerator : result.numerator;
  const scale = 10n ** BigInt(places);
  const rounded = (absolute * scale * 2n + result.denominator) / (2n * result.denominator);
  const digits = rounded.toString().padStart(places + 1, '0');
  const decimal = digits.slice(-places).replace(/0+$/, '');
  return (negative && rounded ? '-' : '') + digits.slice(0, -places) + (decimal ? '.' + decimal : '');
}

let calculator;
let pending;

/** @returns {Promise<string | null>} */
export function openCalculator(initialValue = '', allowUse = false) {
  if (!calculator) {
    calculator = document.createElement('dialog');
    calculator.className = 'finance-calculator';
    calculator.setAttribute('aria-labelledby', 'calculatorTitle');
    const keys = ['C', '(', ')', '⌫', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '=', '+'];
    calculator.innerHTML = `
      <div class="calculator-heading"><h2 id="calculatorTitle">เครื่องคิดเลข</h2><button type="button" class="calculator-close" aria-label="ปิดเครื่องคิดเลข">×</button></div>
      <label class="calculator-expression-label" for="calculatorExpression">การคำนวณ</label>
      <input id="calculatorExpression" class="calculator-expression" inputmode="decimal" autocomplete="off" maxlength="120" spellcheck="false">
      <output class="calculator-result" aria-live="polite">0</output>
      <p class="calculator-error" role="alert"></p>
      <div class="calculator-keys">${keys.map(key => `<button type="button" data-key="${key}" class="${/[÷×−+=]/.test(key) ? 'operator' : ''}" ${key === '⌫' ? 'aria-label="ลบตัวท้าย"' : key === 'C' ? 'aria-label="ล้างการคำนวณ"' : ''}>${key}</button>`).join('')}</div>
      <button type="button" class="calculator-use">ใช้ยอดนี้</button>`;
    document.body.append(calculator);
    const input = calculator.querySelector('input');
    const output = calculator.querySelector('output');
    const error = calculator.querySelector('.calculator-error');
    const update = () => {
      error.textContent = '';
      try { output.textContent = formatCalculation(calculate(input.value)); }
      catch { output.textContent = input.value ? '—' : '0'; }
    };
    const equals = () => {
      try {
        input.value = formatCalculation(calculate(input.value));
        update();
      } catch (failure) { error.textContent = failure.message; }
    };
    input.addEventListener('input', update);
    calculator.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); equals(); }
    });
    calculator.querySelector('.calculator-keys').addEventListener('click', event => {
      const key = event.target.closest('button')?.dataset.key;
      if (!key) return;
      if (key === '=') return equals();
      if (key === 'C') input.value = '';
      else if (key === '⌫') input.value = input.value.slice(0, -1);
      else if (input.value.length < 120) input.value += key === '−' ? '-' : key;
      update();
    });
    calculator.querySelector('.calculator-close').addEventListener('click', () => calculator.close());
    calculator.querySelector('.calculator-use').addEventListener('click', () => {
      try {
        const result = calculate(input.value);
        const amount = formatCalculation(result, 2);
        const cents = Number(amount) * 100;
        if (Number(amount) <= 0 || !Number.isSafeInteger(Math.round(cents))) throw new Error('กรุณาใช้ยอดที่มากกว่าศูนย์และอยู่ในขอบเขตที่รองรับ');
        calculator.returnValue = amount;
        calculator.close(amount);
      } catch (failure) { error.textContent = failure.message; }
    });
    calculator.addEventListener('close', () => {
      pending?.(calculator.returnValue || null);
      pending = undefined;
    });
  }
  if (calculator.open) return Promise.resolve(null);
  calculator.returnValue = '';
  calculator.querySelector('input').value = String(initialValue);
  calculator.querySelector('input').dispatchEvent(new Event('input'));
  calculator.querySelector('.calculator-use').hidden = !allowUse;
  calculator.showModal();
  // Keep the mobile keypad visible without opening the phone's own keyboard.
  calculator.querySelector('.calculator-close').focus();
  return new Promise(resolve => { pending = resolve; });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', async event => {
    const trigger = event.target.closest?.('[data-calculator]');
    if (!trigger) return;
    const target = trigger.dataset.calculator ? document.getElementById(trigger.dataset.calculator) : null;
    const amount = await openCalculator(target?.value || '', Boolean(target));
    if (amount !== null && target?.isConnected) {
      target.value = amount;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}
