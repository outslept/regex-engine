/**
 * @enum {number}
 */
const TokenType = {
  GROUP: 0,
  BRACKET: 1,
  OR: 2,
  REPEAT: 3,
  LITERAL: 4,
};

/**
 * @typedef {Object} Token
 * @property {TokenType} tokenType
 * @property {*} value
 */

/**
 * @typedef {Object} ParseContext
 * @property {number} pos
 * @property {Token[]} tokens
 * @property {string} regex
 */

/**
 * Create a new parse context.
 * @param {string} regex
 * @returns {ParseContext}
 */
function createParseContext(regexString) {
  return {
    pos: 0,
    tokens: [],
    regex: regexString
  };
}

/**
 * Reports a parsing error.
 * @param {string} message
 * @param {ParseContext} ctx
 * @param {number} [errorPos] Optional specific position, otherwise uses ctx.pos
 */
function reportError(message, ctx, errorPos) {
  const pos = typeof errorPos === 'number' ? errorPos : ctx.pos;
  const snippetStart = Math.max(0, pos - 10);
  const snippetEnd = Math.min(ctx.regex.length, pos + 10);
  const snippet = `...${ctx.regex.substring(snippetStart, pos)}[HERE]${ctx.regex.substring(pos, snippetEnd)}...`;
  throw new Error(`Regex Parse Error: ${message} at position ${pos}. Regex snippet: ${snippet}`);
}

/**
 * Parses the entire regular expression.
 * regex -> expression (EOF)
 * @param {string} regexStr
 * @returns {ParseContext}
 */
function parse(regexStr) {
  const ctx = createParseContext(regexStr);
  ctx.tokens = parseExpression(ctx, undefined);
  if (ctx.pos < ctx.regex.length) {
    reportError("Unexpected characters at end of expression", ctx);
  }
  return ctx;
}

/**
 * Parses an expression (handles alternations).
 * expression -> term ('|' term)*
 * @param {ParseContext} ctx
 * @param {string[]} [stopChars] Characters that should terminate parsing this expression (e.g., ')')
 * @returns {Token[]}
 */
function parseExpression(ctx, stopChars) {
  let leftNode = parseTerm(ctx, stopChars);

  while (ctx.pos < ctx.regex.length && (!stopChars?.includes(ctx.regex[ctx.pos]))) {
    if (ctx.regex[ctx.pos] === '|') {
      if (leftNode.length === 0) {
        reportError("Alternation operator | missing left operand", ctx, ctx.pos);
      }
      ctx.pos++;
      if (ctx.pos >= ctx.regex.length || (stopChars?.includes(ctx.regex[ctx.pos])) || ctx.regex[ctx.pos] === '|') {
        reportError("Alternation operator | missing right operand", ctx, ctx.pos);
      }
      const rightNode = parseTerm(ctx, stopChars);
      if (rightNode.length === 0) {
        reportError("Alternation operator | has empty right operand", ctx, ctx.pos);
      }
      leftNode = [{ tokenType: TokenType.OR, value: [leftNode, rightNode] }];
    } else {
      break;
    }
  }
  return leftNode;
}

/**
 * Parses a term (handles concatenations).
 * term -> factor (factor)*
 * @param {ParseContext} ctx
 * @param {string[]} [stopChars]
 * @returns {Token[]}
 */
function parseTerm(ctx, stopChars) {
  const tokens = [];
  while (ctx.pos < ctx.regex.length && (!stopChars?.includes(ctx.regex[ctx.pos]))) {
    if (ctx.regex[ctx.pos] === '|') {
      break;
    }
    const factor = parseFactor(ctx, stopChars);
    if (factor) {
      tokens.push(factor);
    } else {
      break;
    }
  }
  return tokens;
}

/**
 * Parses a factor (handles an atom and its optional quantifier).
 * factor -> atom (quantifier)?
 * @param {ParseContext} ctx
 * @param {string[]} [stopChars]
 * @returns {Token | null}
 */
function parseFactor(ctx, stopChars) {
  const atomToken = parseAtom(ctx, stopChars);
  if (!atomToken) {
    return null;
  }

  let min, max;
  let quantifierFound = false;

  if (ctx.pos < ctx.regex.length) {
    const char = ctx.regex[ctx.pos];
    switch (char) {
      case '*':
        min = 0; max = Infinity;
        quantifierFound = true;
        ctx.pos++;
        break;
      case '+':
        min = 1; max = Infinity;
        quantifierFound = true;
        ctx.pos++;
        break;
      case '?':
        min = 0; max = 1;
        quantifierFound = true;
        ctx.pos++;
        break;
      case '{':
        quantifierFound = true;
        const quantStartPos = ctx.pos;
        ctx.pos++;
        let sMin = '', sMax = '';
        let inMin = true;
        let commaFound = false;

        while (ctx.pos < ctx.regex.length && ctx.regex[ctx.pos] !== '}') {
          const qc = ctx.regex[ctx.pos];
          if (qc === ',') {
            if (commaFound) reportError("Multiple commas in quantifier", ctx, ctx.pos);
            inMin = false;
            commaFound = true;
          } else if (/\d/.test(qc)) {
            if (inMin) sMin += qc;
            else sMax += qc;
          } else {
            reportError("Non-digit in quantifier", ctx, ctx.pos);
          }
          ctx.pos++;
        }

        if (ctx.pos >= ctx.regex.length || ctx.regex[ctx.pos] !== '}') {
          reportError("Unterminated quantifier", ctx, quantStartPos);
        }
        ctx.pos++;

        if (sMin === '' && !commaFound) reportError("Empty quantifier", ctx, quantStartPos);
        if (sMin === '' && commaFound && sMax === '') reportError("Empty quantifier {,}", ctx, quantStartPos);

        min = sMin !== '' ? parseInt(sMin, 10) : 0;
        if (commaFound) {
            max = sMax !== '' ? parseInt(sMax, 10) : Infinity;
        } else {
            max = min;
        }

        if (sMin !== '' && sMax !== '' && min > max) {
          reportError(`Invalid quantifier range {${min},${max}}: min > max`, ctx, quantStartPos);
        }
        break;
      default:
        break;
    }
  }

  if (quantifierFound) {
    if (!atomToken) {
      reportError("Quantifier follows nothing", ctx, ctx.pos -1);
    }
    return { tokenType: TokenType.REPEAT, value: { min, max, token: atomToken } };
  }

  return atomToken;
}

/**
 * Parses an atom (literal, group, character class).
 * atom -> LITERAL | '(' expression ')' | '[' character_set ']'
 * @param {ParseContext} ctx
 * @param {string[]} [stopChars]
 * @returns {Token | null}
 */
function parseAtom(ctx, stopChars) {
  if (ctx.pos >= ctx.regex.length || (stopChars?.includes(ctx.regex[ctx.pos]))) {
    return null;
  }

  const char = ctx.regex[ctx.pos];

  switch (char) {
    case '(': {
      const groupStartPos = ctx.pos;
      ctx.pos++;
      const groupTokens = parseExpression(ctx, [')']);
      if (ctx.pos >= ctx.regex.length || ctx.regex[ctx.pos] !== ')') {
        reportError("Unterminated group", ctx, groupStartPos);
      }
      ctx.pos++;
      return { tokenType: TokenType.GROUP, value: groupTokens };
    }
    case '[': {
      const bracketStartPos = ctx.pos;
      ctx.pos++;
      const literals = [];
      if (ctx.pos < ctx.regex.length && ctx.regex[ctx.pos] === '^') {
        // reportError("Negation in character class [^...] is not supported", ctx);
      }

      while (ctx.pos < ctx.regex.length && ctx.regex[ctx.pos] !== ']') {
        const ch = ctx.regex[ctx.pos];
        if (ctx.pos + 2 < ctx.regex.length && ctx.regex[ctx.pos + 1] === '-' && ctx.regex[ctx.pos + 2] !== ']') {
          const prev = ch;
          const next = ctx.regex[ctx.pos + 2];
          if (prev.charCodeAt(0) > next.charCodeAt(0)) {
            reportError(`Invalid range ${prev}-${next} in character class`, ctx, ctx.pos);
          }
          for (let i = prev.charCodeAt(0); i <= next.charCodeAt(0); i++) {
            literals.push(String.fromCharCode(i));
          }
          ctx.pos += 3;
        } else {
          literals.push(ch);
          ctx.pos++;
        }
      }

      if (ctx.pos >= ctx.regex.length || ctx.regex[ctx.pos] !== ']') {
        reportError("Unterminated character class", ctx, bracketStartPos);
      }
      ctx.pos++;
      if (literals.length === 0) {
        reportError("Empty character class [] or [^]", ctx, bracketStartPos);
      }
      return { tokenType: TokenType.BRACKET, value: [...new Set(literals)] };
    }
    case '|':
    case ')':
    case '*': case '+': case '?': case '{':
      reportError(`Unexpected character '${char}'`, ctx);
      return null;
    default:
      ctx.pos++;
      return { tokenType: TokenType.LITERAL, value: char };
  }
}


/**
 * @typedef {Object} NFAState
 * @property {boolean} isStart
 * @property {boolean} isTerminal
 * @property {Object.<string, NFAState[]>} transitions
 * @property {NFAState[]} epsilonTransitions
 */

/**
 * NFA state
 * @param {boolean} [isStart=false]
 * @param {boolean} [isTerminal=false]
 * @returns {NFAState}
 */
function createState(isStart = false, isTerminal = false) {
  return {
    isStart,
    isTerminal,
    transitions: {},
    epsilonTransitions: [],
  };
}

const epsilonChar = '';

function addEpsilonTransition(fromState, toState) {
  if (!fromState.epsilonTransitions.includes(toState)) {
    fromState.epsilonTransitions.push(toState);
  }
}

function addTransition(fromState, char, toState) {
  if (!fromState.transitions[char]) {
    fromState.transitions[char] = [];
  }
  if (!fromState.transitions[char].includes(toState)) {
    fromState.transitions[char].push(toState);
  }
}


/**
 * Convert a single token into an NFA fragment.
 * Returns [startState, endState] for the fragment.
 * @param {Token} token
 * @return {[NFAState, NFAState]}
 */
function tokenToNfa(token) {
  const start = createState();
  const end = createState();

  switch (token.tokenType) {
    case TokenType.LITERAL:
      addTransition(start, token.value, end);
      break;

    case TokenType.OR: {
      const [leftTokens, rightTokens] = token.value;
      const [leftStart, leftEnd] = tokensToNfa(leftTokens);
      const [rightStart, rightEnd] = tokensToNfa(rightTokens);

      addEpsilonTransition(start, leftStart);
      addEpsilonTransition(start, rightStart);
      addEpsilonTransition(leftEnd, end);
      addEpsilonTransition(rightEnd, end);
      break;
    }
    case TokenType.BRACKET:
      token.value.forEach((char) => {
        addTransition(start, char, end);
      });
      break;

    case TokenType.GROUP: {
      if (token.value.length === 0) {
        addEpsilonTransition(start, end);
      } else {
        const [groupNfaStart, groupNfaEnd] = tokensToNfa(token.value);
        addEpsilonTransition(start, groupNfaStart);
        addEpsilonTransition(groupNfaEnd, end);
      }
      break;
    }
    case TokenType.REPEAT: {
      const { min, max, token: repeatedToken } = token.value;

      if (min === 0 && max === 0) {
          addEpsilonTransition(start, end);
          break;
      }

      if (min === 0 && max === Infinity) {
        const [itemStart, itemEnd] = tokenToNfa(repeatedToken);
        addEpsilonTransition(start, itemStart);
        addEpsilonTransition(start, end);
        addEpsilonTransition(itemEnd, itemStart);
        addEpsilonTransition(itemEnd, end);
      } else if (min === 1 && max === Infinity) {
        const [itemStart, itemEnd] = tokenToNfa(repeatedToken);
        addEpsilonTransition(start, itemStart);
        addEpsilonTransition(itemEnd, itemStart);
        addEpsilonTransition(itemEnd, end);
      } else if (min === 0 && max === 1) {
        const [itemStart, itemEnd] = tokenToNfa(repeatedToken);
        addEpsilonTransition(start, itemStart);
        addEpsilonTransition(start, end);
        addEpsilonTransition(itemEnd, end);
      } else {
        let currentChainEnd = start;
        for (let i = 0; i < min; i++) {
          const [itemStart, itemEnd] = tokenToNfa(repeatedToken);
          addEpsilonTransition(currentChainEnd, itemStart);
          currentChainEnd = itemEnd;
        }

        if (max === Infinity) {
          const [itemStart, itemEnd] = tokenToNfa(repeatedToken);
          addEpsilonTransition(currentChainEnd, itemStart);
          addEpsilonTransition(itemEnd, itemStart);
          addEpsilonTransition(itemEnd, end);
          addEpsilonTransition(currentChainEnd, end)
        } else {
          for (let i = min; i < max; i++) {
            const [itemStart, itemEnd] = tokenToNfa(repeatedToken);
            addEpsilonTransition(currentChainEnd, itemStart);
            const nextChainPoint = createState();
            addEpsilonTransition(currentChainEnd, nextChainPoint);
            addEpsilonTransition(itemEnd, nextChainPoint);
            currentChainEnd = nextChainPoint;
          }
          addEpsilonTransition(currentChainEnd, end);
        }
      }
      break;
    }
  }
  return [start, end];
}

function tokensToNfa(tokens) {
  if (tokens.length === 0) {
    const start = createState();
    const end = createState();
    addEpsilonTransition(start, end);
    return [start, end];
  }

  let [currentNfaStart, currentNfaEnd] = tokenToNfa(tokens[0]);

  for (let i = 1; i < tokens.length; i++) {
    const [nextTokenStart, nextTokenEnd] = tokenToNfa(tokens[i]);
    addEpsilonTransition(currentNfaEnd, nextTokenStart);
    currentNfaEnd = nextTokenEnd;
  }

  return [currentNfaStart, currentNfaEnd];
}

function buildNfa(ctx) {
  const [nfaStart, nfaEnd] = tokensToNfa(ctx.tokens);

  nfaStart.isStart = true;
  nfaEnd.isTerminal = true;

  return nfaStart;
}

const startOfText = '^';
const endOfText = '$';

function getChar(input, pos) {
  if (pos < 0) return startOfText;
  if (pos >= input.length) return endOfText;
  return input[pos];
}

function check(state, input, pos, visitedEpsilonStates = new Set()) {
  if (state.epsilonTransitions.length > 0) {
    if (visitedEpsilonStates.has(state)) {
      return false;
    }
    visitedEpsilonStates.add(state);
    for (const nextState of state.epsilonTransitions) {
      if (check(nextState, input, pos, visitedEpsilonStates)) {
        return true;
      }
    }
  }

  const char = getChar(input, pos);

  if (char === endOfText) {
    let isTerminalViaEpsilon = state.isTerminal;
    if (!isTerminalViaEpsilon) {
        const q = [state];
        const visitedForTerminalCheck = new Set([state]);
        while(q.length > 0) {
            const s = q.shift();
            if (s.isTerminal) {
                isTerminalViaEpsilon = true;
                break;
            }
            s.epsilonTransitions.forEach(next => {
                if (!visitedForTerminalCheck.has(next)) {
                    visitedForTerminalCheck.add(next);
                    q.push(next);
                }
            });
        }
    }
    return isTerminalViaEpsilon;
  }

  if (state.transitions[char]) {
    for (const nextState of state.transitions[char]) {
      if (check(nextState, input, pos + 1, new Set())) {
        return true;
      }
    }
  }

  return false;
}


function simulateNfaIterative(startState, input) {
  function epsilonClosure(states) {
    const closure = new Set(states);
    const stack = [...states];
    while (stack.length > 0) {
      const s = stack.pop();
      for (const nextState of s.epsilonTransitions) {
        if (!closure.has(nextState)) {
          closure.add(nextState);
          stack.push(nextState);
        }
      }
    }
    return closure;
  }

  let currentStates = epsilonClosure(new Set([startState]));

  for (const element of input) {
    const char = element;
    const nextPossibleStates = new Set();
    for (const state of currentStates) {
      if (state.transitions[char]) {
        state.transitions[char].forEach(s => nextPossibleStates.add(s));
      }
    }
    if (nextPossibleStates.size === 0) return false;
    currentStates = epsilonClosure(nextPossibleStates);
  }

  for (const state of currentStates) {
    if (state.isTerminal) return true;
  }
  return false;
}


function match(regex, input) {
  try {
    const parseContext = parse(regex);
    // console.log('Parsed tokens:', JSON.stringify(parseContext.tokens, null, 2));

    const nfaStartState = buildNfa(parseContext);
    // console.log('NFA built successfully.');

    const result = simulateNfaIterative(nfaStartState, input);
    // console.log(
    //   `Matching result for input "${input}" against regex "${regex}":`,
    //   result,
    // );
    return result;

  } catch (e) {
    console.error(e.message);
    return false;
  }
}
