// Run in the isolated fixture: await (await import('/checks.mjs')).runBrowserChecks()
export async function runBrowserChecks() {
  const mock = window.terminalTest, results = [];
  const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const equal = (actual, expected) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  const key = label => [...document.querySelectorAll('.pt-keybar button')].find(button => button.textContent.trim().replace(/[ •▣]+$/g, '') === label);
  const button = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label);
  const click = async label => { const element = key(label) || button(label); assert(element, `Missing button ${label}`); element.click(); await wait(); };
  const data = () => mock.inputs.map(input => input.data).join('');
  const clear = () => { mock.inputs.length = 0; };
  const textarea = () => document.querySelector('.pt-terminal textarea');
  const keyboard = (type, values) => textarea().dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...values }));
  const insert = (text, { cancelable = true, code229 = false, inputType = 'insertText' } = {}) => {
    const field = textarea();
    if (code229) keyboard('keydown', { key: 'Unidentified', keyCode: 229, which: 229 });
    const before = new InputEvent('beforeinput', { data: text, inputType, bubbles: true, composed: true, cancelable });
    const accepted = field.dispatchEvent(before);
    if (accepted) {
      field.value += text;
      field.dispatchEvent(new InputEvent('input', { data: text, inputType, bubbles: true, composed: true }));
    }
    if (code229) keyboard('keyup', { key: 'Unidentified', keyCode: 229, which: 229 });
  };
  const check = async (name, run) => { try { await run(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: error.message }); } };
  mock.settings({ keybarVisibility: 'always', lockModifiers: false, extendedKeys: false });
  await wait(200);

  await check('toolbar Esc/Tab/arrows/Enter use the current session exactly once', async () => {
    assert(mock.inputs.some(input => /^\x1b\[\d+;\d+R$/.test(input.data)), 'Initial terminal query reply was discarded');
    clear(); for (const label of ['Esc', 'Tab', '↑', '↓', '←', '→', 'Enter']) await click(label);
    equal(data(), '\x1b\t\x1b[A\x1b[B\x1b[D\x1b[C\r');
    assert(mock.inputs.every(input => input.id === 'one'), 'Wrong session');
  });
  await check('input-only Ctrl+C via cancelable beforeinput sends no c', async () => {
    clear(); await click('Ctrl'); insert('c'); await wait(); equal(data(), '\x03'); assert(key('Ctrl').getAttribute('aria-pressed') === 'false', 'Modifier not consumed');
  });
  await check('noncancelable input runs before xterm capture listener', async () => {
    clear(); await click('Ctrl'); insert('d', { cancelable: false }); await wait(); equal(data(), '\x04');
  });
  await check('keycode 229 with noncancelable input does not trigger a delayed duplicate', async () => {
    clear(); await click('Ctrl'); insert('c', { code229: true, cancelable: false }); await wait(100); equal(data(), '\x03');
  });
  await check('keycode 229 preserves unsupported committed Unicode once', async () => {
    clear(); await click('Ctrl'); insert('😀', { code229: true, cancelable: false }); await wait(100); equal(data(), '😀');
    assert(key('Ctrl').getAttribute('aria-pressed') === 'true', 'Unsupported input consumed Ctrl');
    insert('c'); await wait(); equal(data(), '😀\x03');
  });
  await check('paste and terminal replies bypass pending modifiers unchanged', async () => {
    clear(); await click('Ctrl');
    mock.output('one', '\x1b[6n'); await wait(200);
    assert(/^\x1b\[\d+;\d+R$/.test(data()), 'Terminal reply was modified');
    clear(); const clipboard = new DataTransfer(); clipboard.setData('text/plain', 'c😀e\u0301');
    textarea().dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    await wait(); equal(data(), 'c😀e\u0301'); assert(key('Ctrl').getAttribute('aria-pressed') === 'true', 'Paste consumed Ctrl');
    insert('c'); await wait(); equal(data(), 'c😀e\u0301\x03');
  });
  await check('IME composition is unchanged and pending Ctrl is not consumed', async () => {
    clear(); await click('Ctrl'); const field = textarea(); field.value = '';
    keyboard('keydown', { key: 'Unidentified', keyCode: 229 }); // composition starts after we owned this keydown
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    keyboard('keydown', { key: 'Process', keyCode: 229, isComposing: true });
    field.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '漢' })); field.value = '漢';
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: '漢', inputType: 'insertCompositionText', isComposing: true }));
    await wait(5);
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '漢' }));
    keyboard('keyup', { key: 'Process', keyCode: 229 });
    await wait(); equal(data(), '漢'); assert(key('Ctrl').getAttribute('aria-pressed') === 'true', 'Composition consumed modifier');
    insert('c'); await wait(); equal(data(), '漢\x03');
  });
  await check('physical keydown and keypress with virtual Ctrl emit once', async () => {
    clear(); await click('Ctrl'); keyboard('keydown', { key: 'c', code: 'KeyC', keyCode: 67 });
    keyboard('keypress', { key: 'c', code: 'KeyC', keyCode: 67, charCode: 99 }); keyboard('keyup', { key: 'c', code: 'KeyC', keyCode: 67 });
    await wait(); equal(data(), '\x03');
  });
  await check('application cursor mode is read from xterm', async () => {
    mock.output('one', '\x1b[?1h'); await wait(250); clear(); await click('↑'); equal(data(), '\x1bOA');
    mock.output('one', '\x1b[?1l'); await wait(200);
  });
  await check('extended keys distinguish Delete and Backspace and support F12 and Shift', async () => {
    await click('More'); clear(); await click('Del'); await click('⌫'); await click('F12'); await click('Shift'); await click('/');
    equal(data(), '\x1b[3~\x7f\x1b[24~?');
  });
  await check('locks survive input and a normal tap releases them', async () => {
    mock.settings({ lockModifiers: true }); await wait();
    const ctrl = key('Ctrl'); ctrl.click(); ctrl.click(); await wait(); clear(); insert('c'); await wait(); insert('d'); await wait();
    equal(data(), '\x03\x04'); assert(key('Ctrl').getAttribute('aria-pressed') === 'true', 'Lock lost'); await wait(360); await click('Ctrl');
    assert(key('Ctrl').getAttribute('aria-pressed') === 'false', 'Lock not released');
  });
  await check('overlapping resizes finish at the latest dimensions, including a return to cached size', async () => {
    await wait(150); const root = document.querySelector('.pt-root'), original = mock.resizes.at(-1);
    assert(original, 'No initial resize'); const height = root.clientHeight;
    mock.resizeDelay = 250; root.style.height = `${height - 50}px`; await wait(100); root.style.height = `${height}px`;
    await wait(600); mock.resizeDelay = 0; root.style.removeProperty('height');
    equal(mock.resizes.at(-1).rows, original.rows); equal(mock.resizes.at(-1).cols, original.cols);
  });
  await check('tab change resets modifiers and immediately targets only the new tab', async () => {
    await click('Ctrl'); clear(); const oldEnter = key('Enter'); button('Terminal 2').click(); oldEnter.click();
    await wait(120); equal(data(), ''); await click('Enter');
    equal(data(), '\r'); assert(mock.inputs.every(input => input.id === 'two'), 'Input reached old tab'); assert(key('Ctrl').getAttribute('aria-pressed') === 'false', 'Modifier survived tab switch');
  });
  await check('input failure disables keys; reconnect drops old data and restores fresh input', async () => {
    clear(); const field = textarea(); mock.failure = 'input'; await click('Enter'); assert(key('Enter').disabled, 'Keys stayed enabled');
    assert(textarea() === field, 'Error banner remounted terminal and cleared the failure latch');
    const confirm = window.confirm; window.confirm = () => true; mock.failure = 'sessions/one';
    try { document.querySelector('[aria-label="Close Terminal 1"]').click(); await wait(); }
    finally { window.confirm = confirm; }
    assert(textarea() === field && key('Enter').disabled, 'Inactive-tab deletion failure cleared the input-failure latch');
    await click('↑'); equal(data(), ''); mock.failure = null; await click('Reconnect'); await wait(150);
    assert(!key('Enter').disabled, 'Reconnect failed'); await click('Enter'); equal(data(), '\r');
  });
  await check('closed sessions disable further input', async () => {
    mock.sessions.delete('two'); await wait(250); clear(); assert(key('Enter').disabled, 'Closed session still accepts keys'); await click('Enter'); equal(data(), '');
    await click('Reconnect'); await wait(150); assert(document.querySelector('.pt-tab.selected').textContent.includes('Terminal 1'), 'Session list did not recover');
  });
  await check('visibility settings and layout remain bounded', async () => {
    mock.settings({ keybarVisibility: 'never' }); await wait(); assert(!document.querySelector('.pt-keybar'), 'Never setting ignored');
    mock.settings({ keybarVisibility: 'auto' }); await wait(); equal(Boolean(document.querySelector('.pt-keybar')), matchMedia('(any-pointer: coarse)').matches);
    mock.settings({ keybarVisibility: 'always' }); await wait(); assert(document.querySelector('.pt-keybar'), 'Always setting ignored');
    assert(document.documentElement.scrollWidth <= innerWidth, 'Page scrolls sideways');
    const root = document.querySelector('.pt-root').getBoundingClientRect(); assert(root.bottom <= innerHeight + 1, 'Toolbar exceeds viewport');
    assert([...document.querySelectorAll('.pt-key')].every(key => key.getBoundingClientRect().height >= 44), 'Touch targets below 44px');
  });
  window.terminalTestResults = results;
  return { passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length, results };
}
