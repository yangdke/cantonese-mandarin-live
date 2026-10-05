const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const html = process.env.TRANSLATOR_TEST_REVISION
  ? execFileSync('git', ['show', `${process.env.TRANSLATOR_TEST_REVISION}:index.html`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].at(-1)[1];

function createApp() {
  let now = 0, nextId = 0;
  const timers = new Map(), nodes = new Map(), listeners = new Map();
  const spoken = [];
  function schedule(callback, delay = 0) {
    const id = ++nextId;
    timers.set(id, { callback, due: now + delay });
    return id;
  }
  function advance(ms) {
    const deadline = now + ms;
    let iterations = 0;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.due <= deadline).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      assert.ok(++iterations < 1000, 'timer loop must terminate');
      now = next[1].due;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = deadline;
  }
  function element() {
    const classes = new Set();
    return {
      textContent: '', value: '', innerHTML: '', dataset: {}, attributes: {}, checked: true,
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle(name, force) { const on = force ?? !classes.has(name); on ? classes.add(name) : classes.delete(name); return on; }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(child) { this.textContent += child.textContent; },
      addEventListener() {}, focus() {}, querySelectorAll() { return outputButtons; }
    };
  }
  const outputButtons = ['simplified', 'traditional', 'cantonese'].map(mode => ({ ...element(), dataset: { mode } }));
  const chips = Array.from({ length: 3 }, element);
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const document = {
    documentElement: { dataset: {} }, visibilityState: 'visible',
    querySelector: node,
    querySelectorAll: selector => selector === '.chip' ? chips : [],
    createTextNode: text => ({ textContent: text }), createElement: element,
    addEventListener: (name, callback) => listeners.set(name, callback)
  };
  let engine;
  class Recognition {
    constructor() { engine = this; this.starts = 0; this.aborts = 0; this.active = false; }
    start() {
      if (this.active) { const error = new Error(); error.name = 'InvalidStateError'; throw error; }
      this.starts++; this.active = true;
      schedule(() => { this.onstart?.(); this.onaudiostart?.(); }, 1);
    }
    abort() { this.aborts++; if (!this.active) return; this.active = false; schedule(() => { this.onerror?.({ error: 'aborted' }); this.onend?.(); }, 5); }
    stop() { if (!this.active) return; this.active = false; schedule(() => this.onend?.(), 5); }
    end(error) { this.active = false; if (error) this.onerror?.({ error }); this.onend?.(); }
    result(text, isFinal = true) { const result = [{ transcript: text }]; result.isFinal = isFinal; this.onresult({ resultIndex: 0, results: [result] }); }
  }
  const speechSynthesis = {
    getVoices: () => [{ name: 'Mandarin', lang: 'zh-CN' }, { name: 'Cantonese Hong Kong', lang: 'zh-HK' }],
    speak(utterance) { spoken.push({ text: utterance.text, micActive: engine.active, at: now }); schedule(() => utterance.onend?.(), 300); },
    cancel() {}, addEventListener() {}
  };
  const context = vm.createContext({ document, navigator: { userAgent: 'Android' }, SpeechRecognition: Recognition,
    speechSynthesis, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    setTimeout: schedule, clearTimeout: id => timers.delete(id) });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'opencc-full.js'), 'utf8'), context);
  vm.runInContext(script, context);
  return { engine, node, spoken, advance,
    clickMic() { node('#mobileMicBtn').onclick(); advance(1); },
    foreground() { listeners.get('visibilitychange')(); },
    evaluate: code => vm.runInContext(code, context) };
}

test('silence timeout stops automatic starts for a minute and displays a resume button', () => {
  const app = createApp(); app.clickMic();
  const initialStatus = app.node('#statusText').textContent;
  app.engine.end('no-speech');
  for (let i = 0; i < 10; i++) { app.foreground(); app.advance(6000); if (app.engine.active) app.engine.end('no-speech'); }
  assert.equal(app.engine.starts, 1);
  assert.match(initialStatus, /等待粤语输入/);
  assert.equal(app.node('#mobileMicLabel').textContent, '继续说粤语');
  assert.equal(app.node('#mobileMicBtn').classList.contains('recording'), false);
  assert.match(app.node('#statusText').textContent, /已暂停聆听/);
  assert.equal(app.node('#supportText').textContent, '点击继续即可恢复');
});

test('silent end without an error, including noise that produces no words, does not restart', () => {
  const app = createApp(); app.clickMic();
  app.engine.onspeechstart(); app.engine.onspeechend?.();
  const quietStatus = app.node('#statusText').textContent;
  app.engine.end(); app.advance(60000);
  assert.equal(app.engine.starts, 1);
  assert.match(quietStatus, /等待粤语输入/);
  assert.equal(app.node('#mobileMicLabel').textContent, '继续说粤语');
});

test('a session with words can continue, but a following silent session cannot loop', () => {
  const app = createApp(); app.node('#autoSpeak').checked = false; app.clickMic();
  app.engine.result('我哋听日一齐返屋企食饭。'); app.engine.end(); app.advance(400);
  assert.equal(app.engine.starts, 2);
  const previous = app.node('#source').value;
  app.engine.end('no-speech'); app.advance(60000);
  assert.equal(app.engine.starts, 2);
  assert.equal(app.node('#source').value, previous);
});

test('an explicit resume retains text and restarts exactly once', () => {
  const app = createApp(); app.node('#autoSpeak').checked = false; app.clickMic();
  app.engine.result('我哋听日一齐返屋企食饭。'); app.engine.end('no-speech');
  const previous = app.node('#source').value;
  app.clickMic(); app.advance(1000);
  assert.equal(app.engine.starts, 2);
  assert.equal(app.node('#source').value, previous);
  assert.match(app.node('#statusText').textContent, /等待粤语输入/);
});

test('manual stop cancels a queued continuation', () => {
  const app = createApp(); app.node('#autoSpeak').checked = false; app.clickMic();
  app.engine.result('我哋听日一齐返屋企食饭。'); app.engine.end();
  app.clickMic(); app.advance(60000);
  assert.equal(app.engine.starts, 1);
});

test('network retries remain bounded even when noise produces speech-start events', () => {
  const app = createApp(); app.clickMic();
  for (let i = 0; i < 6; i++) { app.engine.onspeechstart(); app.engine.end('network'); app.advance(6000); }
  assert.equal(app.engine.starts, 6);
  assert.equal(app.evaluate('listening'), false);
});

test('queued speech completes before microphone resumes, then silence remains paused', () => {
  const app = createApp(); app.clickMic();
  app.evaluate("enqueueSpeech('第一句译文'); enqueueSpeech('第二句译文')");
  app.advance(10); app.engine.onerror({ error: 'no-speech' }); app.advance(700);
  assert.deepEqual(app.spoken.map(item => item.text), ['第一句译文', '第二句译文']);
  assert.ok(app.spoken.every(item => !item.micActive));
  assert.equal(app.engine.starts, 1);
  app.advance(1000); assert.equal(app.engine.starts, 2);
  app.engine.end('no-speech'); app.advance(60000);
  assert.equal(app.engine.starts, 2);
  assert.equal(app.node('#mobileMicLabel').textContent, '继续说粤语');
});
