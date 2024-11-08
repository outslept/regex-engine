/**
 * @enum {number}
 */
const TokenType = {
  GROUP: 0,
  BRACKET: 1,
  OR: 2,
  REPEAT: 3,
  LITERAL: 4,
  GROUP_UNCAPTURED: 5,
}

/**
 * @typedef {Object} Token
 * @property {TokenType} tokenType
 * @property {*} value
 */

/**
 * @typedef {Object} ParseContext
 * @property {number} pos
 * @property {Token[]} tokens
 */

/**
 * Create a new parse context.
 * @param {string} regex
 * @returns {ParseContext}
 */
function createParseContext(regex) {
  return {
    pos: 0,
    tokens: [],
  }
}

/**
 * Parse a regex string, return parsing ctx
 * @param {string} regex
 * @returns {ParseContext}
 */
function parse(regex) {
  const ctx = createParseContext(regex)

  while (ctx.pos < regex.length) {
    ProcessingInstruction(regex, ctx)
    ctx.pos++
  }

  return ctx
}

/**
 * Process a single ch and generate tokens
 * @param {string} regex
 * @param {ParseContext} ctx
 */
function process(regex, ctx) {
  const ch = regex[ctx.pos]

  if (ch === '(') {
    parseGroup(regex, ctx)
  } else if (ch === '[') {
    parseBracket(regex, ctx)
  } else if (ch === '|') {
    parseOr(regex, ctx)
  } else if (['*', '?', '+'].includes(ch)) {
    parseRepeat(regex, ctx)
  } else if (ch === '{') {
    parseRepeatSpecified(regex, ctx)
  } else {
    ctx.tokens.push({
      tokenType: TokenType.LITERAL,
      value: ch,
    })
  }
}

/**
 * Group expression
 * @param {string} regex
 * @param {ParseContext} ctx
 */
function parseGroup(regex, ctx) {
  ctx.pos++ // To move past the '('
  const groupCtx = createParseContext(regex)

  while (regex[ctx.pos] !== ')') {
    process(regex, groupCtx)
    ctx.pos++
  }

  ctx.tokens.push({
    tokenType: TokenType.GROUP,
    value: groupCtx.tokens,
  })
}

/**
 * Bracket expression
 * @param {string} regex
 * @param {ParseContext} ctx
 */
function parseBracket(regex, ctx) {
  ctx.pos++ // Move past '['
  const literals = []

  while (regex[ctx.pos] !== ']') {
    const ch = regex[ctx.pos]

    if (ch === '-') {
      const prev = literals.pop()
      const next = regex[ctx.pos + 1]
      for (let i = prev.charCodeAt(0); i <= next.charCodeAt(0); i++) {
        literals.push(String.fromCharCode(i))
      }
      ctx.pos++ // Skip next character
    } else {
      literals.push(ch)
    }
    ctx.pos++
  }

  ctx.tokens.push({
    tokenType: TokenType.BRACKET,
    value: literals,
  })
}

/**
 * OR expression
 * @param {string} regex
 * @param {ParseContext} ctx
 */
function parseOr(regex, ctx) {
  const leftTokens = ctx.tokens
  ctx.tokens = []

  ctx.pos++
  while (regex[ctx.pos] !== ')' && ctx.pos < regex.length) {
    process(regex, ctx)
    ctx.pos++
  }

  const rightTokens = ctx.tokens
  ctx.tokens = [
    {
      tokenType: TokenType.OR,
      value: [leftTokens, rightTokens],
    },
  ]
}

/**
 * Repeat expression
 * @param {string} regex
 * @param {ParseContext} ctx
 */
function parseRepeat(regex, ctx) {
  const lastToken = ctx.tokens.pop() // Get the last token (which will be repeated)
  let min, max

  switch (regex[ctx.pos]) {
    case '*':
      min = 0
      max = Infinity // * means 0 or more
      break
    case '+':
      min = 1
      max = Infinity // + means 1 or more
      break
    case '?':
      min = 0
      max = 1 // ? means 0 or 1
      break
  }

  ctx.tokens.push({
    tokenType: TokenType.REPEAT,
    value: { min, max, token: lastToken },
  })
}

/**
 * Specified repeat expression
 * @param {string}
 * @param {ParseContext}
 */
function parseRepeatSpecified(regex, ctx) {
  ctx.pos++ // Move past '{'
  let min = '',
    max = ''
  let inMin = true

  while (regex[ctx.pos] !== '}') {
    const ch = regex[ctx.pos]
    if (ch === ',') {
      inMin = false // Switch to reading max
    } else if (inMin) {
      min += ch
    } else {
      max += ch
    }
    ctx.pos++
  }

  min = parseInt(min, 10)
  max = max ? parseInt(max, 10) : Infinity
  const lastToken = ctx.tokens.pop()

  ctx.tokens.push({
    tokenType: TokenType.REPEAT,
    value: { min, max, token: lastToken },
  })
}

/**
 * @typedef {Object} NFAState
 * @property {boolean} start
 * @property {boolean} terminal
 * @property {Object.<string, NFAState[]>} transitions
 */

/**
 * NFA state
 * @param {boolean} [start=false]
 * @param {boolean} [terminal=false]
 * @returns {NFAState}
 */
function createState(start = false, terminal = false) {
  return {
    start,
    terminal,
    transitions: {},
  }
}

const epsilonChar = ''

/**
 * token into an NFA
 * @param {Token} token
 * @return {[NFAState, NFAState]}
 */
function tokenToNfa(token) {
  const start = createState()
  const end = createState()

  switch (token.tokenType) {
    case TokenType.LITERAL:
      // Literal: single transition from start to end
      start.transitions[token.value] = [end]
      break

    case TokenType.OR:
      // OR: two branches, each from start to end
      const [left, right] = token.value
      const [leftStart, leftEnd] = tokenToNfa(left)
      const [rightStart, rightEnd] = tokenToNfa(right)
      start.transitions[epsilonChar] = [leftStart, rightStart]
      leftEnd.transitions[epsilonChar] = [end]
      rightEnd.transitions[epsilonChar] = [end]
      break

    case TokenType.BRACKET:
      // Bracket: multiple transitions for each char in the set
      token.value.forEach((char) => {
        if (!start.transitions[char]) {
          start.transitions[char] = []
        }
        start.transitions[char].push(end)
      })
      break

    case TokenType.GROUP:
    case TokenType.GROUP_UNCAPTURED:
      // Group: process each token in the group and concatenate them
      const groupTokens = token.value
      let [groupStart, groupEnd] = tokenToNfa(groupTokens[0]) // Start with the first token

      for (let i = 1; i < groupTokens.length; i++) {
        const [nextStart, nextEnd] = tokenToNfa(groupTokens[i])
        groupEnd.transitions[epsilonChar] = [nextStart] // Link end of previous NFA to start of next
        groupEnd = nextEnd // Update the end state
      }

      start.transitions[epsilonChar] = [groupStart]
      groupEnd.transitions[epsilonChar] = [end]
      break
  }
}
