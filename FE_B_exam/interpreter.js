/**
 * IPA 擬似言語 インタプリタ（練習用） - 完全版
 * 全サンプル動作確認済み
 */
class PseudoInterpreter {
  constructor(options = {}) {
    this.output = [];
    this.vars = new Map();
    this.functions = new Map();
    this.maxSteps = options.maxSteps || 100000;
    this.stepCount = 0;
    this.halted = false;
    this.error = null;
    this.arrayBase = 1;
    this.currentEnv = null;
  }
  reset() {
    this.output = [];
    this.vars.clear();
    this.functions.clear();
    this.stepCount = 0;
    this.halted = false;
    this.error = null;
    this.currentEnv = null;
  }
  log(msg, type = 'out') { this.output.push({ type, msg: String(msg) }); }
  static normalize(src) {
    return src.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ');
  }
  preprocess(source) {
    const lines = [];
    let inBlock = false;
    const raw = PseudoInterpreter.normalize(source).split(/\r?\n/);
    for (let i = 0; i < raw.length; i++) {
      let line = raw[i];
      if (inBlock) {
        const end = line.indexOf('*/');
        if (end >= 0) { line = line.slice(end + 2); inBlock = false; } else continue;
      }
      while (true) {
        const start = line.indexOf('/*');
        if (start < 0) break;
        const end = line.indexOf('*/', start + 2);
        if (end >= 0) line = line.slice(0, start) + line.slice(end + 2);
        else { line = line.slice(0, start); inBlock = true; break; }
      }
      const cmt = line.indexOf('//');
      if (cmt >= 0) line = line.slice(0, cmt);
      line = line.replace(/\s+$/, '');
      if (line.trim() === '') continue;
      lines.push({ text: line, orig: i + 1, indent: line.match(/^\s*/)[0].length });
    }
    return lines;
  }
  tokenizeExpr(expr) {
    const tokens = [];
    let i = 0;
    const s = String(expr).trim();
    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue; }
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i]; let j = i + 1, val = '';
        while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; val += s[j] || ''; j++; }
        tokens.push({ type: 'str', value: val }); i = j + 1; continue;
      }
      if (/[0-9]/.test(s[i]) || (s[i] === '.' && /[0-9]/.test(s[i+1]||''))) {
        let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
        tokens.push({ type: 'num', value: parseFloat(s.slice(i, j)) }); i = j; continue;
      }
      if (/[a-zA-Z_ぁ-んァ-ヶ一-龥]/.test(s[i])) {
        let j = i; while (j < s.length && /[a-zA-Z0-9_ぁ-んァ-ヶ一-龥]/.test(s[j])) j++;
        const id = s.slice(i, j);
        if (id === 'true' || id === 'false') tokens.push({ type: 'bool', value: id === 'true' });
        else if (id === 'and' || id === 'or' || id === 'not' || id === 'mod') tokens.push({ type: 'op', value: id });
        else tokens.push({ type: 'id', value: id });
        i = j; continue;
      }
      const ops = ['≠','≦','≧','×','÷','＋','－','＝','＜','＞','←','<=','>=','==','!=','&&','||'];
      let matched = false;
      for (const op of ops) {
        if (s.startsWith(op, i)) { tokens.push({ type: 'op', value: op }); i += op.length; matched = true; break; }
      }
      if (matched) continue;
      const ch = s[i];
      if ('()[]{},.+-*/%=<>!'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue; }
      throw new Error('式中の未対応文字: "' + ch + '"');
    }
    return tokens;
  }
  evalExpr(expr, env = null) {
    if (expr === undefined || expr === null || String(expr).trim() === '') return undefined;
    const tokens = this.tokenizeExpr(expr);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const expect = (v) => { const t = next(); if (!t || t.value !== v) throw new Error('期待 "' + v + '"');
 return t; };
    const parseOr = () => { let left = parseAnd(); while (peek() && (peek().value === 'or' || peek().value === '||')) { next(); left = !!(left || parseAnd()); } return left; };
    const parseAnd = () => { let left = parseRel(); while (peek() && (peek().value === 'and' || peek().value === '&&')) { next(); left = !!(left && parseRel()); } return left; };
    const parseRel = () => {
      let left = parseAdd();
      while (peek() && ['＝','=','≠','!=','＜','<','＞','>','≦','<=','≧','>='].includes(peek().value)) {
        const op = next().value; const right = parseAdd();
        if (op === '＝' || op === '=' || op === '==') left = left == right;
        else if (op === '≠' || op === '!=') left = left != right;
        else if (op === '＜' || op === '<') left = left < right;
        else if (op === '＞' || op === '>') left = left > right;
        else if (op === '≦' || op === '<=') left = left <= right;
        else if (op === '≧' || op === '>=') left = left >= right;
      }
      return left;
    };
    const parseAdd = () => {
      let left = parseMul();
      while (peek() && (peek().value === '＋' || peek().value === '+' || peek().value === '－' || peek().value === '-')) {
        const op = next().value; const right = parseMul();
        if (op === '＋' || op === '+') left = (typeof left === 'string' || typeof right === 'string') ? String(left) + String(right) : left + right;
        else left = left - right;
      }
      return left;
    };
    const parseMul = () => {
      let left = parseUnary();
      while (peek() && (peek().value === '×' || peek().value === '*' || peek().value === '÷' || peek().value === '/' || peek().value === 'mod' || peek().value === '%')) {
        const op = next().value; const right = parseUnary();
        if (op === '×' || op === '*') left = left * right;
        else if (op === '÷' || op === '/') left = left / right;
        else left = left % right;
      }
      return left;
    };
    const parseUnary = () => {
      if (peek() && (peek().value === 'not' || peek().value === '!' || peek().value === '＋' || peek().value === '+' || peek().value === '－' || peek().value === '-')) {
        const op = next().value; const v = parseUnary();
        if (op === 'not' || op === '!') return !v;
        if (op === '－' || op === '-') return -v;
        return +v;
      }
      return parsePrimary();
    };
    const parsePrimary = () => {
      const t = peek();
      if (!t) throw new Error('式が空です');
      if (t.type === 'num' || t.type === 'str' || t.type === 'bool') { next(); return t.value; }
      if (t.value === '(') { next(); const v = parseOr(); expect(')'); return v; }
      if (t.value === '{') {
        next(); const arr = [];
        if (peek() && peek().value !== '}') { arr.push(parseOr()); while (peek() && peek().value === ',') { next(); arr.push(parseOr()); } }
        expect('}'); return arr;
      }
      if (t.type === 'id') {
        next(); let name = t.value;
        if (peek() && peek().value === '(') {
          next(); const args = [];
          if (peek() && peek().value !== ')') { args.push(parseOr()); while (peek() && peek().value === ',') { next(); args.push(parseOr()); } }
          expect(')'); return this.callFunction(name, args, env);
        }
        let val = this.getVar(name, env);
        while (peek() && peek().value === '[') {
          next(); const idx1 = parseOr(); let idx2 = null;
          if (peek() && peek().value === ',') { next(); idx2 = parseOr(); }
          expect(']');
          if (!Array.isArray(val)) throw new Error(name + ' は配列ではありません');
          const i1 = Math.floor(Number(idx1)) - this.arrayBase;
          if (i1 < 0 || i1 >= val.length) throw new Error('配列範囲外: ' + name + '[' + (i1 + this.arrayBase) + ']');
          if (idx2 !== null) {
            const i2 = Math.floor(Number(idx2)) - this.arrayBase;
            if (!Array.isArray(val[i1])) throw new Error(name + '[' + (i1 + this.arrayBase) + '] は配列ではありません');
            if (i2 < 0 || i2 >= val[i1].length) throw new Error('配列範囲外');
            val = val[i1][i2];
          } else val = val[i1];
        }
        return val;
      }
      throw new Error('予期しないトークン: ' + t.value);
    };
    return parseOr();
  }
  getVar(name, env = null) {
    if (env && env.has(name)) return env.get(name).value;
    if (this.vars.has(name)) return this.vars.get(name).value;
    return undefined;
  }
  setVar(name, value, type = null, env = null) {
    const target = env || this.vars;
    if (target.has(name)) { const v = target.get(name); v.value = value; if (type) v.type = type; }
    else target.set(name, { type: type || typeof value, value, isArray: Array.isArray(value) });
  }
  callFunction(name, args, env) {
    if (name === 'writeLine' || name === 'print' || name === '出力') {
      const msg = args.map(a => a === undefined ? '未定義' : Array.isArray(a) ? JSON.stringify(a) : String(a)).join(' ');
      this.log(msg, 'out'); return undefined;
    }
    if (name === '要素数' || name === 'length' || name === 'size') {
      if (!Array.isArray(args[0])) throw new Error('要素数() には配列が必要です');
      return args[0].length;
    }
    if (this.functions.has(name)) {
      const fn = this.functions.get(name);
      const local = new Map();
      for (let i = 0; i < fn.params.length; i++) {
        const p = fn.params[i];
        local.set(p.name, { type: p.type, value: args[i], isArray: Array.isArray(args[i]) });
      }
      const prevEnv = this.currentEnv;
      const prevHalted = this.halted;
      this.currentEnv = local;
      this.halted = false;
      let ret;
      try { ret = this.executeBlock(fn.body, local); } finally { this.currentEnv = prevEnv; this.halted = prevHalted; }
      return ret;
    }
    throw new Error('未定義の手続/関数: ' + name);
  }
  execute(source) {
    this.reset();
    const lines = this.preprocess(source);
    try {
      this.extractFunctions(lines);
      const mainLines = [];
      let skipUntil = -1;
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].text.trim();
        const ind = lines[i].indent;
        if (t.startsWith('○')) { skipUntil = ind; continue; }
        if (skipUntil >= 0) { if (ind > skipUntil) continue; else skipUntil = -1; }
        mainLines.push(lines[i]);
      }
      this.executeBlock(mainLines, this.vars);
    } catch (e) {
      this.error = e.message || String(e);
      this.log('【実行時エラー】 ' + this.error, 'err');
    }
    return { output: this.output, vars: this.vars, error: this.error, steps: this.stepCount };
  }
  extractFunctions(lines) {
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].text.trim();
      const m = t.match(/^○\s*(?:([\wぁ-んァ-ヶ一-龥]+型)\s*:\s*)?([\wぁ-んァ-ヶ一-龥]+)\s*\((.*)\)\s*$/);
      if (m) {
        const retType = m[1] || null;
        const name = m[2];
        const paramStr = m[3].trim();
        const params = [];
        if (paramStr) {
          for (const p of paramStr.split(',').map(x => x.trim())) {
            const pm = p.match(/^(?:([\wぁ-んァ-ヶ一-龥]+(?:の配列)?)\s*:\s*)?([\wぁ-んァ-ヶ一-龥]+)$/);
            if (pm) params.push({ type: pm[1] || null, name: pm[2] });
          }
        }
        const startIndent = lines[i].indent;
        const body = [];
        i++;
        while (i < lines.length) {
          const lt = lines[i].text.trim();
          const ind = lines[i].indent;
          if (ind <= startIndent && (lt.startsWith('○') || /^[\wぁ-んァ-ヶ一-龥]+型\s*:/.test(lt) || lt.startsWith('writeLine') || lt.startsWith('整数型') || lt.startsWith('実数型') || lt.startsWith('文字列型') || lt.startsWith('論理型'))) break;
          body.push(lines[i]);
          i++;
        }
        this.functions.set(name, { retType, params, body });
        continue;
      }
      i++;
    }
  }
  executeBlock(lines, env) {
    let i = 0;
    let returnValue;
    while (i < lines.length) {
      if (this.halted) break;
      this.stepCount++;
      if (this.stepCount > this.maxSteps) throw new Error('ステップ数が上限を超えました（無限ループの可能性）');
      const line = lines[i];
      const text = line.text.trim();
      if (text.startsWith('return ')) { returnValue = this.evalExpr(text.slice(7).trim(), env); this.halted = true; break; }
      if (text === 'return') { this.halted = true; break; }
      const declMatch = text.match(/^([\wぁ-んァ-ヶ一-龥]+(?:の配列)?)\s*:\s*([\wぁ-んァ-ヶ一-龥]+)(?:\s*←\s*(.+))?$/);
      if (declMatch) {
        const type = declMatch[1], name = declMatch[2];
        let value = declMatch[3] ? this.evalExpr(declMatch[3], env) : undefined;
        this.setVar(name, value, type, env);
        i++; continue;
      }
      const multiDecl = text.match(/^([\wぁ-んァ-ヶ一-龥]+(?:の配列)?)\s*:\s*(.+)$/);
      if (multiDecl && !text.includes('←') && multiDecl[2].includes(',')) {
        const type = multiDecl[1];
        for (const n of multiDecl[2].split(',').map(x => x.trim()).filter(Boolean)) this.setVar(n, undefined, type, env);
        i++; continue;
      }
      if (text.includes('←')) {
        const eqIdx = text.indexOf('←');
        const left = text.slice(0, eqIdx).trim();
        const right = text.slice(eqIdx + 1).trim();
        const rVal = this.evalExpr(right, env);
        const arrM = left.match(/^([\wぁ-んァ-ヶ一-龥]+)\s*\[(.+)\]$/);
        if (arrM) {
          const aname = arrM[1];
          let arr = this.getVar(aname, env);
          if (!Array.isArray(arr)) throw new Error(aname + ' は配列ではありません');
          if (arrM[2].includes(',')) {
            const [i1e, i2e] = arrM[2].split(',').map(s => s.trim());
            const i1 = Math.floor(Number(this.evalExpr(i1e, env))) - this.arrayBase;
            const i2 = Math.floor(Number(this.evalExpr(i2e, env))) - this.arrayBase;
            arr[i1][i2] = rVal;
          } else {
            const i1 = Math.floor(Number(this.evalExpr(arrM[2], env))) - this.arrayBase;
            arr[i1] = rVal;
          }
          this.setVar(aname, arr, null, env);
        } else this.setVar(left, rVal, null, env);
        i++; continue;
      }
      if (text.startsWith('if ') || text.startsWith('if(')) {
        const res = this.handleIf(lines, i, env);
        i = res.nextIndex;
        if (res.returned !== undefined) { returnValue = res.returned; this.halted = true; break; }
        continue;
      }
      if (text.startsWith('while ') || text.startsWith('while(')) {
        const res = this.handleWhile(lines, i, env);
        i = res.nextIndex;
        if (res.returned !== undefined) { returnValue = res.returned; this.halted = true; break; }
        continue;
      }
      if (text === 'do') {
        const res = this.handleDoWhile(lines, i, env);
        i = res.nextIndex;
        if (res.returned !== undefined) { returnValue = res.returned; this.halted = true; break; }
        continue;
      }
      if (text.startsWith('for ') || text.startsWith('for(')) {
        const res = this.handleFor(lines, i, env);
        i = res.nextIndex;
        if (res.returned !== undefined) { returnValue = res.returned; this.halted = true; break; }
        continue;
      }
      const callM = text.match(/^([\wぁ-んァ-ヶ一-龥]+)\s*\((.*)\)\s*$/);
      if (callM) {
        const args = callM[2].trim() ? this.splitArgs(callM[2]).map(p => this.evalExpr(p, env)) : [];
        this.callFunction(callM[1], args, env);
        i++; continue;
      }
      i++;
    }
    return returnValue;
  }
  splitArgs(s) {
    const args = []; let depth = 0, cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    if (cur.trim()) args.push(cur.trim());
    return args;
  }
  handleIf(lines, idx, env) {
    const baseIndent = lines[idx].indent;
    const text = lines[idx].text.trim();
    const condMatch = text.match(/^if\s*\((.+)\)\s*$/);
    if (!condMatch) throw new Error('if の構文エラー');
    let currentCond = condMatch[1];
    let currentBody = [];
    let i = idx + 1;
    while (i < lines.length) {
      const t = lines[i].text.trim();
      const ind = lines[i].indent;
      if (ind <= baseIndent) {
        if (t.startsWith('elseif ') || t.startsWith('elseif(')) {
          if (this.evalExpr(currentCond, env)) {
            const r = this.executeBlock(currentBody, env);
            return { nextIndex: this.findEndif(lines, idx, baseIndent), returned: r };
          }
          const em = t.match(/^elseif\s*\((.+)\)\s*$/);
          currentCond = em ? em[1] : 'false';
          currentBody = [];
          i++; continue;
        }
        if (t === 'else') {
          if (this.evalExpr(currentCond, env)) {
            const r = this.executeBlock(currentBody, env);
            return { nextIndex: this.findEndif(lines, idx, baseIndent), returned: r };
          }
          currentCond = 'true';
          currentBody = [];
          i++; continue;
        }
        if (t === 'endif') {
          if (this.evalExpr(currentCond, env)) {
            const r = this.executeBlock(currentBody, env);
            return { nextIndex: i + 1, returned: r };
          }
          return { nextIndex: i + 1, returned: undefined };
        }
        if (t && !t.startsWith('elseif') && t !== 'else' && t !== 'endif') {
          if (this.evalExpr(currentCond, env)) {
            const r = this.executeBlock(currentBody, env);
            return { nextIndex: i, returned: r };
          }
          return { nextIndex: i, returned: undefined };
        }
      }
      currentBody.push(lines[i]);
      i++;
    }
    if (this.evalExpr(currentCond, env)) {
      const r = this.executeBlock(currentBody, env);
      return { nextIndex: i, returned: r };
    }
    return { nextIndex: i, returned: undefined };
  }
  findEndif(lines, start, baseIndent) {
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
      const t = lines[i].text.trim();
      if (t.startsWith('if ') || t.startsWith('if(')) depth++;
      if (t === 'endif') { depth--; if (depth === 0) return i + 1; }
    }
    return lines.length;
  }
  handleWhile(lines, idx, env) {
    const baseIndent = lines[idx].indent;
    const text = lines[idx].text.trim();
    const condMatch = text.match(/^while\s*\((.+)\)\s*$/);
    if (!condMatch) throw new Error('while の構文エラー');
    const condExpr = condMatch[1];
    const { body, nextIndex } = this.collectWhileBody(lines, idx, baseIndent);
    let ret;
    while (this.evalExpr(condExpr, env)) {
      this.halted = false;
      ret = this.executeBlock(body, env);
      if (this.halted) break;
      this.stepCount++;
      if (this.stepCount > this.maxSteps) throw new Error('ステップ上限超過');
    }
    return { nextIndex, returned: ret };
  }
  collectWhileBody(lines, start, baseIndent) {
    const body = [];
    let i = start + 1;
    while (i < lines.length) {
      const t = lines[i].text.trim();
      if (lines[i].indent <= baseIndent && (t === 'endwhile' || t.startsWith('while ') || t.startsWith('if ') || t.startsWith('for ') || t === 'do' || t.startsWith('○'))) {
        if (t === 'endwhile') return { body, nextIndex: i + 1 };
        return { body, nextIndex: i };
      }
      body.push(lines[i]);
      i++;
    }
    return { body, nextIndex: i };
  }
  handleDoWhile(lines, idx, env) {
    const body = [];
    let i = idx + 1;
    let condExpr = 'false';
    while (i < lines.length) {
      const t = lines[i].text.trim();
      if (t.startsWith('while ') || t.startsWith('while(')) {
        const m = t.match(/^while\s*\((.+)\)\s*$/);
        if (m) condExpr = m[1];
        i++; break;
      }
      body.push(lines[i]);
      i++;
    }
    let ret;
    do {
      this.halted = false;
      ret = this.executeBlock(body, env);
      if (this.halted) break;
      this.stepCount++;
      if (this.stepCount > this.maxSteps) throw new Error('ステップ上限超過');
    } while (this.evalExpr(condExpr, env));
    return { nextIndex: i, returned: ret };
  }
  handleFor(lines, idx, env) {
    const baseIndent = lines[idx].indent;
    const text = lines[idx].text.trim();
    const m = text.match(/^for\s*\((.+)\)\s*$/);
    if (!m) throw new Error('for の構文エラー');
    const control = m[1].trim();
    const rangeM = control.match(/^([\wぁ-んァ-ヶ一-龥]+)\s*を\s*(.+?)\s*から\s*(.+?)\s*まで\s*(.+?)\s*ずつ\s*(増やす|減らす)$/);
    if (!rangeM) throw new Error('for 制御記述を解析できません: "' + control + '"\n例: i を 1 から 10 まで 1 ずつ増やす');
    const varName = rangeM[1];
    const startVal = this.evalExpr(rangeM[2], env);
    const endVal = this.evalExpr(rangeM[3], env);
    const stepVal = this.evalExpr(rangeM[4], env);
    const increasing = rangeM[5] === '増やす';
    const { body, nextIndex } = this.collectForBody(lines, idx, baseIndent);
    this.setVar(varName, startVal, '整数型', env);
    let ret;
    const step = increasing ? Math.abs(stepVal) : -Math.abs(stepVal);
    while (true) {
      const cur = this.getVar(varName, env);
      if (increasing && cur > endVal) break;
      if (!increasing && cur < endVal) break;
      this.halted = false;
      ret = this.executeBlock(body, env);
      if (this.halted) break;
      this.setVar(varName, cur + step, null, env);
      this.stepCount++;
      if (this.stepCount > this.maxSteps) throw new Error('ステップ上限超過');
    }
    return { nextIndex, returned: ret };
  }
  collectForBody(lines, start, baseIndent) {
    const body = [];
    let i = start + 1;
    while (i < lines.length) {
      const t = lines[i].text.trim();
      if (lines[i].indent <= baseIndent && (t === 'endfor' || t.startsWith('for ') || t.startsWith('if ') || t.startsWith('while ') || t === 'do' || t.startsWith('○'))) {
        if (t === 'endfor') return { body, nextIndex: i + 1 };
        return { body, nextIndex: i };
      }
      body.push(lines[i]);
      i++;
    }
    return { body, nextIndex: i };
  }
}
const SAMPLES = {
  sum: `// 1からnまでの合計を求める\n整数型: n ← 10\n整数型: sum ← 0\n整数型: i\n\nfor (i を 1 から n まで 1 ずつ増やす)\n  sum ← sum ＋ i\nendfor\n\nwriteLine("1から" ＋ n ＋ "までの合計 = " ＋ sum)\n`,
  array_sum: `// 配列の合計\n整数型の配列: a ← {12, 34, 56, 78, 90}\n整数型: sum ← 0\n整数型: i\n整数型: n ← 要素数(a)\n\nfor (i を 1 から n まで 1 ずつ増やす)\n  sum ← sum ＋ a[i]\nendfor\n\nwriteLine("配列の合計 = " ＋ sum)\n`,
  factorial: `// 階乗を計算する関数\n○整数型: fact(整数型: n)\n  整数型: result ← 1\n  整数型: i\n  for (i を 1 から n まで 1 ずつ増やす)\n    result ← result × i\n  endfor\n  return result\n\n整数型: x ← 5\n整数型: ans ← fact(x)\nwriteLine(x ＋ "! = " ＋ ans)\n`,
  fizzbuzz: `// 1〜20 で 3の倍数と5の倍数を判定\n整数型: i\nfor (i を 1 から 20 まで 1 ずつ増やす)\n  if (i mod 15 ＝ 0)\n    writeLine("FizzBuzz")\n  elseif (i mod 3 ＝ 0)\n    writeLine("Fizz")\n  elseif (i mod 5 ＝ 0)\n    writeLine("Buzz")\n  else\n    writeLine(i)\n  endif\nendfor\n`,
  max: `// 配列から最大値を探す\n整数型の配列: data ← {3, 7, 2, 9, 5, 1, 8}\n整数型: max ← data[1]\n整数型: i\n整数型: n ← 要素数(data)\n\nfor (i を 2 から n まで 1 ずつ増やす)\n  if (data[i] ＞ max)\n    max ← data[i]\n  endif\nendfor\n\nwriteLine("最大値 = " ＋ max)\n`,
  for_nested: `// 九九の一部を表示\n整数型: i\n整数型: j\nfor (i を 1 から 5 まで 1 ずつ増やす)\n  for (j を 1 から 5 まで 1 ずつ増やす)\n    writeLine(i ＋ " × " ＋ j ＋ " = " ＋ (i × j))\n  endfor\n  writeLine("---")\nendfor\n`
};
